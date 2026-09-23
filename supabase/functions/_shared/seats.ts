// ---------------------------------------------------------------------------
// The seat authority
//
// One counter decides everything: `drivers/{id}.availableSeats` — the number of
// seats this vehicle is offering to NEW bookings right now.
//
//   offered   = drivers/{id}.availableSeats
//   committed = Σ seats of this driver's bookings that are still live AND have
//               no `seatReleasedAt` (a held request still needs its seat)
//   capacity  = drivers/{id}.vehicleCapacity
//
//   INVARIANT:   offered + committed <= capacity, and neither is ever negative
//
// A seat leaves `offered` the moment a request holds it (one commit with the
// booking, compare-and-swap on the driver document) and comes back exactly once
// — ever — through `releaseSeatsOnce()`, which sets `seatReleasedAt` in the same
// commit as the increment. There is deliberately no second flag and no second
// increment path: rejection, hold expiry, payment expiry, cancellation, trip
// end, ghost-driver cleanup and (Phase 4) drop-off all reuse that one guard, so
// no path can return a seat twice or lose one.
//
// Drop-off returns a passenger's seats while the trip carries on, which is what
// lets the vehicle sell them again further along the route.
// ---------------------------------------------------------------------------

import { ApiError } from "./errors.ts";
import { ACTIVE_STATUSES } from "./state.ts";
import {
  commit,
  getDocument,
  nowIso,
  queryDocuments,
  updateWrite,
  type FsDoc,
} from "./firestore.ts";
import { writeAudit } from "./audit.ts";

/** Bookings whose seats count against the vehicle until they are released. */
export const SEAT_STATUSES = ACTIVE_STATUSES;

/** Used when a driver never recorded a vehicle capacity (matches the app). */
export const DEFAULT_VEHICLE_CAPACITY = 12;

/**
 * Whoever is changing the seats on offer. Structural, so the booking actor from
 * `resolveBookingActor()` can be passed straight in.
 */
export type SeatActor = {
  actorId: string;
  actorRole: "driver" | "mate";
  driverId?: string | null;
  tripId?: string | null;
  mateCode?: string | null;
  mateName?: string | null;
};

export type SeatUsage = {
  capacity: number;
  /** Seats on offer to new bookings right now. */
  offered: number;
  /** Seats taken by held, paid or on-board passengers. */
  committed: number;
  /** Seats whose passenger is on board. */
  onBoard: number;
  /** Seats paid for (confirmed + on board). */
  paid: number;
  /** Seats held by requests that are not paid yet. */
  waiting: number;
  /** The most this vehicle could still offer (capacity - committed). */
  maxOffer: number;
};

/**
 * How many seats are free right now — the single answer to that question.
 *
 * Read-only: it never changes anything, so it is safe to call for a display, a
 * guard, or an audit line.
 */
export async function readSeatUsage(driverId: string): Promise<SeatUsage> {
  const driver = await getDocument(`drivers/${driverId}`);
  return usageFrom(driver, await seatConsumingBookings(driverId));
}

/** The driver's bookings that are still holding seats (unreleased). */
async function seatConsumingBookings(driverId: string): Promise<FsDoc[]> {
  const bookings = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "driverId", value: driverId }],
    limit: 60,
  });

  return bookings.filter(
    (booking) =>
      !booking.data.seatReleasedAt && SEAT_STATUSES.includes(booking.data.status as never)
  );
}

function usageFrom(driver: FsDoc | null, bookings: FsDoc[]): SeatUsage {
  const capacity = Math.max(
    1,
    Math.round(Number(driver?.data.vehicleCapacity || DEFAULT_VEHICLE_CAPACITY))
  );
  const offered = Math.max(0, Math.round(Number(driver?.data.availableSeats || 0)));

  let committed = 0;
  let onBoard = 0;
  let paid = 0;
  let waiting = 0;

  for (const booking of bookings) {
    const seats = Math.max(0, Math.round(Number(booking.data.seats || 0)));
    committed += seats;
    const status = String(booking.data.status);
    if (status === "picked_up") onBoard += seats;
    if (status === "confirmed" || status === "picked_up") paid += seats;
    if (status === "pending" || status === "awaiting_payment") waiting += seats;
  }

  return {
    capacity,
    offered,
    committed,
    onBoard,
    paid,
    waiting,
    maxOffer: Math.max(0, capacity - committed),
  };
}

