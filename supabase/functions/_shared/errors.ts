// ---------------------------------------------------------------------------
// API errors
//
// We return stable machine codes plus a safe human message. Raw provider text
// (Paystack, Google) is logged for us and never sent to a passenger.
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "not_signed_in"
  | "not_authorised"
  | "no_seats"
  | "driver_offline"
  | "driver_unavailable"
  | "hold_expired"
  | "payment_window_closed"
  | "payment_already_paid"
  | "payment_in_progress"
  | "payment_failed"
  | "charge_failed"
  | "route_unavailable"
  | "fare_missing"
  | "booking_not_found"
  | "booking_wrong_state"
  | "active_booking_exists"
  | "not_your_booking"
  | "not_your_trip"
  | "picked_up_already"
  | "refund_not_allowed"
  | "payout_too_early"
  | "payout_nothing_to_withdraw"
  | "payout_in_progress"
  | "missing_momo_details"
  | "momo_number_invalid"
  | "invalid_request"
  | "rate_limited"
  | "conflict"
  // ─── Mate identity, connection and assignment ──────────────────────────
  | "invalid_driver_code"
  | "driver_not_found"
  | "already_connected"
  | "not_connected"
  | "request_pending"
  | "request_not_found"
  | "request_not_pending"
  | "not_your_mate"
  | "too_many_requests"
  | "mate_profile_missing"
  | "mate_busy"
  | "mate_assigned_to_trip"
  | "trip_not_running"
  | "trip_has_passengers"
  | "unknown";

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ApiErrorCode, message?: string, status = 400, details?: unknown) {
    super(message || code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Thrown when a compare-and-swap write lost a race and should be retried. */
export class ConflictError extends Error {
  constructor(message = "concurrent modification") {
    super(message);
    this.name = "ConflictError";
  }
}
