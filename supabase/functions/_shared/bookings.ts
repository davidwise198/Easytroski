// ---------------------------------------------------------------------------
// Booking core
//
// Owns seat truth. Seats are held the moment a request is created (the existing
// `availableSeats` counter is the single source of seat truth — no second
// system), released exactly once, and never released twice.
// ---------------------------------------------------------------------------

import {
  commit,
  createWrite,
  getDocument,
  incrementWrite,
  isoPlusMinutes,
  newId,
  nowIso,
  queryDocuments,
  toMillis,
  updateWrite,
  type FsDoc,
  withRetry,
} from "./firestore.ts";
import { HOLD_MINUTES, PAYMENT_WINDOW_MINUTES, DRIVER_STALE_MINUTES } from "./env.ts";
import { computeTotal } from "./money.ts";
import { ApiError } from "./errors.ts";
import { notify, writeAudit } from "./audit.ts";
import { HOLDING_STATUSES, MAX_OPEN_UNPAID_BOOKINGS } from "./state.ts";
import { makeEarningAvailable } from "./wallet.ts";
import { actorMeta, resolveBookingActor } from "./mates.ts";

export const MAX_SEATS_PER_BOOKING = 3;

export async function getBooking(bookingId: string): Promise<FsDoc | null> {
  return getDocument(`bookings/${bookingId}`);
}

export async function getBookingOrThrow(bookingId: string): Promise<FsDoc> {
  const booking = await getBooking(bookingId);
  if (!booking) throw new ApiError("booking_not_found", "We couldn't find that booking.", 404);
  return booking;
}

export function referenceForBooking(bookingId: string): string {
  return `ET-BOOKING-${bookingId.slice(0, 8).toUpperCase()}`;
}

function isFresh(value: unknown, minutes: number): boolean {
  const millis = toMillis(value);
  if (millis === null) return false;
  return Date.now() - millis < minutes * 60_000;
}

const ACTIVE_TRIP_STATUSES = ["online", "boarding", "in_progress", "scheduled"];

/** The driver's running trip, if any (used to stamp bookings). */
export async function getActiveTripForDriver(driverId: string): Promise<FsDoc | null> {
  const trips = await queryDocuments({
    collection: "trips",
    filters: [{ field: "driverId", value: driverId }],
    limit: 10,
  });
  return trips.find((trip) => ACTIVE_TRIP_STATUSES.includes(String(trip.data.status))) ?? null;
}

async function countOpenUnpaidBookings(passengerId: string): Promise<number> {
  let count = 0;
  for (const status of HOLDING_STATUSES) {
    const rows = await queryDocuments({
      collection: "bookings",
      filters: [
        { field: "passengerId", value: passengerId },
        { field: "status", value: status },
      ],
      limit: MAX_OPEN_UNPAID_BOOKINGS + 1,
    });
    count += rows.length;
  }
  return count;
}

export type CreateBookingInput = {
  passengerId: string;
  passengerName: string;
  passengerPhone?: string;
  driverId: string;
  routeId: string;
  seats: number;
  pickupLocation: { latitude: number; longitude: number; address?: string };
  dropOffLocation: { latitude: number; longitude: number; address?: string };
};

/**
 * Create a booking request and hold the seats.
 *
 * Price is computed here from the route's admin-set fare — never from the
 * client — and the seat decrement shares one commit with the booking creation,
 * guarded by a compare-and-swap on the driver document, so two passengers can
 * never take the same last seat.
 */
