import {
  addDoc,
  collection,
  doc,
  getDocs,
  getDoc,
  increment,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
  runTransaction,
} from "firebase/firestore";

import { db } from "./firebase";
import { Booking, Location, Route, Trip } from "../types/models";
import { haversineMeters, bearingDegrees } from "../utils/geo";
import {
  notifyDriverOfBooking,
  notifyPassengerOfConfirmation,
  notifyPassengerOfRejection,
  notifyPassengerTripEnded,
} from "./notifications";

/**
 * Normalise a timestamp value (ISO string, Date, number, or Firestore
 * Timestamp) to epoch milliseconds. Returns null when unparseable so callers
 * can skip the record instead of misbehaving — NaN date comparisons are
 * always false, which previously made the expiry cleanup skip valid
 * Firestore Timestamps and (worse) made "created" parsing fragile.
 */
const toMillis = (value: unknown): number | null => {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "object" && "toDate" in (value as object)) {
    try {
      return (value as { toDate: () => Date }).toDate().getTime();
    } catch {
      return null;
    }
  }
  return null;
};

export const getActiveRoutes = async (): Promise<Route[]> => {
  try {
    const routesSnapshot = await getDocs(
      query(
        collection(db, "routes"),
        where("active", "==", true),
        limit(50)
      )
    );

    const routes = routesSnapshot.docs.map((routeDocument) => ({
      id: routeDocument.id,
      ...routeDocument.data(),
    } as Route));

    // Sort routes by origin in JavaScript (to avoid needing Firestore index)
    return routes.sort((a, b) => a.origin.localeCompare(b.origin));
  } catch (error) {
    console.error("Error fetching active routes:", error);
    throw error;
  }
};

export const getRoute = async (routeId: string): Promise<Route | null> => {
  const routeDocument = await getDoc(doc(db, "routes", routeId));

  if (!routeDocument.exists()) {
    return null;
  }

  return {
    id: routeDocument.id,
    ...routeDocument.data(),
  } as Route;
};

export const getAvailableTrips = async (routeId: string): Promise<Trip[]> => {
  const tripsSnapshot = await getDocs(
    query(
      collection(db, "trips"),
      where("routeId", "==", routeId),
      where("status", "in", ["online", "boarding", "in_progress"]),
      limit(20)
    )
  );

  return tripsSnapshot.docs.map((tripDocument) => ({
    id: tripDocument.id,
    ...tripDocument.data(),
  } as Trip));
};

export type CreateBookingInput = Omit<Booking, "id" | "createdAt" | "status">;

/** Thrown when the driver no longer has enough free seats. */
export class NoSeatsError extends Error {
  constructor() {
    super("This tro-tro is already full. Please pick another ride.");
    this.name = "NoSeatsError";
  }
}

/**
 * Create a booking transactionally.
 *
 * The driver's seat count and the booking are written in ONE Firestore
 * transaction that re-reads `availableSeats` at commit time — two passengers
 * racing for the last seat can no longer both succeed, and a failed seat
 * decrement can no longer leave a phantom booking behind.
 *
 * The passenger's name is embedded on the booking so the driver's dashboard
 * never needs to read another user's profile doc.
 */
