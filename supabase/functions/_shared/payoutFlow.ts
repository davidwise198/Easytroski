// ---------------------------------------------------------------------------
// Payouts (driver withdrawals)
//
// Drivers may withdraw once a day, after the configured cutoff, so the platform
// keeps commission and settles in a single batch rather than per ride.
//
// Money safety:
//   • the amount is moved out of the withdrawable balance into a hold BEFORE
//     Paystack is called, so a double tap can't pay twice
//   • success keeps the hold consumed; failure returns the money
//   • the transfer reference is stable, so retries never create a second payout
// ---------------------------------------------------------------------------

import {
  commit,
  createWrite,
  getDocument,
  newId,
  nowIso,
  queryDocuments,
  updateWrite,
  type FsDoc,
  withRetry,
} from "./firestore.ts";
import { ApiError } from "./errors.ts";
import { notify, writeAudit } from "./audit.ts";
import { MIN_PAYOUT_PESEWAS, PAYOUT_CUTOFF_HOUR } from "./env.ts";
import { isMomoProvider, momoProviderLabel, normaliseGhanaPhone } from "./money.ts";
import { createMobileMoneyRecipient, finalizeTransfer, initiateTransfer } from "./paystack.ts";
import { holdFundsForPayout, settlePayoutHold } from "./wallet.ts";
import { formatPesewas } from "./format.ts";

const IN_FLIGHT = ["requested", "processing", "needs_otp"];

/** Ghana is UTC+0, so UTC hour is Accra hour. */
export function payoutWindowOpen(now: Date = new Date()): boolean {
  return now.getUTCHours() >= PAYOUT_CUTOFF_HOUR;
}

export type PayoutOutcome = {
  payoutId: string;
  amountPesewas: number;
  status: string;
  message?: string;
};

export async function requestPayoutCore(driverId: string): Promise<PayoutOutcome> {
  const driver = await getDocument(`drivers/${driverId}`);
  if (!driver) throw new ApiError("driver_unavailable", "Your driver profile is missing.", 404);

  const provider = driver.data.momoProvider;
  const rawNumber = driver.data.momoNumber;
  if (!isMomoProvider(provider) || typeof rawNumber !== "string") {
    throw new ApiError("missing_momo_details", "Add your Mobile Money details first.", 409);
  }
  const momoNumber = normaliseGhanaPhone(rawNumber);
  if (!momoNumber) throw new ApiError("momo_number_invalid", "Your Mobile Money number looks wrong.", 409);

  if (!payoutWindowOpen()) {
    throw new ApiError(
      "payout_too_early",
      `Withdrawals open at ${PAYOUT_CUTOFF_HOUR}:00. You can withdraw your full balance then.`,
      409
    );
  }

  const outstanding = await queryDocuments({
    collection: "payouts",
    filters: [{ field: "driverId", value: driverId }],
    limit: 10,
  });
  if (outstanding.some((payout) => IN_FLIGHT.includes(String(payout.data.status)))) {
    throw new ApiError("payout_in_progress", "A withdrawal is already being processed.", 409);
  }

  const available = Number(driver.data.walletBalancePesewas || 0);
  if (available < MIN_PAYOUT_PESEWAS) {
    throw new ApiError("payout_nothing_to_withdraw", "There's nothing to withdraw yet.", 409);
  }

  // Hold first: the balance can no longer be spent twice from here on.
  await holdFundsForPayout(driverId, available);

  const amountPesewas = available;
  const payoutId = newId();
  const reference = `et-payout-${payoutId}`;

  try {
    const refreshed = await getDocument(`drivers/${driverId}`);
    let recipientCode = refreshed?.data.recipientCode as string | undefined;

    if (!recipientCode) {
      const recipient = await createMobileMoneyRecipient({
        name: String(refreshed?.data.name || refreshed?.data.email || "EasyTroski driver"),
        phone: momoNumber,
        provider,
      });
      recipientCode = recipient.recipient_code;
      const latest = await getDocument(`drivers/${driverId}`);
      if (latest) {
        await commit([
          updateWrite(
            `drivers/${driverId}`,
            { recipientCode, momoVerifiedAt: nowIso(), updatedAt: nowIso() },
            ["recipientCode", "momoVerifiedAt", "updatedAt"],
            latest.updateTime
          ),
        ]);
      }
    }

    await commit([
      createWrite(`payouts/${payoutId}`, {
        driverId,
        amountPesewas,
        currency: "GHS",
        momoProvider: provider,
        momoNumber,
        recipientCode,
        reference,
        status: "requested",
        requestedAt: nowIso(),
      }),
    ]);

    const transfer = await initiateTransfer({
      amountPesewas,
      recipientCode,
      reference,
      reason: `EasyTroski earnings payout ${reference}`,
    });

    // Paystack returns status "otp" when the account requires transfer OTP:
    // the money is queued but an admin must finalize it.
    const status = transfer.status === "otp" ? "needs_otp" : transfer.status === "success" ? "success" : "processing";

    await withRetry(async () => {
      const payout = await getDocument(`payouts/${payoutId}`);
      if (!payout) return;
      await commit([
        updateWrite(
          `payouts/${payoutId}`,
          {
            status,
            transferCode: transfer.transfer_code,
            processedAt: nowIso(),
            ...(status === "success" ? { completedAt: nowIso() } : {}),
          },
          ["status", "transferCode", "processedAt", ...(status === "success" ? ["completedAt"] : [])],
          payout.updateTime
        ),
      ]);
    });

    if (status === "success") {
      await settlePayout(driverId, payoutId, amountPesewas, true);
    }

    await writeAudit({
      event: "PAYOUT_REQUESTED",
      entityType: "payout",
      entityId: payoutId,
      actorId: driverId,
      actorRole: "driver",
      amountPesewas,
      providerRef: reference,
      meta: { status, provider: momoProviderLabel(provider) },
    });

    return {
      payoutId,
      amountPesewas,
      status,
      message:
        status === "needs_otp"
          ? "Your withdrawal is queued and will be released once it is approved."
          : status === "success"
          ? "Withdrawal sent to your Mobile Money wallet."
          : "Withdrawal is on its way to your Mobile Money wallet.",
    };
  } catch (error) {
    // Paystack never accepted it — put the driver's money back.
    await settlePayoutHold(driverId, amountPesewas, false);
    await writeAudit({
      event: "PAYOUT_FAILED",
      entityType: "payout",
      entityId: payoutId,
      actorId: driverId,
      actorRole: "driver",
      amountPesewas,
      meta: { stage: "initiate" },
    });
    throw error;
  }
}

