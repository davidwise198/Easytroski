// ---------------------------------------------------------------------------
// Driver wallet
//
// Append-only ledger plus three balance buckets on the driver document:
//   walletBalancePesewas    withdrawable (the ride completed)
//   pendingEarningsPesewas  earned, but the ride hasn't completed yet
//   payoutHoldPesewas       committed to a payout that is still in flight
//
// Every mutation is guarded by a compare-and-swap on the booking or ledger
// document, so a duplicated webhook or a retried request can never credit or
// debit a driver twice.
// ---------------------------------------------------------------------------

import {
  commit,
  createWrite,
  getDocument,
  incrementWrite,
  newId,
  nowIso,
  queryDocuments,
  updateWrite,
  type FsDoc,
  withRetry,
} from "./firestore.ts";
import { splitFare } from "./money.ts";
import { writeAudit } from "./audit.ts";

function driverPath(driverId: string): string {
  return `drivers/${driverId}`;
}

function ledgerEntry(booking: FsDoc, type: string, status: string, netPesewas: number, extra: Record<string, unknown> = {}) {
  return {
    driverId: booking.data.driverId as string,
    bookingId: booking.id,
    type,
    status,
    grossPesewas: 0,
    commissionPesewas: 0,
    netPesewas,
    currency: "GHS",
    createdAt: nowIso(),
    ...extra,
  };
}

async function findRideCredit(bookingId: string): Promise<FsDoc | null> {
  const entries = await queryDocuments({
    collection: "driverLedger",
    filters: [
      { field: "bookingId", value: bookingId },
      { field: "type", value: "credit" },
    ],
    limit: 1,
  });
  return entries[0] ?? null;
}

async function hasReversal(bookingId: string): Promise<boolean> {
  const entries = await queryDocuments({
    collection: "driverLedger",
    filters: [
      { field: "bookingId", value: bookingId },
      { field: "type", value: "reversal" },
    ],
    limit: 1,
  });
  return entries.length > 0;
}

/**
 * Credit a driver for a paid booking. The money lands in `pendingEarnings`
 * immediately (so the driver can see it) and only becomes withdrawable once the
 * ride completes — which is what protects the platform if the fare has to be
 * refunded.
 */
export async function creditRideEarning(booking: FsDoc): Promise<void> {
  const driverId = booking.data.driverId as string;
  if (!driverId) return;
  if (booking.data.walletCreditedAt) return; // already credited

  const total = Number(booking.data.totalPesewas || 0);
  if (!total) return;

  const split = splitFare(total);

  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${booking.id}`);
    if (!fresh || fresh.data.walletCreditedAt) return;

    const ledgerId = newId();
    await commit([
      createWrite(`driverLedger/${ledgerId}`, {
        ...ledgerEntry(fresh, "credit", "pending", split.netPesewas),
        grossPesewas: split.grossPesewas,
        commissionPesewas: split.commissionPesewas,
        description: "Ride earnings",
      }),
      updateWrite(
        `bookings/${fresh.id}`,
        { walletCreditedAt: nowIso(), updatedAt: nowIso() },
        ["walletCreditedAt", "updatedAt"],
        fresh.updateTime
      ),
      incrementWrite(driverPath(driverId), {
        pendingEarningsPesewas: split.netPesewas,
        lifetimeEarningsPesewas: split.netPesewas,
      }),
    ]);
  });

  await writeAudit({
    event: "WALLET_CREDITED",
    entityType: "booking",
    entityId: booking.id,
    actorRole: "system",
    amountPesewas: split.netPesewas,
    meta: { grossPesewas: split.grossPesewas, commissionPesewas: split.commissionPesewas },
  });
}

/** Move a credit from pending to withdrawable once the ride has completed. */
export async function makeEarningAvailable(booking: FsDoc): Promise<void> {
  const driverId = booking.data.driverId as string;
  if (!driverId) return;
  if (!booking.data.walletCreditedAt) return;
  if (booking.data.earningsAvailableAt) return;

  const credit = await findRideCredit(booking.id);
  if (!credit) return;
  if (credit.data.status === "reversed") return; // refunded — nothing to release

  const net = Number(credit.data.netPesewas || 0);

  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${booking.id}`);
    if (!fresh || fresh.data.earningsAvailableAt || !fresh.data.walletCreditedAt) return;

    const freshCredit = await getDocument(`driverLedger/${credit.id}`);
    if (!freshCredit || freshCredit.data.status === "reversed" || freshCredit.data.status === "available") return;

    await commit([
      updateWrite(
        `bookings/${fresh.id}`,
        { earningsAvailableAt: nowIso(), updatedAt: nowIso() },
        ["earningsAvailableAt", "updatedAt"],
        fresh.updateTime
      ),
      updateWrite(
        `driverLedger/${freshCredit.id}`,
        { status: "available", availableAt: nowIso() },
        ["status", "availableAt"],
        freshCredit.updateTime
      ),
      incrementWrite(driverPath(driverId), {
        walletBalancePesewas: net,
        pendingEarningsPesewas: -net,
      }),
    ]);
  });
}

