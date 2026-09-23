// ---------------------------------------------------------------------------
// Payment flow
//
// The passenger's app may say anything; only this module decides that money
// arrived. Confirmation requires Paystack to report `success` AND the amount
// and currency to match what the booking says, so a tampered client request can
// never buy a cheaper seat.
// ---------------------------------------------------------------------------

import {
  commit,
  createWrite,
  getDocument,
  newId,
  nowIso,
  queryDocuments,
  toMillis,
  updateWrite,
  type FsDoc,
  withRetry,
} from "./firestore.ts";
import { ApiError } from "./errors.ts";
import { notify, writeAudit } from "./audit.ts";
import { isMomoProvider, momoProviderLabel, normaliseGhanaPhone } from "./money.ts";
import {
  chargeMobileMoney,
  checkCharge,
  createRefund,
  submitChargeOtp,
  verifyTransaction,
  type ChargeData,
  type RefundData,
} from "./paystack.ts";
import { getBooking, getBookingOrThrow, referenceForBooking } from "./bookings.ts";
import { creditRideEarning, reverseRideEarning } from "./wallet.ts";
import type { RefundStatus } from "./state.ts";

export type ChargeOutcome = {
  bookingId: string;
  reference: string;
  state: "pay_offline" | "send_otp" | "pending" | "success";
  amountPesewas: number;
  displayText?: string;
  alreadyInProgress?: boolean;
};

const IN_FLIGHT: string[] = ["pending", "processing"];

async function paymentsForBooking(bookingId: string): Promise<FsDoc[]> {
  return queryDocuments({
    collection: "payments",
    filters: [{ field: "bookingId", value: bookingId }],
    limit: 10,
  });
}

function latestPayment(rows: FsDoc[]): FsDoc | null {
  if (!rows.length) return null;
  return rows
    .slice()
    .sort((a, b) => (toMillis(b.data.createdAt) ?? 0) - (toMillis(a.data.createdAt) ?? 0))[0];
}

/**
 * Start a mobile money charge for an approved booking.
 *
 * Duplicate-payment protection: if a charge for this booking is still pending,
 * processing or already paid, we return that instead of creating a second
 * transaction — the passenger is told to wait, never to pay twice.
 */
