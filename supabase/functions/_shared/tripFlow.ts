// ---------------------------------------------------------------------------
// Trip lifecycle + maintenance
//
// Seat counts and trip teardown live here because they decide whether money has
// to move. Ending a trip with paid passengers on board must raise refunds, so it
// can't be a client-side write.
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
  withRetry,
} from "./firestore.ts";
import { ApiError } from "./errors.ts";
import { notify, writeAudit } from "./audit.ts";
import { DRIVER_STALE_MINUTES } from "./env.ts";
import { expireStaleHolds, getActiveTripForDriver } from "./bookings.ts";
import { cancelBookingForSystem } from "./cancelFlow.ts";
import { makeEarningAvailable } from "./wallet.ts";
import { clearMateOnTripEnd, ensureDriverCode } from "./mates.ts";

const LIVE_BOOKING_STATUSES = ["pending", "awaiting_payment", "confirmed", "picked_up"];

/** Driver toggles availability without starting a trip. */
export async function setDriverOnlineCore(driverId: string, online: boolean): Promise<{ online: boolean }> {
  const driver = await getDocument(`drivers/${driverId}`);
  if (!driver) throw new ApiError("driver_unavailable", "Your driver profile is missing.", 404);

  await commit([
    updateWrite(
      `drivers/${driverId}`,
      {
        online,
        status: online ? "online" : "offline",
        // An offline driver advertises no seats at all.
        ...(online ? {} : { availableSeats: 0 }),
        updatedAt: nowIso(),
      },
      ["online", "status", ...(online ? [] : ["availableSeats"]), "updatedAt"],
      driver.updateTime
    ),
  ]);

  if (!online) await releaseHeldBookings(driverId, "driver_offline");

  return { online };
}

/**
 * Start a trip: create the trip, go online and advertise the vehicle's seats.
 * The first route a driver ever runs becomes their locked default.
 */
export async function startTripCore(input: {
  driverId: string;
  routeId: string;
  direction: "going" | "returning";
  capacity: number;
}): Promise<{ tripId: string; availableSeats: number }> {
  const driver = await getDocument(`drivers/${input.driverId}`);
  if (!driver) throw new ApiError("driver_unavailable", "Your driver profile is missing.", 404);

  const existing = await getActiveTripForDriver(input.driverId);
  if (existing) {
    throw new ApiError("booking_wrong_state", "You already have a trip running.", 409);
  }

  // A driver must have a Driver ID before a mate can ask to join them. Getting
  // one can never be the reason a trip fails, so a failure here is ignored.
  await ensureDriverCode(input.driverId).catch(() => {});

  const tripId = newId();
  const capacity = Math.max(1, Math.round(input.capacity || Number(driver.data.vehicleCapacity || 12)));

  await commit([
    createWrite(`trips/${tripId}`, {
      driverId: input.driverId,
      routeId: input.routeId,
      direction: input.direction,
      status: "in_progress",
      startTime: nowIso(),
      createdAt: nowIso(),
    }),
    updateWrite(
      `drivers/${input.driverId}`,
      {
        online: true,
        status: "in_progress",
        availableSeats: capacity,
        ...(driver.data.defaultRouteId ? {} : { defaultRouteId: input.routeId }),
        updatedAt: nowIso(),
      },
      ["online", "status", "availableSeats", "defaultRouteId", "updatedAt"],
      driver.updateTime
    ),
  ]);

  return { tripId, availableSeats: capacity };
}

/** Driver changes how many seats they are offering (backend-owned field). */
export async function setDriverCapacityCore(driverId: string, seats: number): Promise<{ availableSeats: number }> {
  const driver = await getDocument(`drivers/${driverId}`);
  if (!driver) throw new ApiError("driver_unavailable", "Your driver profile is missing.", 404);

  const capacity = Number(driver.data.vehicleCapacity || 0);
  const requested = Math.max(0, Math.round(seats));
  if (capacity > 0 && requested > capacity + 0) {
    throw new ApiError("invalid_request", `Your vehicle seats ${capacity}.`, 400);
  }

  await commit([
    updateWrite(
      `drivers/${driverId}`,
      { availableSeats: requested, updatedAt: nowIso() },
      ["availableSeats", "updatedAt"],
      driver.updateTime
    ),
  ]);

  return { availableSeats: requested };
}

/**
 * End the trip: the driver goes offline, held requests are dropped, and any
 * passenger who already paid gets a refund.
 */