export async function createBookingRequest(input: CreateBookingInput): Promise<{
  bookingId: string;
  totalPesewas: number;
  farePerSeatPesewas: number;
  holdExpiresAt: string;
}> {
  const seats = Math.round(input.seats);
  if (!Number.isFinite(seats) || seats < 1 || seats > MAX_SEATS_PER_BOOKING) {
    throw new ApiError("invalid_request", `You can book between 1 and ${MAX_SEATS_PER_BOOKING} seats.`, 400);
  }

  const route = await getDocument(`routes/${input.routeId}`);
  if (!route || route.data.active === false) {
    throw new ApiError("route_unavailable", "That route is not available right now.", 400);
  }
  const farePerSeatPesewas = Number(route.data.farePesewas || 0);
  if (!farePerSeatPesewas) {
    throw new ApiError("fare_missing", "This route has no fare set yet.", 409);
  }

  const openUnpaid = await countOpenUnpaidBookings(input.passengerId);
  if (openUnpaid >= MAX_OPEN_UNPAID_BOOKINGS) {
    throw new ApiError(
      "active_booking_exists",
      "You already have a booking waiting on a driver. Finish or cancel it first.",
      409
    );
  }

  const totalPesewas = computeTotal(farePerSeatPesewas, seats);
  const bookingId = newId();
  const holdExpiresAt = isoPlusMinutes(HOLD_MINUTES);
  const trip = await getActiveTripForDriver(input.driverId);

  // Read visibility only: while a mate is working this trip, the booking names
  // them so the security rules can grant that one mate read access. Authority
  // never comes from here — resolveBookingActor() re-checks the live assignment
  // on every action.
  const mateId =
    trip && trip.data.mateActive !== false && trip.data.mateId ? String(trip.data.mateId) : null;
  const mateName =
    typeof trip?.data.mateName === "string" && trip.data.mateName ? trip.data.mateName : null;

  await withRetry(async () => {
    const driver = await getDocument(`drivers/${input.driverId}`);
    if (!driver) throw new ApiError("driver_unavailable", "That driver is no longer available.", 404);

    if (driver.data.online !== true) {
      throw new ApiError("driver_offline", "That driver just went offline. Please pick another ride.", 409);
    }
    if (!isFresh(driver.data.locationUpdatedAt, DRIVER_STALE_MINUTES)) {
      throw new ApiError("driver_unavailable", "That driver is no longer live. Please pick another ride.", 409);
    }

    const available = Number(driver.data.availableSeats || 0);
    if (available < seats) {
      throw new ApiError("no_seats", "This tro-tro is already full. Please pick another ride.", 409);
    }

    await commit([
      createWrite(`bookings/${bookingId}`, {
        passengerId: input.passengerId,
        passengerName: input.passengerName || "Passenger",
        passengerPhone: input.passengerPhone ?? null,
        driverId: input.driverId,
        routeId: input.routeId,
        tripId: trip?.id ?? null,
        mateId,
        mateName,
        pickupLocation: input.pickupLocation,
        dropOffLocation: input.dropOffLocation,
        seats,
        status: "pending",
        paymentStatus: "not_started",
        farePerSeatPesewas,
        totalPesewas,
        currency: "GHS",
        paymentRef: referenceForBooking(bookingId),
        seatHoldExpiresAt: holdExpiresAt,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }),
      updateWrite(
        `drivers/${input.driverId}`,
        { availableSeats: available - seats },
        ["availableSeats"],
        driver.updateTime
      ),
    ]);
  });

  await writeAudit({
    event: "BOOKING_CREATED",
    entityType: "booking",
    entityId: bookingId,
    actorId: input.passengerId,
    actorRole: "passenger",
    amountPesewas: totalPesewas,
    meta: { driverId: input.driverId, routeId: input.routeId, seats },
  });

  await notify({
    recipientId: input.driverId,
    type: "booking_request",
    title: "New booking request",
    body: `${input.passengerName || "A passenger"} wants ${seats} seat${seats > 1 ? "s" : ""}.`,
    bookingId,
  });

  return { bookingId, totalPesewas, farePerSeatPesewas, holdExpiresAt };
}

/**
 * Return held seats to the driver. Both the booking flag and the seat count
 * move in one commit, so a retry, a webhook and the reaper can all call this
 * and only one will ever take effect.
 */
export async function releaseSeatsOnce(bookingId: string): Promise<boolean> {
  return withRetry(async () => {
    const booking = await getDocument(`bookings/${bookingId}`);
    if (!booking) return false;
    if (booking.data.seatReleasedAt) return false;

    const seats = Number(booking.data.seats || 0);
    const driverId = booking.data.driverId as string;

    await commit([
      updateWrite(
        `bookings/${bookingId}`,
        { seatReleasedAt: nowIso(), updatedAt: nowIso() },
        ["seatReleasedAt", "updatedAt"],
        booking.updateTime
      ),
      ...(driverId && seats > 0
        ? [incrementWrite(`drivers/${driverId}`, { availableSeats: seats })]
        : []),
    ]);

    return true;
  });
}

export type DecisionResult = { status: string; paymentDeadlineAt?: string };

/**
 * Accept or reject a request.
 *
 * Authority — resolved against live data, never taken from the caller:
 *   · the booking's own driver, so a trip with no mate still works
 *   · the mate assigned to that driver's running trip
 */