export const createBooking = async (booking: CreateBookingInput) => {
  // Resolve the passenger's name from their OWN profile (owner-read, always
  // permitted) so drivers see who booked without touching users/{uid}.
  let passengerName = "Passenger";
  try {
    const userDoc = await getDoc(doc(db, "users", booking.passengerId));
    const name = userDoc.exists()
      ? userDoc.data().name || userDoc.data().displayName || ""
      : "";
    if (name) passengerName = name;
  } catch {
    // Name is cosmetic — booking proceeds without it
  }

  const bookingId = await runTransaction(db, async (tx) => {
    const bookingRef = doc(collection(db, "bookings"));

    let seatsLeft = Number.POSITIVE_INFINITY;
    let driverRef: ReturnType<typeof doc> | null = null;
    if (booking.driverId) {
      driverRef = doc(db, "drivers", booking.driverId);
      const driverSnap = await tx.get(driverRef);
      if (driverSnap.exists()) {
        seatsLeft = driverSnap.data().availableSeats ?? 0;
      }
    }

    const requested = booking.seats ?? 1;
    if (requested > seatsLeft) {
      // Aborts the transaction — nothing is written.
      throw new NoSeatsError();
    }

    tx.set(bookingRef, {
      ...booking,
      passengerName,
      status: "pending",
      createdAt: new Date().toISOString(),
    });

    if (driverRef) {
      tx.update(driverRef, { availableSeats: increment(-requested) });
    }
    return bookingRef.id;
  });

  // Notify the driver about the new booking (best-effort, post-commit)
  if (booking.driverId) {
    const routeLabel = booking.pickupLocation?.address
      ? `${booking.pickupLocation.address} → ${booking.dropOffLocation?.address || "destination"}`
      : "a route";
    notifyDriverOfBooking(booking.driverId, passengerName, routeLabel).catch(() => {});
  }

  return bookingId;
};

export const createLocation = (address: string): Location => ({
  latitude: 0,
  longitude: 0,
  address,
});

export const setDriverAvailability = async (
  driverId: string,
  online: boolean,
  seats?: number
) => {
  await setDoc(
    doc(db, "drivers", driverId),
    {
      userId: driverId,
      online,
      status: online ? "online" : "offline",
      ...(seats !== undefined ? { availableSeats: seats } : {}),
    },
    { merge: true }
  );
};

export const startTrip = async (
  driverId: string,
  routeId: string,
  direction: "going" | "returning",
  capacity: number = 12
) => {
  const tripReference = await addDoc(collection(db, "trips"), {
    driverId,
    routeId,
    direction,
    status: "in_progress",
    startTime: new Date().toISOString(),
  });

  // First route a driver ever runs becomes their locked default —
  // afterwards it can only be changed from Profile settings.
  try {
    const driverDoc = await getDoc(doc(db, "drivers", driverId));
    if (driverDoc.exists() && !driverDoc.data().defaultRouteId) {
      await updateDoc(doc(db, "drivers", driverId), {
        defaultRouteId: routeId,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Best-effort — never fail a trip start over the default-route save.
  }

  // Set driver online with full seat capacity
  await setDriverAvailability(driverId, true, capacity);
  return tripReference.id;
};

/**
 * The driver's saved default route id (null when they haven't run a trip yet).
 */
export const getDriverDefaultRoute = async (
  driverId: string
): Promise<string | null> => {
  try {
    const driverDoc = await getDoc(doc(db, "drivers", driverId));
    return driverDoc.exists()
      ? ((driverDoc.data().defaultRouteId as string) || null)
      : null;
  } catch {
    return null;
  }
};

/**
 * Change the driver's default route. Only exposed on the Profile screen —
 * the driver home and map treat the default as locked.
 */
export const updateDriverDefaultRoute = async (
  driverId: string,
  routeId: string
) => {
  await updateDoc(doc(db, "drivers", driverId), {
    defaultRouteId: routeId,
    updatedAt: serverTimestamp(),
  });
};

// ---------------------------------------------------------------------------
// Trip lifecycle
// ---------------------------------------------------------------------------

/**
 * End an active trip. Marks the trip as completed, sets the driver offline,
 * resets available seats to 0, and notifies passengers with active bookings.
 */
export const endTrip = async (tripId: string, driverId: string) => {
  // Update trip status to completed
  await updateDoc(doc(db, "trips", tripId), {
    status: "completed",
    endTime: new Date().toISOString(),
  });

  // Set driver offline and reset seats
  await setDriverAvailability(driverId, false, 0);

  // Cancel all pending/confirmed bookings on this trip and notify passengers
  try {
    const bookingsSnapshot = await getDocs(
      query(
        collection(db, "bookings"),
        where("driverId", "==", driverId),
        where("status", "in", ["pending", "confirmed"]),
        limit(20)
      )
    );

    for (const bookingDoc of bookingsSnapshot.docs) {
      const booking = bookingDoc.data();

      // Auto-cancel the booking
      await updateDoc(doc(db, "bookings", bookingDoc.id), {
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancelledBy: "system",
        cancelReason: "trip_ended",
      });

      // Notify the passenger
      if (booking.passengerId) {
        const routeLabel = booking.pickupLocation?.address
          ? `${booking.pickupLocation.address} → ${booking.dropOffLocation?.address || "destination"}`
          : "your route";
        notifyPassengerTripEnded(booking.passengerId, routeLabel).catch(() => {});
      }
    }
  } catch {
    // Best-effort — don't fail the trip end if cleanup fails
  }
};

/**
 * Update a trip's status. Use this for transitions like
 * online → boarding → in_progress → completed.
 */
export const updateTripStatus = async (
  tripId: string,
  status: string
) => {
  await updateDoc(doc(db, "trips", tripId), {
    status,
    updatedAt: new Date().toISOString(),
  });
};

/**
 * Update a booking's status (confirm, reject, cancel, complete).
 */
export const updateBookingStatus = async (
  bookingId: string,
  status: string
) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    status,
    updatedAt: new Date().toISOString(),
  });
};

