// User roles in the system
export type UserRole = "passenger" | "driver" | "mate" | "admin";


// ---------------------------------------------------------------------------
// Booking lifecycle
//
// Ride lifecycle only. Money lives in `PaymentStatus` and `Refund` so a single
// fact is never stored twice:
//   status        -> where the ride is
//   paymentStatus -> where the charge is
//   refund        -> where the money going back is
// ---------------------------------------------------------------------------

export type BookingStatus =
  /** Passenger requested seats; driver has not answered yet. Seats are held. */
  | "pending"
  /** Driver approved; waiting for the passenger to pay inside the window. */
  | "awaiting_payment"
  /** Payment verified by the backend. Seats are permanently reserved. */
  | "confirmed"
  | "picked_up"
  | "completed"
  /** Closed without a ride. `cancelReason` says who/why. */
  | "cancelled"
  /** Payment window closed with no verified payment. Seats released. */
  | "expired";

/** Why a booking ended, so cancellations stay distinguishable. */
export type BookingCancelReason =
  | "rejected_by_driver"
  | "cancelled_by_passenger"
  | "cancelled_by_driver"
  | "driver_no_response"
  | "payment_expired"
  | "payment_failed"
  | "trip_ended"
  | "driver_offline";


export type PaymentStatus =
  | "not_started"
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "expired";

/**
 * Paystack refund states, mapped 1:1 to its refund.* webhook events — plus
 * `requesting`, which is the backend's own claim: one caller has taken
 * responsibility for this refund and is talking to Paystack right now.
 */
export type RefundStatus =
  | "none"
  | "requesting"
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "needs_attention";

export interface Refund {
  status: RefundStatus;
  /** Amount returned to the passenger, in pesewas. */
  amountPesewas: number;
  reason?: BookingCancelReason | string;
  /** Paystack refund id, used to poll GET /refund/:id. */
  providerRefundId?: number;
  customerNote?: string;
  merchantNote?: string;
  requestedAt?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}


// Driver trip status
export type TripStatus =
  | "offline"
  | "online"
  | "scheduled"
  | "boarding"
  | "in_progress"
  | "completed"
  | "cancelled";


export type TripDirection =
  | "going"
  | "returning";

// Basic location structure
export interface Location {
  latitude: number;
  longitude: number;
  address?: string;
}


// Main user account
export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  photoURL?: string;
  role: UserRole;
  createdAt: Date;
}


// Vehicle information
export interface Vehicle {
  id: string;
  driverId: string;
  numberPlate: string;
  color: string;
  brand?: string;
  capacity: number;
  active: boolean;
}


/** Ghana mobile money networks Paystack supports for collections and payouts. */
export type MomoProvider = "mtn" | "vod" | "atl";


// Driver profile
export interface Driver {
  id: string;
  userId: string;
  vehicleId?: string;

  name?: string;
  email?: string;
  phone?: string;

  routeId?: string;

  online: boolean;
  status: TripStatus;

  availableSeats: number;

  currentLocation?: Location;

  /** ISO timestamp of the driver's last GPS publish - liveness signal for ghost-driver filtering */
  locationUpdatedAt?: string;

  /** Compass bearing of travel, written alongside the location fix. */
  heading?: number;

  rating?: number;

  /** Route locked as this driver's default (changeable only in Profile settings). */
  defaultRouteId?: string;

  /**
   * Permanent public Driver ID, e.g. ET-DV-48291. Written by the backend the
   * first time a driver needs one and shared with a mate so they can ask to
   * join. It identifies — it never authorises anything on its own.
   */
  driverCode?: string;

  // ─── Payout details (required at driver onboarding) ──────────────────────
  momoProvider?: MomoProvider;
  momoNumber?: string;

  // ─── Wallet (backend-owned; the app only reads these) ───────────────────
  /** Withdrawable balance in pesewas (earned on completed rides). */
  walletBalancePesewas?: number;
  /** Earned but not yet withdrawable: the ride hasn't been completed. */
  pendingEarningsPesewas?: number;
  /** Committed to a payout that is still in flight. */
  payoutHoldPesewas?: number;
  /** Lifetime net earnings in pesewas. */
  lifetimeEarningsPesewas?: number;
  momoVerifiedAt?: string;