export async function endTripCore(
  driverId: string,
  tripId: string
): Promise<{ cancelled: number; refunded: number }> {
  const driver = await getDocument(`drivers/${driverId}`);
  if (!driver) throw new ApiError("driver_unavailable", "Your driver profile is missing.", 404);

  const trip = await getDocument(`trips/${tripId}`);
  if (trip && trip.data.driverId !== driverId) {
    throw new ApiError("not_your_trip", "That trip isn't yours.", 403);
  }

  let cancelled = 0;
  let refunded = 0;

  if (trip && trip.data.status !== "completed" && trip.data.status !== "cancelled") {
    await commit([
      updateWrite(
        `trips/${tripId}`,
        { status: "completed", endTime: nowIso(), updatedAt: nowIso() },
        ["status", "endTime", "updatedAt"],
        trip.updateTime
      ),
    ]);
  }

  // The mate stops working now; the trip keeps their id as its record.
  if (trip && trip.data.mateId && trip.data.mateActive !== false) {
    await clearMateOnTripEnd(trip);
  }

  // Offline with no seats on offer.
  const fresh = await getDocument(`drivers/${driverId}`);
  if (fresh) {
    await commit([
      updateWrite(
        `drivers/${driverId}`,
        { online: false, status: "offline", availableSeats: 0, updatedAt: nowIso() },
        ["online", "status", "availableSeats", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  }

  const bookings = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "driverId", value: driverId }],
    limit: 50,
  });

  for (const booking of bookings) {
    const status = String(booking.data.status || "");
    if (!LIVE_BOOKING_STATUSES.includes(status)) continue;

    const wasPaid = booking.data.paymentStatus === "paid";
    await cancelBookingForSystem({ bookingId: booking.id, reason: "trip_ended" });
    cancelled += 1;
    if (wasPaid) refunded += 1;
  }

  // Any ride that completed but whose earnings never moved to available.
  const completed = await queryDocuments({
    collection: "bookings",
    filters: [
      { field: "driverId", value: driverId },
      { field: "status", value: "completed" },
    ],
    limit: 20,
  });
  for (const booking of completed) {
    if (booking.data.walletCreditedAt && !booking.data.earningsAvailableAt) {
      await makeEarningAvailable(booking);
    }
  }

  await writeAudit({
    event: "DRIVER_AUTO_OFFLINE",
    entityType: "driver",
    entityId: driverId,
    actorId: driverId,
    actorRole: "driver",
    meta: { tripId, cancelled, refunded, action: "end_trip" },
  });

  return { cancelled, refunded };
}

/** Cancel everything unpaid this driver is holding (no refunds involved). */
async function releaseHeldBookings(driverId: string, reason: string): Promise<number> {
  const bookings = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "driverId", value: driverId }],
    limit: 50,
  });

  let cancelled = 0;
  for (const booking of bookings) {
    const status = String(booking.data.status || "");
    if (status !== "pending" && status !== "awaiting_payment") continue;
    await cancelBookingForSystem({ bookingId: booking.id, reason });
    cancelled += 1;
  }
  return cancelled;
}

export type MaintenanceResult = {
  expiredRequests: number;
  expiredPayments: number;
  driversOffline: number;
  bookingsCancelled: number;
  earningsReleased: number;
};

/**
 * Housekeeping, run from a schedule and opportunistically on every request:
 * expired holds, ghost drivers who stopped publishing GPS, and completed rides
 * whose earnings still need releasing.
 */
export async function runMaintenance(): Promise<MaintenanceResult> {
  const result: MaintenanceResult = {
    expiredRequests: 0,
    expiredPayments: 0,
    driversOffline: 0,
    bookingsCancelled: 0,
    earningsReleased: 0,
  };

  const expired = await expireStaleHolds();
  result.expiredRequests = expired.expiredRequests;
  result.expiredPayments = expired.expiredPayments;

  // Ghost drivers: online but their device stopped reporting.
  const onlineDrivers = await queryDocuments({
    collection: "drivers",
    filters: [{ field: "online", value: true }],
    limit: 50,
  });

  const cutoff = Date.now() - DRIVER_STALE_MINUTES * 60_000;
  for (const driver of onlineDrivers) {
    const lastSeen = toMillis(driver.data.locationUpdatedAt);
    if (lastSeen === null) {
      // Never reported a location: nothing to show passengers, so drop offline.
      await offlineDriver(driver.id);
      result.driversOffline += 1;
      continue;
    }
    if (lastSeen < cutoff) {
      const cancelled = await offlineDriver(driver.id);
      result.driversOffline += 1;
      result.bookingsCancelled += cancelled;
    }
  }

  // Safety net for rides completed while the app was offline.
  const completed = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "status", value: "completed" }],
    limit: 40,
  });
  for (const booking of completed) {
    if (booking.data.walletCreditedAt && !booking.data.earningsAvailableAt) {
      await makeEarningAvailable(booking);
      result.earningsReleased += 1;
    }
  }

  return result;
}

/** Take a driver offline and clean up everything they were holding. */
async function offlineDriver(driverId: string): Promise<number> {
  const driver = await getDocument(`drivers/${driverId}`);
  if (!driver) return 0;

  await commit([
    updateWrite(
      `drivers/${driverId}`,
      { online: false, status: "offline", availableSeats: 0, updatedAt: nowIso() },
      ["online", "status", "availableSeats", "updatedAt"],
      driver.updateTime
    ),
  ]);

  const trip = await getActiveTripForDriver(driverId);
  if (trip) {
    await commit([
      updateWrite(
        `trips/${trip.id}`,
        {
          status: "completed",
          endTime: nowIso(),
          endReason: "auto_inactive",
          updatedAt: nowIso(),
        },
        ["status", "endTime", "endReason", "updatedAt"],
        trip.updateTime
      ),
    ]);

    if (trip.data.mateId && trip.data.mateActive !== false) {
      await clearMateOnTripEnd(trip);
    }
  }

  const bookings = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "driverId", value: driverId }],
    limit: 50,
  });

  let cancelled = 0;
  for (const booking of bookings) {
    const status = String(booking.data.status || "");
    if (!LIVE_BOOKING_STATUSES.includes(status)) continue;
    await cancelBookingForSystem({ bookingId: booking.id, reason: "driver_offline" });
    cancelled += 1;
  }

  await writeAudit({
    event: "DRIVER_AUTO_OFFLINE",
    entityType: "driver",
    entityId: driverId,
    actorRole: "system",
    meta: { cancelled },
  });

  return cancelled;
}