/**
 * Confirm a passenger's booking. Called by the driver.
 * Notifies the passenger.
 */
export const confirmBooking = async (
  bookingId: string,
  passengerId?: string,
  routeLabel?: string
) => {
  await updateBookingStatus(bookingId, "confirmed");

  if (passengerId) {
    notifyPassengerOfConfirmation(passengerId, routeLabel || "your route").catch(() => {});
  }
};

/**
 * Cancel a booking. Can be called by passenger or driver.
 * If driverId is provided, increments available seats back.
 * Notifies the passenger if the driver cancelled.
 */
export const cancelBooking = async (
  bookingId: string,
  cancelledBy: string,
  driverId?: string,
  passengerId?: string,
  routeLabel?: string
) => {
  await updateDoc(doc(db, "bookings", bookingId), {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    cancelledBy,
  });

  // Give the seat back to the driver
  if (driverId) {
    try {
      await incrementDriverSeats(driverId);
    } catch {
      // Best-effort — seat increment failure shouldn't block cancellation
    }
  }

  // Notify the passenger if the driver rejected
  if (cancelledBy !== "passenger" && passengerId) {
    notifyPassengerOfRejection(passengerId, routeLabel || "your route").catch(() => {});
  }
};/**
 * Decrement available seats on the driver when a passenger books.
 * Booking creation now handles this transactionally — kept only for
 * potential direct callers.
 */
export const decrementDriverSeats = async (driverId: string) => {
  await updateDoc(doc(db, "drivers", driverId), {
    availableSeats: increment(-1),
  });
};


/**
 * Increment available seats when a booking is cancelled.
 */
export const incrementDriverSeats = async (driverId: string) => {
  await updateDoc(doc(db, "drivers", driverId), {
    availableSeats: increment(1),
  });
};

/**
 * Directly set the driver's available seat count.
 * Called by the driver to adjust capacity at any time.
 */
export const updateDriverSeats = async (driverId: string, seats: number) => {
  await updateDoc(doc(db, "drivers", driverId), {
    availableSeats: Math.max(0, seats),
  });
};

// Last written position per driver — used to derive the direction of
// travel (heading) without an extra Firestore read.
const lastWrittenCoords: Record<string, { latitude: number; longitude: number }> = {};

