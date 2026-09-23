// ---------------------------------------------------------------------------
// Booking + payment state vocabulary
//
// One place defines which states are live, which can still be cancelled, and
// which release held seats — so the booking entrypoint, the webhook and the
// reaper can never disagree with each other.
// ---------------------------------------------------------------------------

export type BookingStatus =
  | "pending"
  | "awaiting_payment"
  | "confirmed"
  | "picked_up"
  | "completed"
  | "cancelled"
  | "expired";

export type PaymentStatus =
  | "not_started"
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "expired";

/** Mirrors Paystack's refund.* webhook states, plus our own claim state. */
export type RefundStatus =
  | "none"
  // Claimed by one caller, which is the only one allowed to call Paystack.
  | "requesting"
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "needs_attention";

/** Bookings that are still holding seats. */
export const HOLDING_STATUSES: BookingStatus[] = ["pending", "awaiting_payment"];

/** Bookings shown as live work to the driver. */
export const ACTIVE_STATUSES: BookingStatus[] = ["pending", "awaiting_payment", "confirmed", "picked_up"];

/** Bookings whose seats have already been paid for. */
export const PAID_STATUSES: BookingStatus[] = ["confirmed", "picked_up", "completed"];

/** Bookings a passenger may have open at once without paying (anti seat-griefing). */
export const MAX_OPEN_UNPAID_BOOKINGS = 1;

/**
 * Trip states in which the vehicle is working. Shared so the seat authority, the
 * trip authority and the booking flow can never disagree about whether a trip
 * is live — a disagreement there is how a seat gets double-counted.
 */
export const LIVE_TRIP_STATUSES = ["online", "boarding", "in_progress", "scheduled"];

export function isLiveTrip(status: unknown): boolean {
  return typeof status === "string" && LIVE_TRIP_STATUSES.includes(status);
}

export function isHoldingSeats(status: unknown): boolean {
  return typeof status === "string" && HOLDING_STATUSES.includes(status as BookingStatus);
}

export function isPaidStatus(status: unknown): boolean {
  return typeof status === "string" && PAID_STATUSES.includes(status as BookingStatus);
}

export function isTerminal(status: unknown): boolean {
  return status === "cancelled" || status === "expired" || status === "completed";
}

/**
 * Can this booking still be cancelled by the given party?
 *
 * Passengers may cancel freely before paying; after paying only while they have
 * not been picked up (which is what triggers the refund). Drivers may cancel
 * any live booking they haven't yet picked up.
 */
export function canCancel(booking: {
  status?: unknown;
  refund?: { status?: string } | null;
}, by: "passenger" | "driver"): { allowed: boolean; reason?: string } {
  const status = booking.status as BookingStatus;

  if (status === "picked_up") return { allowed: false, reason: "picked_up_already" };
  if (isTerminal(status)) return { allowed: false, reason: "booking_wrong_state" };

  if (by === "passenger" && (status === "pending" || status === "awaiting_payment")) {
    return { allowed: true };
  }
  if (by === "driver" && (status === "pending" || status === "awaiting_payment" || status === "confirmed")) {
    return { allowed: true };
  }
  if (status === "confirmed") return { allowed: true };

  return { allowed: false, reason: "booking_wrong_state" };
}

/** A refund is owed whenever money was actually taken. */
export function refundApplies(booking: { paymentStatus?: unknown; status?: unknown }): boolean {
  return booking.paymentStatus === "paid" || isPaidStatus(booking.status);
}