/** Mark a payout settled and record it in the ledger. */
async function settlePayout(
  driverId: string,
  payoutId: string,
  amountPesewas: number,
  success: boolean
): Promise<void> {
  await settlePayoutHold(driverId, amountPesewas, success);

  if (success) {
    await commit([
      createWrite(`driverLedger/${newId()}`, {
        driverId,
        payoutId,
        type: "payout",
        status: "paid_out",
        grossPesewas: 0,
        commissionPesewas: 0,
        netPesewas: -amountPesewas,
        currency: "GHS",
        description: `Withdrawal to Mobile Money (${formatPesewas(amountPesewas)})`,
        createdAt: nowIso(),
      }),
    ]);
  }

  await notify({
    recipientId: driverId,
    type: "payout_paid",
    title: success ? "Withdrawal sent" : "Withdrawal failed",
    body: success
      ? `${formatPesewas(amountPesewas)} is on its way to your Mobile Money wallet.`
      : `${formatPesewas(amountPesewas)} couldn't be sent and is back in your wallet.`,
    payoutId,
  });
}

/** Apply a transfer.* webhook from Paystack. */
export async function applyPayoutWebhook(input: {
  reference: string;
  status: string;
  transferCode?: string;
}): Promise<void> {
  const matches = await queryDocuments({
    collection: "payouts",
    filters: [{ field: "reference", value: input.reference }],
    limit: 1,
  });
  const payout = matches[0];
  if (!payout) {
    console.error(`[payoutFlow] webhook for unknown payout reference ${input.reference}`);
    return;
  }

  const driverId = String(payout.data.driverId || "");
  const amountPesewas = Number(payout.data.amountPesewas || 0);

  if (input.status === "success") {
    if (payout.data.status === "success") return; // already settled
    await withRetry(async () => {
      const fresh = await getDocument(`payouts/${payout.id}`);
      if (!fresh || fresh.data.status === "success") return;
      await commit([
        updateWrite(
          `payouts/${payout.id}`,
          { status: "success", transferCode: input.transferCode ?? fresh.data.transferCode ?? null, completedAt: nowIso() },
          ["status", "transferCode", "completedAt"],
          fresh.updateTime
        ),
      ]);
    });
    await settlePayout(driverId, payout.id, amountPesewas, true);
    await writeAudit({
      event: "PAYOUT_SUCCEEDED",
      entityType: "payout",
      entityId: payout.id,
      actorRole: "paystack",
      amountPesewas,
      providerRef: input.reference,
    });
    return;
  }

  if (input.status === "failed" || input.status === "reversed") {
    if (payout.data.status === "failed") return;
    await withRetry(async () => {
      const fresh = await getDocument(`payouts/${payout.id}`);
      if (!fresh || fresh.data.status === "failed") return;
      await commit([
        updateWrite(
          `payouts/${payout.id}`,
          { status: "failed", failureReason: input.status, processedAt: nowIso() },
          ["status", "failureReason", "processedAt"],
          fresh.updateTime
        ),
      ]);
    });
    await settlePayout(driverId, payout.id, amountPesewas, false);
    await writeAudit({
      event: "PAYOUT_FAILED",
      entityType: "payout",
      entityId: payout.id,
      actorRole: "paystack",
      amountPesewas,
      providerRef: input.reference,
      meta: { status: input.status },
    });
  }
}