/**
 * Check a requested "seats on offer" value against the invariant and return the
 * usage it was checked against.
 *
 * Refusing rather than clamping is deliberate: silently offering fewer seats
 * than asked would look like a bug to the person who asked, and silently
 * offering more would overbook the vehicle.
 */
export async function assertOfferAllowed(
  driverId: string,
  requested: number
): Promise<SeatUsage> {
  if (!Number.isFinite(requested)) {
    throw new ApiError("invalid_request", "That seat number doesn't look right.", 400);
  }

  const seats = Math.round(requested);
  if (seats < 0) {
    throw new ApiError("invalid_request", "Seats on offer cannot be negative.", 400);
  }

  const usage = await readSeatUsage(driverId);

  if (seats + usage.committed > usage.capacity) {
    throw new ApiError(
      "seats_over_capacity",
      usage.committed > 0
        ? `This vehicle takes ${usage.capacity} passengers, and ${usage.committed} seat${
            usage.committed > 1 ? "s are" : " is"
          } already taken. You can offer at most ${usage.maxOffer}.`
        : `This vehicle takes ${usage.capacity} passengers, so you can offer at most ${usage.capacity}.`,
      409,
      { ...usage, requested: seats }
    );
  }

  return usage;
}

/**
 * Set the seats on offer, bounded by the invariant, and record who did it.
 *
 * The write is a compare-and-swap on the driver document, so a booking taken at
 * the same moment cannot be silently overwritten.
 */
export async function writeSeatsOffered(
  driverId: string,
  seats: number,
  actor: SeatActor
): Promise<SeatUsage> {
  const usage = await assertOfferAllowed(driverId, seats);
  const next = Math.round(seats);

  if (next === usage.offered) return usage;

  const driver = await getDocument(`drivers/${driverId}`);
  if (!driver) throw new ApiError("driver_unavailable", "Your driver profile is missing.", 404);

  // Re-check against the freshest read inside the same commit path: if a booking
  // landed in between, the compare-and-swap fails and withRetry re-reads.
  const fresh = await readSeatUsage(driverId);
  if (next + fresh.committed > fresh.capacity) {
    throw new ApiError(
      "seats_over_capacity",
      fresh.committed > 0
        ? `This vehicle takes ${fresh.capacity} passengers, and ${fresh.committed} seat${
            fresh.committed > 1 ? "s are" : " is"
          } already taken. You can offer at most ${fresh.maxOffer}.`
        : `This vehicle takes ${fresh.capacity} passengers, so you can offer at most ${fresh.capacity}.`,
      409,
      { ...fresh, requested: next }
    );
  }

  await commit([
    updateWrite(
      `drivers/${driverId}`,
      { availableSeats: next, updatedAt: nowIso() },
      ["availableSeats", "updatedAt"],
      driver.updateTime
    ),
  ]);

  await writeAudit({
    event: "SEATS_OFFERED_SET",
    entityType: "driver",
    entityId: driverId,
    actorId: actor.actorId,
    actorRole: actor.actorRole,
    meta: {
      driverId,
      tripId: actor.tripId ?? null,
      mateId: actor.actorRole === "mate" ? actor.actorId : null,
      mateCode: actor.mateCode ?? null,
      previousOffered: usage.offered,
      offered: next,
      committed: fresh.committed,
      capacity: fresh.capacity,
    },
  });

  return { ...fresh, offered: next };
}

/** A short audit line whenever seats come back because a passenger left. */
export async function auditSeatsReleased(input: {
  booking: FsDoc;
  seats: number;
  actor: SeatActor;
  reason: string;
  usage: SeatUsage;
}): Promise<void> {
  await writeAudit({
    event: "SEATS_RELEASED",
    entityType: "booking",
    entityId: input.booking.id,
    actorId: input.actor.actorId,
    actorRole: input.actor.actorRole,
    meta: {
      driverId: String(input.booking.data.driverId || ""),
      tripId: input.actor.tripId ?? (input.booking.data.tripId ?? null),
      mateId: input.actor.actorRole === "mate" ? input.actor.actorId : null,
      mateCode: input.actor.mateCode ?? null,
      seats: input.seats,
      reason: input.reason,
      offeredAfter: input.usage.offered,
      committedAfter: input.usage.committed,
      capacity: input.usage.capacity,
    },
  });
}