export const updateDriverLocation = async (
  driverId: string,
  latitude: number,
  longitude: number
) => {
  // Derive heading from the previous fix so passengers can rotate the
  // driver's marker to face the direction of travel.
  const prev = lastWrittenCoords[driverId];
  const heading =
    prev && haversineMeters(prev, { latitude, longitude }) >= 4
      ? bearingDegrees(prev, { latitude, longitude })
      : null;
  lastWrittenCoords[driverId] = { latitude, longitude };

  await setDoc(
    doc(db, "drivers", driverId),
    {
      userId: driverId,
      currentLocation: {
        latitude,
        longitude,
      },
      ...(heading != null ? { heading } : {}),
      locationUpdatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
};

// ---------------------------------------------------------------------------
// Account data queries
// ---------------------------------------------------------------------------

/**
 * Get all bookings for a passenger, most recent first.
 * Joins route data for display.
 */
export const getPassengerBookings = async (
  passengerId: string
): Promise<Booking[]> => {
  const bookingsSnapshot = await getDocs(
    query(
      collection(db, "bookings"),
      where("passengerId", "==", passengerId),
      limit(50)
    )
  );

  const bookings = bookingsSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  } as Booking));

  // Sort by createdAt descending (most recent first)
  return bookings.sort((a, b) => {
    const dateA = a.createdAt instanceof Date ? a.createdAt : new Date(a.createdAt as any);
    const dateB = b.createdAt instanceof Date ? b.createdAt : new Date(b.createdAt as any);
    return dateB.getTime() - dateA.getTime();
  });
};

/**
 * Get all trips for a driver, most recent first.
 * Joins route data for display.
 */
export const getDriverTrips = async (
  driverId: string
): Promise<Trip[]> => {
  const tripsSnapshot = await getDocs(
    query(
      collection(db, "trips"),
      where("driverId", "==", driverId),
      limit(50)
    )
  );

  const trips = tripsSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  } as Trip));

  return trips.sort((a, b) => {
    const dateA = a.startTime instanceof Date ? a.startTime : new Date(a.startTime as any);
    const dateB = b.startTime instanceof Date ? b.startTime : new Date(b.startTime as any);
    return dateB.getTime() - dateA.getTime();
  });
};

/**
 * Get the driver's current active trip (if any).
 */
export const getDriverActiveTrip = async (
  driverId: string
): Promise<Trip | null> => {
  const tripsSnapshot = await getDocs(
    query(
      collection(db, "trips"),
      where("driverId", "==", driverId),
      where("status", "in", ["online", "boarding", "in_progress"]),
      limit(1)
    )
  );

  if (tripsSnapshot.empty) return null;

  const tripDoc = tripsSnapshot.docs[0];
  const trip = { id: tripDoc.id, ...tripDoc.data() } as Trip;

  // Enrich with route info
  if (trip.routeId) {
    const routeDoc = await getDoc(doc(db, "routes", trip.routeId));
    if (routeDoc.exists()) {
      const route = routeDoc.data() as Route;
      trip.origin = route.origin;
      trip.destination = route.destination;
    }
  }

  return trip;
};

/**
 * Submit a driver rating from a passenger.
 */
export const rateDriver = async (
  tripId: string,
  driverId: string,
  passengerId: string,
  rating: number
) => {
  await addDoc(collection(db, "ratings"), {
    tripId,
    driverId,
    passengerId,
    rating,
    createdAt: new Date().toISOString(),
  });

  // Update driver's average rating
  try {
    const ratingsSnapshot = await getDocs(
      query(
        collection(db, "ratings"),
        where("driverId", "==", driverId),
        limit(100)
      )
    );
    const ratings = ratingsSnapshot.docs.map((d) => d.data().rating);
    const avg = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
    await setDoc(
      doc(db, "drivers", driverId),
      { rating: Math.round(avg * 10) / 10 },
      { merge: true }
    );
  } catch {
    // Best-effort — rating was still saved
  }
};

/**
 * Get driver profile data including vehicle info.
 */
export const getDriverProfile = async (
  driverId: string
): Promise<{ driver: any; vehicle: any } | null> => {
  const driverDoc = await getDoc(doc(db, "drivers", driverId));
  if (!driverDoc.exists()) return null;

  const driverData = driverDoc.data();
  let vehicleData = null;

  if (driverData.vehicleId) {
    const vehicleDoc = await getDoc(doc(db, "vehicles", driverData.vehicleId));
    if (vehicleDoc.exists()) {
      vehicleData = { id: vehicleDoc.id, ...vehicleDoc.data() };
    }
  }

  return { driver: { id: driverDoc.id, ...driverData }, vehicle: vehicleData };
};