export async function driverDecide(
  bookingId: string,
  actorUid: string,
  decision: "accept" | "reject"
): Promise<DecisionResult> {
  const booking = await getBookingOrThrow(bookingId);
  const actor = await resolveBookingActor(booking, actorUid);

  if (booking.data.status !== "pending") {
    throw new ApiError("booking_wrong_state", "This request has already been handled.", 409);
  }

  const holdExpiry = toMillis(booking.data.seatHoldExpiresAt);
  if (holdExpiry !== null && Date.now() > holdExpiry) {
    // The passenger's hold already lapsed: close it out and tell them why.
    await releaseSeatsOnce(bookingId);
    await withRetry(async () => {
      const fresh = await getDocument(`bookings/${bookingId}`);
      if (!fresh || fresh.data.status !== "pending") return;
      await commit([
        updateWrite(
          `bookings/${bookingId}`,
          {
            status: "cancelled",
            cancelReason: "driver_no_response",
            cancelledAt: nowIso(),
            cancelledBy: "system",
            updatedAt: nowIso(),
          },
          ["status", "cancelReason", "cancelledAt", "cancelledBy", "updatedAt"],
          fresh.updateTime
        ),
      ]);
    });
    await notify({
      recipientId: booking.data.passengerId as string,
      type: "booking_expired",
      title: "Request expired",
      body: "The driver didn't respond in time, so your seats were released.",
      bookingId,
    });
    throw new ApiError("hold_expired", "That request already expired.", 409);
  }

  if (decision === "reject") {
    await withRetry(async () => {
      const fresh = await getDocument(`bookings/${bookingId}`);
      if (!fresh || fresh.data.status !== "pending") return;
      await commit([
        updateWrite(
          `bookings/${bookingId}`,
          {
            status: "cancelled",
            cancelReason: "rejected_by_driver",
            cancelledAt: nowIso(),
            cancelledBy: actor.actorId,
            lastActionBy: actor.actorId,
            lastActionByRole: actor.actorRole,
            lastActionAt: nowIso(),
            updatedAt: nowIso(),
          },
          [
            "status",
            "cancelReason",
            "cancelledAt",
            "cancelledBy",
            "lastActionBy",
            "lastActionByRole",
            "lastActionAt",
            "updatedAt",
          ],
          fresh.updateTime
        ),
      ]);
    });
    await releaseSeatsOnce(bookingId);

    await writeAudit({
      event: "BOOKING_REJECTED",
      entityType: "booking",
      entityId: bookingId,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      meta: actorMeta(actor),
    });
    await notify({
      recipientId: booking.data.passengerId as string,
      type: "booking_rejected",
      title: "Request declined",
      body: "Your booking request was not accepted by the driver.",
      bookingId,
    });

    return { status: "cancelled" };
  }

  // Accept: give the passenger their payment window. The seats stay held.
  const paymentDeadlineAt = isoPlusMinutes(PAYMENT_WINDOW_MINUTES);
  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${bookingId}`);
    if (!fresh || fresh.data.status !== "pending") {
      throw new ApiError("booking_wrong_state", "This request has already been handled.", 409);
    }
    await commit([
      updateWrite(
        `bookings/${bookingId}`,
        {
          status: "awaiting_payment",
          paymentDeadlineAt,
          seatHoldExpiresAt: paymentDeadlineAt,
          lastActionBy: actor.actorId,
          lastActionByRole: actor.actorRole,
          lastActionAt: nowIso(),
          updatedAt: nowIso(),
        },
        [
          "status",
          "paymentDeadlineAt",
          "seatHoldExpiresAt",
          "lastActionBy",
          "lastActionByRole",
          "lastActionAt",
          "updatedAt",
        ],
        fresh.updateTime
      ),
    ]);
  });

  await writeAudit({
    event: "BOOKING_ACCEPTED",
    entityType: "booking",
    entityId: bookingId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    amountPesewas: Number(booking.data.totalPesewas || 0),
    meta: actorMeta(actor),
  });
  await notify({
    recipientId: booking.data.passengerId as string,
    type: "booking_accepted",
    title: "Booking accepted",
    body: "Complete payment to secure your seat.",
    bookingId,
  });

  return { status: "awaiting_payment", paymentDeadlineAt };
}

/** The driver or the trip's mate marks the passenger as picked up. */
export async function markPickedUp(bookingId: string, actorUid: string): Promise<void> {
  const booking = await getBookingOrThrow(bookingId);
  const actor = await resolveBookingActor(booking, actorUid);
  if (booking.data.status !== "confirmed") {
    throw new ApiError("booking_wrong_state", "Only a paid booking can be marked as picked up.", 409);
  }

  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${bookingId}`);
    if (!fresh || fresh.data.status !== "confirmed") return;
    await commit([
      updateWrite(
        `bookings/${bookingId}`,
        {
          status: "picked_up",
          pickedUpAt: nowIso(),
          lastActionBy: actor.actorId,
          lastActionByRole: actor.actorRole,
          lastActionAt: nowIso(),
          updatedAt: nowIso(),
        },
        ["status", "pickedUpAt", "lastActionBy", "lastActionByRole", "lastActionAt", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  });

  await writeAudit({
    event: "BOOKING_PICKED_UP",
    entityType: "booking",
    entityId: bookingId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    meta: actorMeta(actor),
  });
}

/** Driver or trip mate ends the ride: the driver's earnings become withdrawable. */
export async function completeBooking(bookingId: string, actorUid: string): Promise<void> {
  const booking = await getBookingOrThrow(bookingId);
  const actor = await resolveBookingActor(booking, actorUid);
  if (booking.data.status !== "picked_up" && booking.data.status !== "confirmed") {
    throw new ApiError("booking_wrong_state", "This booking can't be completed.", 409);
  }

  await withRetry(async () => {
    const fresh = await getDocument(`bookings/${bookingId}`);
    if (!fresh || fresh.data.status === "completed") return;
    await commit([
      updateWrite(
        `bookings/${bookingId}`,
        {
          status: "completed",
          completedAt: nowIso(),
          lastActionBy: actor.actorId,
          lastActionByRole: actor.actorRole,
          lastActionAt: nowIso(),
          updatedAt: nowIso(),
        },
        ["status", "completedAt", "lastActionBy", "lastActionByRole", "lastActionAt", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  });

  await writeAudit({
    event: "BOOKING_COMPLETED",
    entityType: "booking",
    entityId: bookingId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    amountPesewas: Number(booking.data.totalPesewas || 0),
    meta: actorMeta(actor),
  });

  const fresh = await getBooking(bookingId);
  if (fresh) await makeEarningAvailable(fresh);
}

// ─── Expiry sweep ─────────────────────────────────────────────────────────

export type ExpirySweepResult = { expiredRequests: number; expiredPayments: number };

/**
 * Release seats for requests the driver never answered and for payment windows
 * that closed. Safe to run from a cron, the webhook or any user action: every
 * release is guarded by `seatReleasedAt`.
 */
export async function expireStaleHolds(): Promise<ExpirySweepResult> {
  const now = Date.now();
  const result: ExpirySweepResult = { expiredRequests: 0, expiredPayments: 0 };

  const pending = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "status", value: "pending" }],
    limit: 40,
  });

  for (const booking of pending) {
    const expiry = toMillis(booking.data.seatHoldExpiresAt);
    if (expiry === null || expiry > now) continue;

    await withRetry(async () => {
      const fresh = await getDocument(`bookings/${booking.id}`);
      if (!fresh || fresh.data.status !== "pending") return;
      await commit([
        updateWrite(
          `bookings/${booking.id}`,
          {
            status: "cancelled",
            cancelReason: "driver_no_response",
            cancelledAt: nowIso(),
            cancelledBy: "system",
            updatedAt: nowIso(),
          },
          ["status", "cancelReason", "cancelledAt", "cancelledBy", "updatedAt"],
          fresh.updateTime
        ),
      ]);
    });
    await releaseSeatsOnce(booking.id);
    await notify({
      recipientId: booking.data.passengerId as string,
      type: "booking_expired",
      title: "Request expired",
      body: "The driver didn't respond in time, so your seats were released.",
      bookingId: booking.id,
    });
    result.expiredRequests += 1;
  }

  const awaiting = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "status", value: "awaiting_payment" }],
    limit: 40,
  });

  for (const booking of awaiting) {
    const deadline = toMillis(booking.data.paymentDeadlineAt);
    if (deadline === null || deadline > now) continue;

    await withRetry(async () => {
      const fresh = await getDocument(`bookings/${booking.id}`);
      if (!fresh || fresh.data.status !== "awaiting_payment") return;
      await commit([
        updateWrite(
          `bookings/${booking.id}`,
          {
            status: "expired",
            paymentStatus: "expired",
            cancelReason: "payment_expired",
            updatedAt: nowIso(),
          },
          ["status", "paymentStatus", "cancelReason", "updatedAt"],
          fresh.updateTime
        ),
      ]);
    });
    await releaseSeatsOnce(booking.id);
    await notify({
      recipientId: booking.data.passengerId as string,
      type: "payment_expired",
      title: "Payment window closed",
      body: "Your seats were released because payment wasn't completed in time.",
      bookingId: booking.id,
    });
    result.expiredPayments += 1;
  }

  return result;
}
