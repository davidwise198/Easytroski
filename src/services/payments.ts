// ---------------------------------------------------------------------------
// Payments API client
//
// The phone NEVER talks to Paystack directly and never holds a secret key.
// Every money or seat decision goes through our Supabase Edge Function, which
// verifies the caller's Firebase ID token, recomputes amounts from trusted
// route data, and is the only thing that can confirm a payment.
//
// One authenticated function handles all actions:
//   POST {EXPO_PUBLIC_PAYMENTS_API_URL}/payments  { action, ...payload }
// Paystack's webhook lives on a separate, public URL.
// ---------------------------------------------------------------------------

import { auth } from "./firebase";

/** Display-only default; the backend is authoritative and rejects early requests. */
export const PAYOUT_CUTOFF_HOUR = 20;

/** Hold/minute windows used to render countdowns; the backend owns the truth. */
export const HOLD_MINUTES = 5;
export const PAYMENT_WINDOW_MINUTES = 5;

/** Local-only constant used to label the checkout while test keys are active. */
export const PAYMENTS_ENV = (process.env.EXPO_PUBLIC_PAYMENTS_ENV || "test") as "test" | "live";

export type PaymentsAction =
  | "createBookingRequest"
  | "driverDecide"
  | "initiateCharge"
  | "submitChargeOtp"
  | "checkPayment"
  | "cancelBooking"
  | "markPickedUp"
  | "completeBooking"
  | "setDriverOnline"
  | "startTrip"
  | "endTrip"
  | "setDriverCapacity"
  | "rateDriver"
  | "driverResumed"
  | "requestPayout"
  | "runMaintenance"
  | "adminResolveRefund"
  | "adminResolvePayout"
  // Mate identity, connection and trip assignment
  | "ensureIds"
  | "mateDriverPreview"
  | "mateJoinRequest"
  | "mateJoinDecide"
  | "mateLeaveDriver"
  | "driverRemoveMate"
  | "assignMate"
  | "unassignMate"
  // Seats on offer (mate, or the driver of the running trip)
  | "setSeatsOffered"
  // Admin: grant or change a role. The only way "admin" is handed out.
  | "adminSetRole"
  // Admin: correct a vehicle's registered seat count (the seat ceiling).
  | "adminSetVehicleCapacity";

/**
 * Errors the backend raises deliberately. Each maps to plain language a
 * Ghanaian passenger or driver can act on — never a raw provider message.
 */
export type PaymentsErrorCode =
  | "not_configured"
  | "not_signed_in"
  | "network"
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
  | "not_authorised"
  | "rate_limited"
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
  | "mate_required"
  | "mate_assigned_to_trip"
  | "trip_not_running"
  | "trip_has_passengers"
  | "seats_over_capacity"
  | "unknown";

