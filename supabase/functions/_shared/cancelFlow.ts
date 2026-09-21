// ---------------------------------------------------------------------------
// Cancellation
//
// One path for both parties so seat release, refunds and notifications can
// never disagree. Policy (as approved):
//   • before payment      → free cancel, seats released, no money involved
//   • after payment       → full refund while the passenger has not been
//                           picked up; nothing once they have been
//   • driver cancelling   → same refund path, always
// ---------------------------------------------------------------------------

import { commit, getDocument, nowIso, updateWrite, withRetry } from "./firestore.ts";
import { ApiError } from "./errors.ts";
import { notify, writeAudit } from "./audit.ts";
import { canCancel, refundApplies } from "./state.ts";
import { getBookingOrThrow, releaseSeatsOnce } from "./bookings.ts";
import { raiseRefundCore } from "./paymentFlow.ts";

export type CancelOutcome = {
  bookingId: string;
  status: string;
  refundStatus: string;
  refunded: boolean;
};

export async function cancelBookingCore(input: {
  bookingId: string;
  by: "passenger" | "driver";
  actorId: string;
}): Promise<CancelOutcome> {
  const booking = await getBookingOrThrow(input.bookingId);

  if (input.by === "passenger" && booking.data.passengerId !== input.actorId) {
    throw new ApiError("not_your_booking", "That booking isn't yours.", 403);
  }
  if (input.by === "driver" && booking.data.driverId !== input.actorId) {
    throw new ApiError("not_your_trip", "That booking isn't yours.", 403);
  }

  const verdict = canCancel(booking.data, input.by);
  if (!verdict.allowed) {
    if (verdict.reason === "picked_up_already") {
      throw new ApiError(
        "picked_up_already",
        "The passenger has already been picked up, so this can't be cancelled.",
        409
      );
    }
    throw new ApiError("booking_wrong_state", "This booking can't be cancelled now.", 409);
  }

  const reason = input.by === "passenger" ? "cancelled_by_passenger" : "cancelled_by_driver";

  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${booking.id}`);
    if (!fresh) return;

    const currentStatus = String(fresh.data.status || "");
    const stillCancellable =
      currentStatus === "pending" ||
      currentStatus === "awaiting_payment" ||
      currentStatus === "confirmed";
    if (!stillCancellable) return; // already picked up, completed or ended — leave it

    await commit([
      updateWrite(
        `bookings/${booking.id}`,
        {
          status: "cancelled",
          cancelReason: reason,
          cancelledAt: nowIso(),
          cancelledBy: input.actorId,
          updatedAt: nowIso(),
        },
        ["status", "cancelReason", "cancelledAt", "cancelledBy", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  });

  // Seats go back to the driver exactly once.
  await releaseSeatsOnce(booking.id);

  // Money only moves if money was taken.
  let refundStatus = "none";
  let refunded = false;
  if (refundApplies(booking.data)) {
    const refund = await raiseRefundCore({
      bookingId: booking.id,
      reason,
      actorId: input.actorId,
      actorRole: input.by,
    });
    refundStatus = refund.refundStatus;
    refunded = refund.amountPesewas > 0;
  }

  await writeAudit({
    event: "BOOKING_CANCELLED",
    entityType: "booking",
    entityId: booking.id,
    actorId: input.actorId,
    actorRole: input.by,
    amountPesewas: refunded ? Number(booking.data.totalPesewas || 0) : 0,
    meta: { reason, refundStatus },
  });

  const seats = Number(booking.data.seats || 1);

  if (input.by === "driver") {
    await notify({
      recipientId: String(booking.data.passengerId || ""),
      type: "driver_cancelled",
      title: "Driver cancelled your ride",
      body: refunded
        ? "The driver cancelled your ride. Your refund is being processed."
        : "The driver cancelled your ride. No payment was taken.",
      bookingId: booking.id,
    });
  } else {
    await notify({
      recipientId: String(booking.data.driverId || ""),
      type: "passenger_cancelled",
      title: "Booking cancelled",
      body: `${booking.data.passengerName || "Your passenger"} cancelled ${seats} seat(s).`,
      bookingId: booking.id,
    });
    if (refunded) {
      await notify({
        recipientId: String(booking.data.passengerId || ""),
        type: "refund_pending",
        title: "Refund started",
        body: "Your refund is being processed.",
        bookingId: booking.id,
      });
    }
  }

  return { bookingId: booking.id, status: "cancelled", refundStatus, refunded };
}

/**
 * Cancel a booking as a side effect of something else (trip ended, driver went
 * away). No ownership check — the caller has already established authority.
 */
export async function cancelBookingForSystem(input: {
  bookingId: string;
  reason: string;
  notifyPassenger?: boolean;
}): Promise<void> {
  const booking = await getDocument(`bookings/${input.bookingId}`);
  if (!booking) return;

  const status = String(booking.data.status || "");
  if (status === "completed" || status === "cancelled" || status === "expired") return;

  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${input.bookingId}`);
    if (!fresh) return;
    const current = String(fresh.data.status || "");
    if (current === "completed" || current === "cancelled" || current === "expired") return;

    await commit([
      updateWrite(
        `bookings/${input.bookingId}`,
        {
          status: "cancelled",
          cancelReason: input.reason,
          cancelledAt: nowIso(),
          cancelledBy: "system",
          updatedAt: nowIso(),
        },
        ["status", "cancelReason", "cancelledAt", "cancelledBy", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  });

  await releaseSeatsOnce(input.bookingId);

  if (refundApplies(booking.data)) {
    await raiseRefundCore({
      bookingId: input.bookingId,
      reason: input.reason,
      actorRole: "system",
    });
  }

  if (input.notifyPassenger !== false && booking.data.passengerId) {
    await notify({
      recipientId: booking.data.passengerId as string,
      type: refundApplies(booking.data) ? "driver_cancelled" : "trip_ended",
      title: refundApplies(booking.data) ? "Ride ended" : "Trip ended",
      body: refundApplies(booking.data)
        ? "Your ride ended. A refund has been started for the fare you paid."
        : "The trip ended. Your booking was cancelled.",
      bookingId: input.bookingId,
    });
  }
}
