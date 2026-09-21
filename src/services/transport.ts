import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { db } from "./firebase";
import { Booking, Location, Route, Trip } from "../types/models";
import { bearingDegrees, haversineMeters } from "../utils/geo";
import {
  PaymentsApiError,
  callPaymentsApi,
  cancelBookingViaApi,
  createBookingRequest,
  driverDecideBooking,
  markPickedUp,
  rateDriverViaApi,
  setDriverCapacityViaApi,
} from "./payments";

// ---------------------------------------------------------------------------
// Transport service
//
// Reads stay direct (fast, realtime, and protected by the security rules).
// Every WRITE that touches seats, money, bookings or trips is delegated to the
// backend: the phone is not allowed to decide what a seat costs, whether a
// payment succeeded, or how many seats a driver has left.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Booking requests
// ---------------------------------------------------------------------------

export type CreateBookingInput = {
  passengerId: string;
  driverId: string;
  routeId: string;
  pickupLocation: Location;
  dropOffLocation: Location;
  seats: number;
};

/** Thrown when the driver no longer has enough free seats. */
export class NoSeatsError extends Error {
  constructor() {
    super("This tro-tro is already full. Please pick another ride.");
    this.name = "NoSeatsError";
  }
}

/**
 * Request seats. The backend re-reads the driver's seats, computes the fare
 * from the route, holds the seats and returns the booking id.
 */
export const createBooking = async (booking: CreateBookingInput): Promise<string> => {
  try {
    const result = await createBookingRequest({
      driverId: booking.driverId,
      routeId: booking.routeId,
      seats: booking.seats ?? 1,
      pickupLocation: {
        latitude: booking.pickupLocation?.latitude ?? 0,
        longitude: booking.pickupLocation?.longitude ?? 0,
        address: booking.pickupLocation?.address,
      },
      dropOffLocation: {
        latitude: booking.dropOffLocation?.latitude ?? 0,
        longitude: booking.dropOffLocation?.longitude ?? 0,
        address: booking.dropOffLocation?.address,
      },
    });
    return result.bookingId;
  } catch (error) {
    // Preserve the original no-seats error so existing screens keep working.
    if (error instanceof PaymentsApiError && error.code === "no_seats") {
      throw new NoSeatsError();
    }
    throw error;
  }
};

export const createLocation = (address: string): Location => ({
  latitude: 0,
  longitude: 0,
  address,
});

// ---------------------------------------------------------------------------
// Driver availability & trips (backend-owned, because they move seats)
// ---------------------------------------------------------------------------

export const setDriverAvailability = async (
  _driverId: string,
  online: boolean,
  _seats?: number
) => {
  await callPaymentsApi("setDriverOnline", { online });
};

export const startTrip = async (
  _driverId: string,
  routeId: string,
  direction: "going" | "returning",
  capacity: number = 12
) => {
  const result = await callPaymentsApi<{ tripId: string; availableSeats: number }>("startTrip", {
    routeId,
    direction,
    capacity,
  });
  return result.tripId;
};

/**
 * End an active trip. The backend completes the trip, takes the driver offline
 * and refunds any passenger who paid for a seat on it.
 */
export const endTrip = async (tripId: string, _driverId: string) => {
  await callPaymentsApi("endTrip", { tripId });
};

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

export const setDriverOnline = async (online: boolean) => {
  await callPaymentsApi("setDriverOnline", { online });
};

// ---------------------------------------------------------------------------
// Booking decisions (driver) and lifecycle
// ---------------------------------------------------------------------------

/**
 * Driver accepts a request: the booking moves to awaiting_payment and the
 * passenger gets their payment window.
 */
export const confirmBooking = async (
  bookingId: string,
  _passengerId?: string,
  _routeLabel?: string
) => {
  await driverDecideBooking(bookingId, "accept");
};

export const rejectBooking = async (bookingId: string) => {
  await driverDecideBooking(bookingId, "reject");
};

/**
 * Cancel a booking as either party. Seats and any refund are handled by the
 * backend in one place.
 */
export const cancelBooking = async (
  bookingId: string,
  cancelledBy: string,
  _driverId?: string,
  _passengerId?: string,
  _routeLabel?: string
) => {
  await cancelBookingViaApi(bookingId, cancelledBy === "passenger" ? "passenger" : "driver");
};

/**
 * The driver marks the passenger picked up, or a booking is completed. Both
 * affect refund eligibility, so both run on the backend.
 */
export const updateBookingStatus = async (bookingId: string, status: string) => {
  if (status === "picked_up") {
    await markPickedUp(bookingId);
    return;
  }
  if (status === "completed") {
    await callPaymentsApi("completeBooking", { bookingId });
    return;
  }
  throw new Error("Unsupported booking status change");
};

/**
 * Directly set the driver's available seat count.
 * Called by the driver to adjust capacity at any time.
 */
export const updateDriverSeats = async (_driverId: string, seats: number) => {
  await setDriverCapacityViaApi(Math.max(0, seats));
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
 * Submit a driver rating from a passenger. The average is recomputed by the
 * backend so the driver's rating field stays trustworthy.
 */
export const rateDriver = async (
  tripId: string,
  driverId: string,
  _passengerId: string,
  rating: number
) => {
  await rateDriverViaApi({ tripId, driverId, rating });
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

// Seed initial EasyTroski routes (with placeholder fares an admin can adjust)
export const seedInitialRoutes = async () => {
  const initialRoutes = [
    {
      id: "omanjor-accra",
      origin: "Omanjor",
      destination: "Accra",
      stops: ["Amasaman", "Pokuase", "Achimota"],
      active: true,
      farePesewas: 1000,
    },
    {
      id: "omanjor-lapaz",
      origin: "Omanjor",
      destination: "Lapaz",
      stops: ["Amasaman", "Pokuase"],
      active: true,
      farePesewas: 800,
    },
    {
      id: "omanjor-dome",
      origin: "Omanjor",
      destination: "Dome",
      stops: ["Amasaman"],
      active: true,
      farePesewas: 500,
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
        farePesewas: route.farePesewas,
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
// Housekeeping
// ---------------------------------------------------------------------------

/**
 * Run server-side housekeeping: expired seat holds, expired payment windows,
 * ghost drivers and pending earnings. Safe to call on every app open — the
 * backend guards each release so nothing can happen twice.
 */
export const runCleanupTasks = async () => {
  await callPaymentsApi("runMaintenance", {});
};

/**
 * Called when the driver app comes to the foreground. If this device was gone
 * long enough that its last location write went stale, the backend ends any
 * trip that survived the kill, cancels held bookings and takes the driver
 * offline — passengers must never see a driver who isn't running the app.
 */
export const selfHealAfterRestart = async (_driverId: string) => {
  await callPaymentsApi("driverResumed", {});
};