export async function initiateChargeCore(input: {
  bookingId: string;
  passengerId: string;
  email: string;
  momoProvider: string;
  momoNumber: string;
}): Promise<ChargeOutcome> {
  const booking = await getBookingOrThrow(input.bookingId);
  if (booking.data.passengerId !== input.passengerId) {
    throw new ApiError("not_your_booking", "That booking isn't yours.", 403);
  }
  if (booking.data.status !== "awaiting_payment") {
    throw new ApiError("booking_wrong_state", "This booking isn't waiting for payment.", 409);
  }

  const deadline = toMillis(booking.data.paymentDeadlineAt);
  if (deadline !== null && Date.now() > deadline) {
    throw new ApiError("payment_window_closed", "Your payment window closed. Please book again.", 409);
  }

  if (!isMomoProvider(input.momoProvider)) {
    throw new ApiError("invalid_request", "Choose a Mobile Money network.", 400);
  }
  const payerPhone = normaliseGhanaPhone(input.momoNumber);
  if (!payerPhone) {
    throw new ApiError("momo_number_invalid", "That Mobile Money number doesn't look right.", 400);
  }

  const attachedPayments = await paymentsForBooking(booking.id);
  const existing = latestPayment(attachedPayments);
  if (existing) {
    if (existing.data.status === "paid") {
      throw new ApiError("payment_already_paid", "This booking is already paid.", 409);
    }
    if (IN_FLIGHT.includes(String(existing.data.status))) {
      // Still being verified — return the live charge rather than starting a new one.
      const shown = await checkCharge(String(existing.data.reference)).catch(() => null);
      if (shown?.status === "success") {
        await confirmChargeCore({ bookingId: booking.id, source: "initiate_recheck" });
        return {
          bookingId: booking.id,
          reference: String(existing.data.reference),
          state: "success",
          amountPesewas: Number(booking.data.totalPesewas || 0),
        };
      }
      return {
        bookingId: booking.id,
        reference: String(existing.data.reference),
        state: shown?.status === "send_otp" ? "send_otp" : "pending",
        amountPesewas: Number(booking.data.totalPesewas || 0),
        displayText: shown?.display_text,
        alreadyInProgress: true,
      };
    }
  }

  // Paystack refuses to reuse a reference that already has a transaction, so a
  // retry after a failed attempt gets a fresh one. Only failed attempts can
  // reach here (paid and in-flight bookings returned above), so rotating can
  // never orphan a payment that actually succeeded.
  const baseReference = referenceForBooking(booking.id);
  const attempt = attachedPayments.length;
  const reference = attempt === 0 ? baseReference : `${baseReference}-A${attempt}`;
  const amountPesewas = Number(booking.data.totalPesewas || 0);
  if (!amountPesewas) throw new ApiError("unknown", "This booking has no amount.", 409);

  let charge: ChargeData;
  try {
    charge = await chargeMobileMoney({
      email: input.email,
      amountPesewas,
      reference,
      phone: payerPhone,
      provider: input.momoProvider,
      metadata: {
        bookingId: booking.id,
        driverId: String(booking.data.driverId || ""),
        passengerId: input.passengerId,
        routeId: String(booking.data.routeId || ""),
        seats: Number(booking.data.seats || 1),
      },
    });
  } catch (error) {
    await writeAudit({
      event: "PAYMENT_FAILED",
      entityType: "booking",
      entityId: booking.id,
      actorId: input.passengerId,
      actorRole: "passenger",
      providerRef: reference,
      meta: { stage: "initiate" },
    });
    throw error;
  }

  const paymentId = newId();
  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${booking.id}`);
    if (!fresh) throw new ApiError("booking_not_found", "We couldn't find that booking.", 404);

    await commit([
      createWrite(`payments/${paymentId}`, {
        bookingId: booking.id,
        passengerId: input.passengerId,
        driverId: String(booking.data.driverId || ""),
        amountPesewas,
        currency: "GHS",
        provider: "paystack",
        channel: "mobile_money",
        providerCode: input.momoProvider,
        payerPhone,
        reference,
        providerTransactionId: null,
        status: charge.status === "success" ? "paid" : "pending",
        gatewayResponse: charge.status,
        initiatedAt: nowIso(),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }),
      updateWrite(
        `bookings/${booking.id}`,
        { paymentRef: reference, paymentStatus: "pending", updatedAt: nowIso() },
        ["paymentRef", "paymentStatus", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  });

  await writeAudit({
    event: "PAYMENT_INITIALIZED",
    entityType: "booking",
    entityId: booking.id,
    actorId: input.passengerId,
    actorRole: "passenger",
    amountPesewas,
    providerRef: reference,
    meta: { provider: "paystack", channel: "mobile_money", providerCode: input.momoProvider },
  });

  if (charge.status === "success") {
    await confirmChargeCore({ bookingId: booking.id, source: "charge_immediate" });
    return { bookingId: booking.id, reference, state: "success", amountPesewas };
  }

  const state = charge.status === "send_otp" ? "send_otp" : charge.status === "pay_offline" ? "pay_offline" : "pending";

  return {
    bookingId: booking.id,
    reference,
    state,
    amountPesewas,
    displayText: charge.display_text,
  };
}

/** Finish an OTP-gated charge (some MoMo wallets require it). */
export async function submitChargeOtpCore(input: {
  bookingId: string;
  passengerId: string;
  otp: string;
}): Promise<ChargeOutcome> {
  const booking = await getBookingOrThrow(input.bookingId);
  if (booking.data.passengerId !== input.passengerId) {
    throw new ApiError("not_your_booking", "That booking isn't yours.", 403);
  }

  const reference = booking.data.paymentRef as string;
  if (!reference) throw new ApiError("charge_failed", "We couldn't find that payment.", 409);

  const result = await submitChargeOtp(reference, input.otp);
  const amountPesewas = Number(booking.data.totalPesewas || 0);

  if (result.status === "success") {
    await confirmChargeCore({ bookingId: booking.id, source: "charge_otp" });
    return { bookingId: booking.id, reference, state: "success", amountPesewas };
  }

  if (result.status === "failed") {
    await markPaymentFailed(booking.id, reference, "otp_failed");
    throw new ApiError("payment_failed", "Payment failed. Your seats were not reserved.", 402);
  }

  return {
    bookingId: booking.id,
    reference,
    state: result.status === "send_otp" ? "send_otp" : "pending",
    amountPesewas,
    displayText: result.display_text,
  };
}

async function markPaymentFailed(bookingId: string, reference: string, reason: string): Promise<void> {
  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${bookingId}`);
    if (!fresh || fresh.data.paymentStatus === "paid") return;
    await commit([
      updateWrite(
        `bookings/${bookingId}`,
        { paymentStatus: "failed", updatedAt: nowIso() },
        ["paymentStatus", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  });

  const rows = await paymentsForBooking(bookingId);
  const payment = latestPayment(rows);
  if (payment) {
    await commit([
      updateWrite(
        `payments/${payment.id}`,
        { status: "failed", gatewayResponse: reason, updatedAt: nowIso() },
        ["status", "gatewayResponse", "updatedAt"],
        payment.updateTime
      ),
    ]);
  }

  const booking = await getBooking(bookingId);
  if (booking?.data.passengerId) {
    await notify({
      recipientId: booking.data.passengerId as string,
      type: "payment_failed",
      title: "Payment failed",
      body: "Payment failed. Your seats were not permanently reserved.",
      bookingId,
    });
  }

  await writeAudit({
    event: "PAYMENT_FAILED",
    entityType: "booking",
    entityId: bookingId,
    actorRole: "system",
    providerRef: reference,
    meta: { reason },
  });
}

export type ConfirmResult = {
  bookingId: string;
  status: string;
  paymentStatus: string;
  paid: boolean;
  amountPesewas?: number;
  refundStatus?: string;
};

/**
 * The single place a booking becomes paid.
 *
 * Verification is deliberately strict: Paystack must report success, the
 * currency must be GHS, and the amount must equal the server-computed total.
 * Anything else is recorded and refused.
 */
export async function confirmChargeCore(input: {
  bookingId: string;
  source: "client_poll" | "webhook" | "charge_immediate" | "charge_otp" | "initiate_recheck";
}): Promise<ConfirmResult> {
  const booking = await getBookingOrThrow(input.bookingId);

  const currentRefund = (booking.data.refund as { status?: string } | null)?.status;
  const shape = (over: Partial<ConfirmResult> = {}): ConfirmResult => ({
    bookingId: booking.id,
    status: String(booking.data.status || ""),
    paymentStatus: String(booking.data.paymentStatus || "not_started"),
    paid: booking.data.paymentStatus === "paid",
    amountPesewas: Number(booking.data.totalPesewas || 0),
    refundStatus: currentRefund,
    ...over,
  });

  if (booking.data.paymentStatus === "paid") return shape({ paid: true });

  const reference = booking.data.paymentRef as string;
  if (!reference) return shape();

  const verified = await verifyTransaction(reference);
  if (!verified) return shape();

  if (verified.status !== "success") {
    if (verified.status === "failed" || verified.status === "abandoned") {
      await markPaymentFailed(booking.id, reference, verified.status);
    } else {
      // ongoing / pending: keep waiting; never confirm.
      await withRetry(async () => {
        const fresh = await getDocument(`bookings/${booking.id}`);
        if (!fresh || fresh.data.paymentStatus === "paid") return;
        await commit([
          updateWrite(
            `bookings/${booking.id}`,
            { paymentStatus: "processing", updatedAt: nowIso() },
            ["paymentStatus", "updatedAt"],
            fresh.updateTime
          ),
        ]);
      });
    }
    const refreshed = await getBooking(booking.id);
    return shape({
      status: String(refreshed?.data.status || ""),
      paymentStatus: String(refreshed?.data.paymentStatus || ""),
      paid: false,
    });
  }

  // ── Amount + currency must match our own calculation ──────────────────
  const expected = Number(booking.data.totalPesewas || 0);
  const paidAmount = Number(verified.amount || 0);

  if (verified.currency !== "GHS" || paidAmount !== expected) {
    console.error(
      `[paymentFlow] verification mismatch booking=${booking.id} expected=${expected} paid=${paidAmount} currency=${verified.currency}`
    );
    await writeAudit({
      event: "PAYMENT_VERIFICATION_FAILED",
      entityType: "booking",
      entityId: booking.id,
      actorRole: "system",
      amountPesewas: paidAmount,
      providerRef: reference,
      meta: { expected, currency: verified.currency },
    });
    // Refuse to confirm — a mismatched amount needs a human.
    return shape({ paymentStatus: "processing" });
  }

  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${booking.id}`);
    if (!fresh) return;
    if (fresh.data.paymentStatus === "paid") return;

    await commit([
      updateWrite(
        `bookings/${booking.id}`,
        {
          status: "confirmed",
          paymentStatus: "paid",
          paidAt: nowIso(),
          updatedAt: nowIso(),
        },
        ["status", "paymentStatus", "paidAt", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  });

  const rows = await paymentsForBooking(booking.id);
  const payment = latestPayment(rows);
  if (payment && payment.data.status !== "paid") {
    await commit([
      updateWrite(
        `payments/${payment.id}`,
        {
          status: "paid",
          providerTransactionId: verified.id,
          gatewayResponse: verified.gateway_response ?? "success",
          verifiedAt: nowIso(),
          updatedAt: nowIso(),
        },
        ["status", "providerTransactionId", "gatewayResponse", "verifiedAt", "updatedAt"],
        payment.updateTime
      ),
    ]);
  }

  await writeAudit({
    event: "PAYMENT_SUCCESSFUL",
    entityType: "booking",
    entityId: booking.id,
    actorId: String(booking.data.passengerId || ""),
    actorRole: "passenger",
    amountPesewas: paidAmount,
    providerRef: reference,
    meta: { source: input.source },
  });

  // Seats are already held; the hold simply becomes permanent. Then the driver
  // is credited (pending until the ride completes).
  const confirmed = await getBooking(booking.id);
  if (confirmed) await creditRideEarning(confirmed);

  await notify({
    recipientId: String(booking.data.passengerId || ""),
    type: "payment_confirmed",
    title: "Payment successful",
    body: "Your seat is confirmed. Have a safe trip!",
    bookingId: booking.id,
  });
  await notify({
    recipientId: String(booking.data.driverId || ""),
    type: "payment_confirmed",
    title: "Passenger has paid",
    body: `${booking.data.passengerName || "Your passenger"} paid for ${booking.data.seats || 1} seat(s).`,
    bookingId: booking.id,
  });

  // The Mate is the one who boards and drops this passenger off, so a paid seat
  // is their cue — never a licence: payment state is read from the booking, and
  // only the backend ever writes it.
  const paidMateId = typeof booking.data.mateId === "string" ? booking.data.mateId : null;
  if (paidMateId) {
    await notify({
      recipientId: paidMateId,
      type: "payment_confirmed",
      title: "Paid — ready to board",
      body: `${booking.data.passengerName || "Your passenger"} paid for ${booking.data.seats || 1} seat(s).`,
      bookingId: booking.id,
    });
  }

  return shape({
    status: "confirmed",
    paymentStatus: "paid",
    paid: true,
    amountPesewas: paidAmount,
  });
}

// ─── Refunds ──────────────────────────────────────────────────────────────

function mapRefundStatus(status: string): RefundStatus {
  switch (status) {
    case "processed":
      return "processed";
    case "processing":
      return "processing";
    case "failed":
      return "failed";
    case "needs_attention":
      return "needs_attention";
    case "pending":
    default:
      return "pending";
  }
}

const REFUND_FINISHED: string[] = ["pending", "processing", "processed"];

/**
 * A refund attempt that has been claimed but not yet answered by Paystack.
 *
 * This state exists to serialise attempts: only the caller that manages to
 * write it may talk to Paystack for that booking.
 */
const REFUND_CLAIMED = "requesting";

/**
 * How long a claim may sit unanswered before it is treated as abandoned.
 *
 * A function that dies between claiming and recording the outcome would
 * otherwise block that booking's refund forever, so a stale claim is allowed to
 * be taken over. Long enough that a slow Paystack call is never stolen from.
 */
const REFUND_CLAIM_STALE_MS = 2 * 60_000;

type RefundRecord = {
  status?: string;
  amountPesewas?: number;
  requestedAt?: string;
  attemptId?: string;
  [key: string]: unknown;
};

/**
 * Claim the right to call Paystack for this booking's refund.
 *
 * The claim is written with a compare-and-swap on the booking document, so of
 * two callers racing — a passenger cancelling while the driver ends the trip,
 * say — exactly one wins and the other is told "someone is already doing it".
 * That is the difference from reading a flag and acting on it: the check and the
 * write are the same operation.
 *
 * Claiming is allowed when nothing is settled yet, and when a previous attempt
 * failed (`needs_attention`) or was abandoned mid-flight. It is refused when
 * the refund is already finished, or when another attempt is genuinely live.
 */
async function claimRefundAttempt(input: {
  bookingId: string;
  amountPesewas: number;
  reason: string;
}): Promise<{ claimed: boolean; attemptId?: string; held: RefundRecord | null }> {
  return withRetry(async () => {
    const fresh = await getDocument(`bookings/${input.bookingId}`);
    if (!fresh) return { claimed: false, held: null };

    const held = (fresh.data.refund as RefundRecord | null) || null;
    const status = typeof held?.status === "string" ? held.status : null;

    // Already on its way or done: nothing to claim.
    if (status && REFUND_FINISHED.includes(status)) return { claimed: false, held };

    if (status === REFUND_CLAIMED) {
      const startedAt = toMillis(held?.requestedAt);
      const abandoned = startedAt === null || Date.now() - startedAt > REFUND_CLAIM_STALE_MS;
      // Somebody else is mid-attempt; leave theirs alone.
      if (!abandoned) return { claimed: false, held };
    }

    const attemptId = newId();
    await commit([
      updateWrite(
        `bookings/${input.bookingId}`,
        {
          refund: {
            ...(held || {}),
            status: REFUND_CLAIMED,
            amountPesewas: input.amountPesewas,
            reason: input.reason,
            attemptId,
            requestedAt: nowIso(),
            resolvedAt: null,
            resolvedBy: null,
            resolutionNote: null,
            failure: null,
          },
          updatedAt: nowIso(),
        },
        ["refund", "updatedAt"],
        fresh.updateTime
      ),
    ]);

    return { claimed: true, attemptId, held };
  });
}

/**
 * Refund a paid booking.
 *
 * Guarded twice over: a finished refund is never repeated, and an attempt in
 * flight can only be started by the one caller that wins the claim commit — so
 * two concurrent paths (passenger cancel and trip end, say) cannot each ask
 * Paystack for the same money. A claim that loses waits and reports what is
 * actually happening instead of acting again.
 */
export async function raiseRefundCore(input: {
  bookingId: string;
  reason: string;
  actorId?: string;
  actorRole?: "passenger" | "driver" | "admin" | "system";
}): Promise<{ refundStatus: string; amountPesewas: number }> {
  const booking = await getBookingOrThrow(input.bookingId);

  if (booking.data.paymentStatus !== "paid") {
    return { refundStatus: "none", amountPesewas: 0 };
  }

  const existing = (booking.data.refund as { status?: string } | null)?.status;
  if (existing && REFUND_FINISHED.includes(existing)) {
    return { refundStatus: existing, amountPesewas: Number((booking.data.refund as any)?.amountPesewas || 0) };
  }

  const amountPesewas = Number(booking.data.totalPesewas || 0);
  const reference = booking.data.paymentRef as string;
  const passengerId = String(booking.data.passengerId || "");

  const claim = await claimRefundAttempt({
    bookingId: booking.id,
    amountPesewas,
    reason: input.reason,
  });

  if (!claim.claimed) {
    // Someone else owns this refund: an earlier attempt is still live, or it is
    // already done. Report the true state; never call Paystack a second time.
    const settled = await getBooking(booking.id);
    const held = (settled?.data.refund as RefundRecord | null) || null;
    return {
      refundStatus: typeof held?.status === "string" ? held.status : "pending",
      amountPesewas: Number(held?.amountPesewas || 0),
    };
  }

  let refund: RefundData | null = null;
  let failure: string | null = null;

  try {
    refund = await createRefund({
      transactionReference: reference,
      amountPesewas,
      customerNote: "EasyTroski booking refund",
      merchantNote: `Refund for ${reference} (${input.reason})`,
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : "refund request failed";
    console.error(`[paymentFlow] refund failed booking=${booking.id}`, error);
  }

  const status: RefundStatus = refund ? mapRefundStatus(refund.status) : "needs_attention";

  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${booking.id}`);
    if (!fresh) return;
    const held = (fresh.data.refund as RefundRecord | null) || {};
    const current = typeof held.status === "string" ? held.status : null;
    // A webhook or an admin may have settled it while we were talking to
    // Paystack — their answer is newer than ours, so leave it alone.
    if (current && REFUND_FINISHED.includes(current)) return;

    await commit([
      updateWrite(
        `bookings/${booking.id}`,
        {
          refund: {
            ...held,
            status,
            amountPesewas,
            reason: input.reason,
            providerRefundId: refund?.id ?? null,
            customerNote: "EasyTroski booking refund",
            merchantNote: `Refund for ${reference} (${input.reason})`,
            // The claim already stamped when this attempt began; keep it.
            requestedAt: held.requestedAt ?? nowIso(),
            resolvedAt: null,
            resolvedBy: null,
            failure: failure,
          },
          updatedAt: nowIso(),
        },
        ["refund", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  });

  await writeAudit({
    event: "REFUND_REQUESTED",
    entityType: "refund",
    entityId: booking.id,
    actorId: input.actorId,
    actorRole: input.actorRole ?? "system",
    amountPesewas,
    providerRef: reference,
    meta: {
      status,
      reason: input.reason,
      providerRefundId: refund?.id ?? null,
      attemptId: claim.attemptId ?? null,
    },
  });

  // The driver must not keep money for a ride that was refunded.
  await reverseRideEarning(booking, input.reason);

  if (passengerId) {
    await notify({
      recipientId: passengerId,
      type: "refund_pending",
      title: "Refund started",
      body:
        status === "processed"
          ? "Your refund has been processed."
          : "Your refund is being processed. We'll let you know when it's done.",
      bookingId: booking.id,
    });
  }

  return { refundStatus: status, amountPesewas };
}

/** Apply a refund state pushed by Paystack's webhook. */
export async function applyRefundWebhook(input: {
  reference: string;
  providerRefundId?: number;
  status: string;
}): Promise<void> {
  const matches = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "paymentRef", value: input.reference }],
    limit: 1,
  });
  const booking = matches[0];
  if (!booking) {
    console.error(`[paymentFlow] refund webhook for unknown reference ${input.reference}`);
    return;
  }

  const status = mapRefundStatus(input.status);

  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${booking.id}`);
    if (!fresh) return;
    const current = (fresh.data.refund as { status?: string } | null)?.status;
    if (current === status) return;

    await commit([
      updateWrite(
        `bookings/${booking.id}`,
        {
          refund: {
            ...(fresh.data.refund as Record<string, unknown> | null || {}),
            status,
            providerRefundId: input.providerRefundId ?? (fresh.data.refund as any)?.providerRefundId ?? null,
            resolvedAt: status === "processed" || status === "failed" ? nowIso() : null,
          },
          updatedAt: nowIso(),
        },
        ["refund", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  });

  await writeAudit({
    event: "REFUND_STATUS_CHANGED",
    entityType: "refund",
    entityId: booking.id,
    actorRole: "paystack",
    providerRef: input.reference,
    meta: { status, providerRefundId: input.providerRefundId ?? null },
  });

  if (status === "processed" && booking.data.passengerId) {
    await notify({
      recipientId: booking.data.passengerId as string,
      type: "refund_completed",
      title: "Refund processed",
      body: "Your refund has been processed.",
      bookingId: booking.id,
    });
  }
}