const FRIENDLY_MESSAGES: Record<PaymentsErrorCode, string> = {
  not_configured: "Payments are not configured yet. Please update the app.",
  not_signed_in: "Please sign in again to continue.",
  network: "We couldn't reach EasyTroski. Check your connection and try again.",
  no_seats: "This tro-tro is already full. Please pick another ride.",
  driver_offline: "That driver just went offline. Please pick another ride.",
  driver_unavailable: "That driver is no longer available. Please pick another ride.",
  hold_expired: "Nobody answered in time, so your seats were released.",
  payment_window_closed: "Your payment window closed. Please book the seat again.",
  payment_already_paid: "This booking is already paid.",
  payment_in_progress: "We're still checking your payment. Please don't pay again yet.",
  payment_failed: "Payment failed. Your seats were not reserved.",
  charge_failed: "We couldn't start the payment. Please try again.",
  route_unavailable: "That route is not available right now.",
  fare_missing: "This route has no fare set yet. Please contact support.",
  booking_not_found: "We couldn't find that booking.",
  booking_wrong_state: "This booking has already moved on. Please refresh.",
  active_booking_exists:
    "You already have a booking waiting on a driver. Finish or cancel it first.",
  not_your_booking: "That booking isn't yours.",
  not_your_trip: "That trip isn't yours.",
  picked_up_already: "The passenger has already been picked up, so this can't be cancelled.",
  refund_not_allowed: "A refund isn't possible for this booking.",
  payout_too_early: `Withdrawals open at ${formatCutoffHour()} each day.`,
  payout_nothing_to_withdraw: "There's nothing to withdraw yet.",
  payout_in_progress: "A withdrawal is already being processed.",
  missing_momo_details: "Add your Mobile Money details first to receive earnings.",
  momo_number_invalid: "That Mobile Money number doesn't look right.",
  not_authorised: "You don't have permission to do that.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  invalid_driver_code: "That doesn't look like a Driver ID. It should look like ET-DV-48291.",
  driver_not_found: "We couldn't find a driver with that ID. Please check it and try again.",
  already_connected: "You're already connected to this driver.",
  not_connected: "You're not connected to that driver.",
  request_pending: "You've already asked this driver. Please wait for their answer.",
  request_not_found: "We couldn't find that request.",
  request_not_pending: "That request has already been answered.",
  not_your_mate: "That request isn't yours to answer.",
  too_many_requests: "Too many requests for now. Please wait before trying again.",
  mate_profile_missing: "Your mate profile is missing. Please sign in again.",
  mate_busy: "That mate is already working on another trip.",
  // Only ever reached by a driver: passenger decisions belong to the mate.
  mate_required: "Assign a Mate before accepting passenger bookings.",
  mate_assigned_to_trip:
    "There's still a trip running. Finish it before this mate is removed or leaves.",
  trip_not_running: "Start the trip before doing that.",
  trip_has_passengers: "There are still passengers on this trip. Finish them first.",
  seats_over_capacity: "You can't offer more seats than the vehicle holds.",
  unknown: "We couldn't complete that. Please try again.",
};