/**
 * Take back a driver's earning when the fare is refunded. Idempotent: the
 * presence of a reversal entry is the guard, so double refunds never debit
 * twice. A balance can legitimately go negative here and carries forward.
 */
export async function reverseRideEarning(booking: FsDoc, reason: string): Promise<void> {
  const driverId = booking.data.driverId as string;
  if (!driverId) return;
  if (!booking.data.walletCreditedAt) return;
  if (await hasReversal(booking.id)) return;

  const credit = await findRideCredit(booking.id);
  if (!credit) return;

  const net = Number(credit.data.netPesewas || 0);
  const wasAvailable = credit.data.status === "available";

  await withRetry(async () => {
    if (await hasReversal(booking.id)) return;

    const freshCredit = await getDocument(`driverLedger/${credit.id}`);
    const freshCreditStatus = freshCredit?.data.status;

    await commit([
      createWrite(`driverLedger/${newId()}`, {
        ...ledgerEntry(booking, "reversal", "reversed", -net),
        description: `Reversed: ${reason}`,
      }),
      ...(freshCredit
        ? [
            updateWrite(
              `driverLedger/${freshCredit.id}`,
              { status: "reversed" },
              ["status"],
              freshCredit.updateTime
            ),
          ]
        : []),
      incrementWrite(driverPath(driverId), {
        // Take it back from wherever it currently sits.
        ...(wasAvailable || freshCreditStatus === "available"
          ? { walletBalancePesewas: -net }
          : { pendingEarningsPesewas: -net }),
        lifetimeEarningsPesewas: -net,
      }),
    ]);
  });

  await writeAudit({
    event: "WALLET_REVERSED",
    entityType: "booking",
    entityId: booking.id,
    actorRole: "system",
    amountPesewas: -net,
    meta: { reason },
  });
}

/** Admin balance adjustment (with a reason, always audited). */
export async function adjustDriverBalance(input: {
  driverId: string;
  netPesewas: number;
  description: string;
  actorId: string;
  toPending?: boolean;
}): Promise<void> {
  const field = input.toPending ? "pendingEarningsPesewas" : "walletBalancePesewas";

  await commit([
    createWrite(`driverLedger/${newId()}`, {
      driverId: input.driverId,
      type: "adjustment",
      status: input.toPending ? "pending" : "available",
      grossPesewas: 0,
      commissionPesewas: 0,
      netPesewas: input.netPesewas,
      currency: "GHS",
      description: input.description,
      createdAt: nowIso(),
    }),
    incrementWrite(driverPath(input.driverId), { [field]: input.netPesewas }),
  ]);

  await writeAudit({
    event: "ADMIN_ACTION",
    entityType: "driver",
    entityId: input.driverId,
    actorId: input.actorId,
    actorRole: "admin",
    amountPesewas: input.netPesewas,
    meta: { description: input.description },
  });
}

// ─── Payout holds ─────────────────────────────────────────────────────────

/** Move money out of the withdrawable balance into the payout hold. */
export async function holdFundsForPayout(driverId: string, amountPesewas: number): Promise<void> {
  await withRetry(async () => {
    const driver = await getDocument(driverPath(driverId));
    if (!driver) return;

    const available = Number(driver.data.walletBalancePesewas || 0);
    if (available < amountPesewas) {
      throw new Error("insufficient wallet balance for payout");
    }

    await commit([
      updateWrite(
        driverPath(driverId),
        {
          walletBalancePesewas: available - amountPesewas,
          payoutHoldPesewas: Number(driver.data.payoutHoldPesewas || 0) + amountPesewas,
          updatedAt: nowIso(),
        },
        ["walletBalancePesewas", "payoutHoldPesewas", "updatedAt"],
        driver.updateTime
      ),
    ]);
  });
}

/** Settle a payout: on success the hold disappears, on failure it returns. */
export async function settlePayoutHold(
  driverId: string,
  amountPesewas: number,
  success: boolean
): Promise<void> {
  await withRetry(async () => {
    const driver = await getDocument(driverPath(driverId));
    if (!driver) return;

    const hold = Number(driver.data.payoutHoldPesewas || 0);
    const released = Math.min(hold, amountPesewas);

    await commit([
      updateWrite(
        driverPath(driverId),
        {
          payoutHoldPesewas: hold - released,
          ...(success ? {} : { walletBalancePesewas: Number(driver.data.walletBalancePesewas || 0) + released }),
          updatedAt: nowIso(),
        },
        ["payoutHoldPesewas", ...(success ? [] : ["walletBalancePesewas"]), "updatedAt"],
        driver.updateTime
      ),
    ]);
  });
}