/** Admin: finish an OTP-gated payout, or force a failed one closed. */
export async function resolvePayoutCore(input: {
  payoutId: string;
  actorId: string;
  otp?: string;
  outcome?: "success" | "failed";
}): Promise<{ payoutId: string; status: string }> {
  const payout = await getDocument(`payouts/${input.payoutId}`);
  if (!payout) throw new ApiError("booking_not_found", "We couldn't find that payout.", 404);

  const driverId = String(payout.data.driverId || "");
  const amountPesewas = Number(payout.data.amountPesewas || 0);

  if (input.otp) {
    const transferCode = payout.data.transferCode as string | undefined;
    if (!transferCode) throw new ApiError("booking_wrong_state", "This payout has no transfer to finalize.", 409);

    const result = await finalizeTransfer(transferCode, input.otp);
    const status = result.status === "success" ? "success" : "processing";
    await withRetry(async () => {
      const fresh = await getDocument(`payouts/${input.payoutId}`);
      if (!fresh) return;
      await commit([
        updateWrite(
          `payouts/${input.payoutId}`,
          { status, ...(status === "success" ? { completedAt: nowIso() } : {}) },
          ["status", ...(status === "success" ? ["completedAt"] : [])],
          fresh.updateTime
        ),
      ]);
    });
    if (status === "success") await settlePayout(driverId, input.payoutId, amountPesewas, true);

    await writeAudit({
      event: "ADMIN_ACTION",
      entityType: "payout",
      entityId: input.payoutId,
      actorId: input.actorId,
      actorRole: "admin",
      amountPesewas,
      meta: { action: "finalize_transfer", status },
    });

    return { payoutId: input.payoutId, status };
  }

  const status = input.outcome === "success" ? "success" : "failed";
  await withRetry(async () => {
    const fresh = await getDocument(`payouts/${input.payoutId}`);
    if (!fresh) return;
    await commit([
      updateWrite(
        `payouts/${input.payoutId}`,
        {
          status,
          processedAt: nowIso(),
          failureReason: status === "failed" ? "marked_failed_by_admin" : null,
        },
        ["status", "processedAt", "failureReason"],
        fresh.updateTime
      ),
    ]);
  });
  await settlePayout(driverId, input.payoutId, amountPesewas, status === "success");

  await writeAudit({
    event: "ADMIN_ACTION",
    entityType: "payout",
    entityId: input.payoutId,
    actorId: input.actorId,
    actorRole: "admin",
    amountPesewas,
    meta: { action: `mark_${status}` },
  });

  return { payoutId: input.payoutId, status };
}

/** List payouts that still need a human (admin screen). */
export async function listPayoutsNeedingAttention(): Promise<FsDoc[]> {
  const rows = await queryDocuments({
    collection: "payouts",
    filters: [{ field: "status", value: "needs_otp" }],
    limit: 25,
  });
  return rows;
}