  // Vehicle details written at driver onboarding (no separate vehicles doc
  // exists in this app — the join by vehicleId only serves admin-created
  // vehicles, which most drivers never have).
  vehicleRegistration?: string;
  vehicleColor?: string;
  vehicleCapacity?: number;
}


// Passenger profile
export interface Passenger {
  id: string;
  userId: string;
}

// ─── Mate ─────────────────────────────────────────────────────────────────
//
// Two separate relationships, deliberately not merged:
//   MateConnection  — this mate may work with this driver (can last months)
//   Trip.mateId     — this mate is working that one trip (ends with it)

export type MateStatus = "active" | "suspended";

export interface Mate {
  id: string;
  userId: string;
  name: string;
  phone?: string;
  /** Permanent public Mate ID, e.g. ET-MT-18432. Backend-assigned. */
  mateCode?: string;
  status: MateStatus;
  createdAt?: Date | string;
  updatedAt?: string;
}

export type MateConnectionStatus = "active" | "left" | "removed";

export interface MateConnection {
  id: string;
  driverId: string;
  mateId: string;
  driverName?: string;
  driverCode?: string;
  mateName?: string;
  mateCode?: string;
  status: MateConnectionStatus;
  createdAt?: string;
  endedAt?: string | null;
  endedBy?: string | null;
}

export type MateJoinRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

export interface MateJoinRequest {
  id: string;
  driverId: string;
  driverCode?: string | null;
  driverName?: string | null;
  mateId: string;
  mateName?: string | null;
  mateCode?: string | null;
  status: MateJoinRequestStatus;
  createdAt?: string;
  decidedAt?: string;
  decidedBy?: string;
}


// Route information
export interface Route {
  id: string;

  origin: string;
  destination: string;

  stops: string[];

  active: boolean;

  /**
   * Fare per seat in pesewas (1 GHS = 100 pesewas). Set by an admin in the
   * admin console; the backend reads this - never the client - to compute what
   * a booking costs.
   */
  farePesewas?: number;
}


// Passenger booking
export interface Booking {
  id: string;

  passengerId: string;
  driverId: string;

  /** Passenger's display name, embedded at creation so drivers never need to read other users' profiles. */
  passengerName?: string;
  /** Passenger's contact number, embedded at creation (owner-read rules block cross-user reads). */
  passengerPhone?: string;
  routeId: string;

  /** Trip this booking belongs to, stamped once the driver's trip is running. */
  tripId?: string;

  pickupLocation: Location;
  dropOffLocation: Location;

  seats: number;

  status: BookingStatus;
  cancelReason?: BookingCancelReason | string;

  // ─── Money (all amounts are integer pesewas) ────────────────────────────
  farePerSeatPesewas?: number;
  totalPesewas?: number;
  currency?: "GHS";
  /** EasyTroski reference shared with Paystack: ET-BOOKING-XXXXXXXX */
  paymentRef?: string;
  paymentStatus?: PaymentStatus;
  paidAt?: string;
  /** True once the driver's wallet was credited for this booking. */
  walletCreditedAt?: string;
  refund?: Refund;

  // ─── Seat hold / timers ────────────────────────────────────────────────
  /** While set, the seats are held for this booking and released when it passes. */
  seatHoldExpiresAt?: string;
  /** After driver approval, the passenger must pay within this deadline. */
  paymentDeadlineAt?: string;
  /** Set exactly once when the seats are returned, so seats can never be double-credited. */
  seatReleasedAt?: string;
  /** Set once the ride completes, when the driver's earnings become withdrawable. */
  earningsAvailableAt?: string;

  createdAt: Date | string;
  updatedAt?: string;
  cancelledAt?: Date | string;
  cancelledBy?: string;

  // ─── Attribution (who last acted: the driver or the trip's mate) ───────
  lastActionBy?: string;
  lastActionByRole?: UserRole;
  lastActionAt?: string;
}


// ─── Payments ─────────────────────────────────────────────────────────────

export interface Payment {
  id: string;
  bookingId: string;
  passengerId: string;
  driverId: string;

  amountPesewas: number;
  currency: "GHS";

  provider: "paystack";
  channel: "mobile_money";
  providerCode: MomoProvider;
  payerPhone: string;