export function formatCutoffHour(hour: number = PAYOUT_CUTOFF_HOUR): string {
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${suffix}`;
}

export class PaymentsApiError extends Error {
  code: PaymentsErrorCode;
  status?: number;
  details?: unknown;

  constructor(code: PaymentsErrorCode, message?: string, status?: number, details?: unknown) {
    super(message || FRIENDLY_MESSAGES[code] || FRIENDLY_MESSAGES.unknown);
    this.name = "PaymentsApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** Human-readable text for any thrown value. */
export function friendlyPaymentError(error: unknown): string {
  if (error instanceof PaymentsApiError) return error.message;
  if (error instanceof Error && error.message) {
    // Never leak provider/internal wording to a user.
    if (/paystack|firestore|firebase|internal|stack|deno/i.test(error.message)) {
      return FRIENDLY_MESSAGES.unknown;
    }
    return error.message;
  }
  return FRIENDLY_MESSAGES.unknown;
}

function baseUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_PAYMENTS_API_URL;
  return url ? url.replace(/\/+$/, "") : null;
}

export function isPaymentsConfigured(): boolean {
  return baseUrl() !== null;
}

async function idToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new PaymentsApiError("not_signed_in");
  return user.getIdToken();
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Call the backend. `action` selects the operation; the payload is the
 * operation's parameters. Nothing here is trusted by the server — it re-derives
 * prices, ownership and eligibility from Firestore.
 */
export async function callPaymentsApi<T = any>(
  action: PaymentsAction,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const base = baseUrl();
  if (!base) throw new PaymentsApiError("not_configured");

  const token = await idToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${base}/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
  } catch {
    throw new PaymentsApiError("network");
  } finally {
    clearTimeout(timer);
  }

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON response (cold-start HTML, gateway error) — treat by status.
    throw new PaymentsApiError(
      response.status >= 500 ? "network" : "unknown",
      undefined,
      response.status
    );
  }

  if (!response.ok || data?.error) {
    const code = (data?.error as PaymentsErrorCode) || "unknown";
    const known = code in FRIENDLY_MESSAGES ? code : "unknown";
    throw new PaymentsApiError(known, data?.message, response.status, data?.details);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Typed action wrappers
// ---------------------------------------------------------------------------

export type BookingRequestInput = {
  driverId: string;
  routeId: string;
  seats: number;
  pickupLocation: { latitude: number; longitude: number; address?: string };
  dropOffLocation: { latitude: number; longitude: number; address?: string };
};

export type BookingRequestResult = {
  bookingId: string;
  totalPesewas: number;
  farePerSeatPesewas: number;
  seats: number;
  holdExpiresAt: string;
  currency: "GHS";
};

export function createBookingRequest(input: BookingRequestInput) {
  return callPaymentsApi<BookingRequestResult>("createBookingRequest", input as unknown as Record<string, unknown>);
}

export function driverDecideBooking(bookingId: string, decision: "accept" | "reject") {
  return callPaymentsApi<{ bookingId: string; status: string; paymentDeadlineAt?: string }>(
    "driverDecide",
    { bookingId, decision }
  );
}

export type ChargeResult = {
  bookingId: string;
  reference: string;
  /** pay_offline = approve on the phone · send_otp = enter the code · pending = waiting */
  state: "pay_offline" | "send_otp" | "pending" | "success";
  amountPesewas: number;
  displayText?: string;
  /** True when an existing charge is still being verified — do not pay again. */
  alreadyInProgress?: boolean;
};

export function initiateCharge(bookingId: string, momoProvider: string, momoNumber: string) {
  return callPaymentsApi<ChargeResult>("initiateCharge", { bookingId, momoProvider, momoNumber });
}

export function submitChargeOtp(bookingId: string, otp: string) {
  return callPaymentsApi<ChargeResult>("submitChargeOtp", { bookingId, otp });
}

export type PaymentCheckResult = {
  bookingId: string;
  status: string;
  paymentStatus: string;
  paid: boolean;
  amountPesewas?: number;
  refundStatus?: string;
};

export function checkPayment(bookingId: string) {
  return callPaymentsApi<PaymentCheckResult>("checkPayment", { bookingId });
}

export function cancelBookingViaApi(bookingId: string, by: "passenger" | "driver") {
  return callPaymentsApi<{ bookingId: string; status: string; refundStatus?: string }>(
    "cancelBooking",
    { bookingId, by }
  );
}

export function markPickedUp(bookingId: string) {
  return callPaymentsApi<{ bookingId: string; status: string }>("markPickedUp", { bookingId });
}

export function setDriverCapacityViaApi(seats: number) {
  return callPaymentsApi<{ availableSeats: number }>("setDriverCapacity", { seats });
}

export function rateDriverViaApi(input: { tripId: string; driverId: string; rating: number }) {
  return callPaymentsApi<{ rating: number }>("rateDriver", input as unknown as Record<string, unknown>);
}

export type PayoutResult = {
  payoutId: string;
  amountPesewas: number;
  status: string;
  message?: string;
};

export function requestPayout() {
  return callPaymentsApi<PayoutResult>("requestPayout", {});
}

/**
 * Change another account's role. Admin-only, decided server-side: the client
 * cannot write `role` at all any more, so this is the only way to grant one.
 */
export function adminSetUserRoleViaApi(input: { userId: string; role: string }) {
  return callPaymentsApi<{ userId: string; role: string; changed: boolean }>(
    "adminSetRole",
    input as unknown as Record<string, unknown>
  );
}

/**
 * Correct a vehicle's registered seat count. Admin-only, decided server-side:
 * this is the ceiling every seat calculation is measured against, so the driver
 * cannot change it and the dashboard cannot keep its own copy.
 */
export function adminSetVehicleCapacityViaApi(input: {
  driverId: string;
  capacity: number;
  vehicleId?: string | null;
}) {
  return callPaymentsApi<{
    driverId: string;
    capacity: number;
    previousCapacity: number;
    offered: number;
    changed: boolean;
  }>("adminSetVehicleCapacity", input as unknown as Record<string, unknown>);
}

export function adminResolveRefundViaApi(input: {
  bookingId: string;
  outcome: "processed" | "failed";
  note?: string;
}) {
  return callPaymentsApi<{ bookingId: string; refundStatus: string }>(
    "adminResolveRefund",
    input as unknown as Record<string, unknown>
  );
}

export function adminResolvePayoutViaApi(input: {
  payoutId: string;
  otp?: string;
  outcome?: "success" | "failed";
  note?: string;
}) {
  return callPaymentsApi<{ payoutId: string; status: string }>(
    "adminResolvePayout",
    input as unknown as Record<string, unknown>
  );
}