// Seed initial EasyTroski routes
export const seedInitialRoutes = async () => {
  const initialRoutes = [
    {
      id: "omanjor-accra",
      origin: "Omanjor",
      destination: "Accra",
      stops: ["Amasaman", "Pokuase", "Achimota"],
      active: true,
    },
    {
      id: "omanjor-lapaz",
      origin: "Omanjor",
      destination: "Lapaz",
      stops: ["Amasaman", "Pokuase"],
      active: true,
    },
    {
      id: "omanjor-dome",
      origin: "Omanjor",
      destination: "Dome",
      stops: ["Amasaman"],
      active: true,
    },
  ];

  const createdRoutes: string[] = [];

  for (const route of initialRoutes) {
    try {
      // Check if route already exists
      const existingRoute = await getDoc(doc(db, "routes", route.id));

      if (existingRoute.exists()) {
        console.log(`Route ${route.id} already exists, skipping...`);
        continue;
      }

      // Create the route
      await setDoc(doc(db, "routes", route.id), {
        origin: route.origin,
        destination: route.destination,
        stops: route.stops,
        active: route.active,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      createdRoutes.push(route.id);
      console.log(`Created route: ${route.origin} → ${route.destination}`);
    } catch (error) {
      console.error(`Failed to create route ${route.id}:`, error);
    }
  }

  return createdRoutes;
};

// ---------------------------------------------------------------------------
// Cleanup: stale bookings + inactive drivers
// ---------------------------------------------------------------------------

/**
 * Auto-cancel any bookings that are still "pending" or "confirmed" but whose
 * trip has ended or been cancelled. Run this on app startup.
 */
export const cleanupStaleBookings = async () => {
  try {
    // Get all bookings that are still pending or confirmed
    const bookingsSnapshot = await getDocs(
      query(
        collection(db, "bookings"),
        where("status", "in", ["pending", "confirmed"]),
        limit(50)
      )
    );

    for (const bookingDoc of bookingsSnapshot.docs) {
      const booking = bookingDoc.data();

      // Check if the driver still has an active trip
      if (booking.driverId) {
        const driverDoc = await getDoc(doc(db, "drivers", booking.driverId));
        const driver = driverDoc.exists() ? driverDoc.data() : null;

        // If the driver is offline or missing, the booking may be stale.
        // BUT a stale `online` flag must not cancel a booking for a trip
        // that is still active — passengers book against the trip, and the
        // driver dashboard shows bookings only while a trip is running.
        // Only cancel when the driver is offline AND has no active trip.
        if (!driver || !driver.online) {
          const activeTrips = await getDocs(
            query(
              collection(db, "trips"),
              where("driverId", "==", booking.driverId),
              where("status", "in", ["online", "boarding", "in_progress"]),
              limit(1)
            )
          );

          if (!activeTrips.empty) continue; // trip still live — keep the booking

          await updateDoc(doc(db, "bookings", bookingDoc.id), {
            status: "cancelled",
            cancelledAt: new Date().toISOString(),
            cancelledBy: "system",
            cancelReason: "driver_offline",
          });
        }
      }
    }
  } catch {
    // Best-effort — don't crash the app if cleanup fails
  }
};

/**
 * Auto-offline drivers who haven't updated their location in over 20 minutes.
 * This catches drivers who closed the app without going offline.
 * Run this on app startup or periodically.
 *
 * Threshold: 20 minutes (1,200,000 ms).
 * Driver location is updated every 15 seconds when a trip is active,
 * so 20 minutes means they've been completely inactive.
 */
export const cleanupInactiveDrivers = async () => {
  const INACTIVE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
  const now = Date.now();

  try {
    // Find all drivers who are online
    const driversSnapshot = await getDocs(
      query(
        collection(db, "drivers"),
        where("online", "==", true),
        limit(50)
      )
    );

    for (const driverDoc of driversSnapshot.docs) {
      const driver = driverDoc.data();
      const driverId = driverDoc.id;

      // Check when they last updated their location
      const lastUpdate = driver.locationUpdatedAt;
      if (!lastUpdate) {
        // No location ever recorded — if they're online, they're stale
        await autoOfflineDriver(driverId);
        continue;
      }

      const lastUpdateTime = new Date(lastUpdate).getTime();
      const elapsed = now - lastUpdateTime;

      if (elapsed > INACTIVE_THRESHOLD_MS) {
        console.log(
          `Driver ${driverId} inactive for ${Math.round(elapsed / 60000)} min — auto-offlining`
        );
        await autoOfflineDriver(driverId);
      }
    }
  } catch {
    // Best-effort
  }
};

/**
 * Internal helper: mark a driver offline, end their active trip, and
 * cancel any pending bookings.
 */
async function autoOfflineDriver(driverId: string) {
  try {
    // Set driver offline
    await setDriverAvailability(driverId, false, 0);

    // Find and end any active trip
    const tripsSnapshot = await getDocs(
      query(
        collection(db, "trips"),
        where("driverId", "==", driverId),
        where("status", "in", ["online", "boarding", "in_progress"]),
        limit(5)
      )
    );

    for (const tripDoc of tripsSnapshot.docs) {
      await updateDoc(doc(db, "trips", tripDoc.id), {
        status: "completed",
        endTime: new Date().toISOString(),
        endReason: "auto_inactive",
      });
    }

    // Cancel any pending/confirmed bookings
    const bookingsSnapshot = await getDocs(
      query(
        collection(db, "bookings"),
        where("driverId", "==", driverId),
        where("status", "in", ["pending", "confirmed"]),
        limit(20)
      )
    );

    for (const bookingDoc of bookingsSnapshot.docs) {
      const booking = bookingDoc.data();

      await updateDoc(doc(db, "bookings", bookingDoc.id), {
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancelledBy: "system",
        cancelReason: "driver_inactive",
      });

      if (booking.passengerId) {
        notifyPassengerTripEnded(
          booking.passengerId,
          "your route"
        ).catch(() => {});
      }
    }
  } catch {
    // Best-effort
  }
}

/**
 * Auto-decline bookings that have been pending for over 5 minutes.
 * The driver didn't respond in time — notify the passenger.
 */
export const cleanupExpiredBookings = async () => {
  const EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();

  try {
    const bookingsSnapshot = await getDocs(
      query(
        collection(db, "bookings"),
        where("status", "==", "pending"),
        limit(50)
      )
    );

    for (const bookingDoc of bookingsSnapshot.docs) {
      const booking = bookingDoc.data();

      // Skip bookings whose createdAt can't be parsed (Firestore Timestamp
      // or missing) — cancelling on a bad guess would eat live bookings.
      const createdAtMs = toMillis(booking.createdAt);
      if (createdAtMs === null) continue;

      if (now - createdAtMs > EXPIRY_MS) {
        // Auto-decline the booking
        await updateDoc(doc(db, "bookings", bookingDoc.id), {
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
          cancelledBy: "system",
          cancelReason: "driver_no_response",
        });

        // Give the seat back
        if (booking.driverId) {
          try {
            await incrementDriverSeats(booking.driverId);
          } catch { /* best-effort */ }
        }

        // Notify the passenger
        if (booking.passengerId) {
          const routeLabel = booking.pickupLocation?.address
            ? `${booking.pickupLocation.address} → ${booking.dropOffLocation?.address || "destination"}`
            : "your route";
          notifyPassengerOfRejection(booking.passengerId, routeLabel).catch(() => {});
        }
      }
    }
  } catch {
    // Best-effort
  }
};

/**
 * Run all cleanup tasks. Call this once on app startup.
 */
export const runCleanupTasks = async () => {
  // Run all in parallel — they're independent and best-effort
  await Promise.allSettled([
    cleanupStaleBookings(),
    cleanupInactiveDrivers(),
    cleanupExpiredBookings(),
  ]);
};