  /** EasyTroski reference, reused for every retry of this booking's charge. */
  reference: string;
  /** Paystack transaction id, needed to raise a refund. */
  providerTransactionId?: number;
  providerAuthorizationUrl?: string;

  status: PaymentStatus;
  gatewayResponse?: string;
  /** Last raw status payload, kept for dispute investigation. Never holds secrets. */
  lastStatusPayload?: Record<string, unknown>;

  initiatedAt?: string;
  verifiedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}


// ─── Driver wallet ────────────────────────────────────────────────────────

export type LedgerEntryType = "credit" | "reversal" | "payout" | "adjustment";
export type LedgerEntryStatus = "pending" | "available" | "reversed" | "paid_out";

export interface LedgerEntry {
  id: string;
  driverId: string;
  bookingId?: string;
  payoutId?: string;

  type: LedgerEntryType;
  status: LedgerEntryStatus;

  /** What the passenger paid, in pesewas (0 for adjustments). */
  grossPesewas: number;
  /** EasyTroski's cut, in pesewas. */
  commissionPesewas: number;
  /** gross - commission: what the driver keeps. Negative for reversals. */
  netPesewas: number;
  currency: "GHS";

  description?: string;
  /** Set for credits: when this becomes withdrawable (after the ride completes). */
  availableAt?: string;

  createdAt: string;
}


export type PayoutStatus =
  | "requested"
  | "processing"
  | "success"
  | "failed"
  | "needs_otp";

export interface Payout {
  id: string;
  driverId: string;

  amountPesewas: number;
  currency: "GHS";

  momoProvider: MomoProvider;
  momoNumber: string;

  /** Paystack transfer recipient code (RCP_...), created once per driver. */
  recipientCode?: string;
  transferCode?: string;
  reference?: string;

  status: PayoutStatus;
  failureReason?: string;

  requestedAt: string;
  processedAt?: string;
  completedAt?: string;
}


// ─── Notifications (written by the backend, read by the app) ──────────────

export type NotificationType =
  | "booking_request"
  | "booking_accepted"
  | "booking_rejected"
  | "payment_confirmed"
  | "payment_failed"
  | "payment_expired"
  | "driver_cancelled"
  | "passenger_cancelled"
  | "refund_pending"
  | "refund_completed"
  | "payout_paid"
  | "trip_ended"
  // Mate connection + assignment
  | "mate_request"
  | "mate_accepted"
  | "mate_rejected"
  | "mate_assigned"
  | "mate_unassigned"
  | "mate_removed"
  | "mate_left";

export interface AppNotification {
  id: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  bookingId?: string;
  payoutId?: string;
  read: boolean;
  createdAt: string;
}


// Driver trip session
export interface Trip {
  id: string;

  driverId: string;

  routeId: string;

  status: TripStatus;

  direction: TripDirection;

  // ─── Mate working this trip (assignment — not the connection) ──────────
  /** The mate on this trip. Kept once set, so history outlives the assignment. */
  mateId?: string;
  mateName?: string;
  mateCode?: string;
  /** True only while the mate is actually working the trip. */
  mateActive?: boolean;
  mateAssignedAt?: string;
  mateUnassignedAt?: string | null;

  startTime?: Date;
  endTime?: Date;

  // Map-related fields (populated via joins, not stored on trip)
  driverName?: string;
  vehiclePlate?: string;
  vehicleColor?: string;
  vehicleBrand?: string;
  vehicleCapacity?: number;
  origin?: string;
  destination?: string;
}


// Active trip marker data shown on the passenger map
export interface ActiveTripMarker {
  trip: Trip;
  driverLocation: Location;
  availableSeats: number;
  /** Plate + color come from the driver doc (onboarding data) */
  vehiclePlate?: string;
  vehicleColor?: string;
  /** ISO time of the driver's last GPS write - lets the UI prune drivers whose app died between snapshots */
  locationUpdatedAt?: string | null;
  /** Fare per seat in pesewas, joined from the route so the passenger sees the price before booking. */
  farePesewas?: number;
}


// Driver location document in Firestore
export interface DriverLocation {
  latitude: number;
  longitude: number;
  updatedAt: string; // ISO timestamp
}
