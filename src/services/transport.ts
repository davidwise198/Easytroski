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
} from "firebase/firestore";

import { db } from "./firebase";
import { Booking, Location, Route, Trip } from "../types/models";
import {
  notifyDriverOfBooking,
  notifyPassengerOfConfirmation,
  notifyPassengerOfRejection,
  notifyPassengerTripEnded,
} from "./notifications";

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
      where("status", "in", ["online", "in_progress"]),
      limit(20)
    )
  );

  return tripsSnapshot.docs.map((tripDocument) => ({
    id: tripDocument.id,
    ...tripDocument.data(),
  } as Trip));
};

export type CreateBookingInput = Omit<Booking, "id" | "createdAt" | "status">;

export const createBooking = async (booking: CreateBookingInput) => {
  const bookingReference = await addDoc(collection(db, "bookings"), {
    ...booking,
    status: "pending",
    createdAt: new Date().toISOString(),
  });

  // Decrement available seats on the driver
  if (booking.driverId) {
    try {
      await decrementDriverSeats(booking.driverId);
    } catch {
      // Seat decrement is best-effort — booking still succeeded
    }

    // Notify the driver about the new booking (best-effort)
    const routeLabel = booking.pickupLocation?.address
      ? `${booking.pickupLocation.address} → ${booking.dropOffLocation?.address || "destination"}`
      : "a route";
    notifyDriverOfBooking(booking.driverId, "A passenger", routeLabel).catch(() => {});
  }

  return bookingReference.id;
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

  // Set driver online with full seat capacity
  await setDriverAvailability(driverId, true, capacity);
  return tripReference.id;
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
};

/**
 * Decrement available seats on the driver when a passenger books.
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

export const updateDriverLocation = async (
  driverId: string,
  latitude: number,
  longitude: number
) => {
  await setDoc(
    doc(db, "drivers", driverId),
    {
      userId: driverId,
      currentLocation: {
        latitude,
        longitude,
      },
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

        // If driver is offline or doesn't exist, the booking is stale
        if (!driver || !driver.online) {
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
 * Run all cleanup tasks. Call this once on app startup.
 */
export const runCleanupTasks = async () => {
  // Run both in parallel — they're independent and best-effort
  await Promise.allSettled([
    cleanupStaleBookings(),
    cleanupInactiveDrivers(),
  ]);
};