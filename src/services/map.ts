import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "./firebase";

// ---------------------------------------------------------------------------
// User name cache — avoids repeated Firestore reads for the same driver
// ---------------------------------------------------------------------------
const userNameCache = new Map<string, string>();

async function resolveUserName(userId: string): Promise<string> {
  const cached = userNameCache.get(userId);
  if (cached) return cached;

  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (userDoc.exists()) {
      const name = userDoc.data().name || userDoc.data().displayName || "";
      if (name) {
        userNameCache.set(userId, name);
        return name;
      }
    }
  } catch { /* best-effort */ }

  // Fallback: try drivers collection
  try {
    const driverDoc = await getDoc(doc(db, "drivers", userId));
    if (driverDoc.exists()) {
      const driverData = driverDoc.data();
      const name = driverData.name || "";
      if (name) {
        userNameCache.set(userId, name);
        return name;
      }
      // Drivers store the names of passengers they carry, keyed by uid
      const known = driverData.passengerNames?.[userId];
      if (known) {
        userNameCache.set(userId, known);
        return known;
      }
    }
  } catch { /* best-effort */ }

  // Fallback: passenger profile document
  try {
    const passengerDoc = await getDoc(doc(db, "passengers", userId));
    if (passengerDoc.exists()) {
      const name = passengerDoc.data().name || "";
      if (name) {
        userNameCache.set(userId, name);
        return name;
      }
    }
  } catch { /* best-effort */ }

  return "Passenger";
}
import {
  ActiveTripMarker,
  Driver,
  Route,
  Trip,
  Vehicle,
} from "../types/models";

// ---------------------------------------------------------------------------
// Active trips with joined driver + vehicle data (passenger map)
// ---------------------------------------------------------------------------

/**
 * Fetch active trips for a specific route, joined with driver and vehicle data.
 * Returns markers ready to display on the passenger map.
 *
 * "active" = status is "online", "boarding", or "in_progress"
 * (maps to the driver dashboard statuses the driver sets)
 */
export async function getActiveTripMarkers(
  routeId?: string
): Promise<ActiveTripMarker[]> {
  const statuses = ["online", "boarding", "in_progress"];

  let tripQuery;
  if (routeId) {
    tripQuery = query(
      collection(db, "trips"),
      where("routeId", "==", routeId),
      where("status", "in", statuses),
      limit(20)
    );
  } else {
    tripQuery = query(
      collection(db, "trips"),
      where("status", "in", statuses),
      limit(30)
    );
  }

  const tripsSnapshot = await getDocs(tripQuery);
  const markers: ActiveTripMarker[] = [];

  for (const tripDoc of tripsSnapshot.docs) {
    const trip = { id: tripDoc.id, ...tripDoc.data() } as Trip;

    // Join driver profile for location + available seats
    const driverDoc = await getDoc(doc(db, "drivers", trip.driverId));
    if (!driverDoc.exists()) continue;

    const driver = driverDoc.data() as Driver;
    if (!driver.currentLocation) continue;

    // Join vehicle for display info
    let vehicle: Vehicle | undefined;
    if (driver.vehicleId) {
      const vehicleDoc = await getDoc(doc(db, "vehicles", driver.vehicleId));
      if (vehicleDoc.exists()) {
        vehicle = { id: vehicleDoc.id, ...vehicleDoc.data() } as Vehicle;
      }
    }

    // Get route info for display
    let routeData: Route | undefined;
    if (trip.routeId) {
      const routeDoc = await getDoc(doc(db, "routes", trip.routeId));
      if (routeDoc.exists()) {
        routeData = { id: routeDoc.id, ...routeDoc.data() } as Route;
      }
    }      const driverName = await resolveUserName(trip.driverId);

      markers.push({
      trip: {
        ...trip,
        driverName,
        // Prefer onboarding data on the driver doc; admin vehicles doc as fallback
        vehiclePlate: driver.vehicleRegistration || vehicle?.numberPlate,
        vehicleColor: driver.vehicleColor || vehicle?.color,
        vehicleBrand: vehicle?.brand,
        vehicleCapacity: vehicle?.capacity,
        origin: routeData?.origin,
        destination: routeData?.destination,
      },
      driverLocation: driver.currentLocation,
      availableSeats: driver.availableSeats ?? 0,
    });
  }

  return markers;
}

/**
 * Subscribe to real-time active trip updates for a specific route.
 * Returns an unsubscribe function.
 */
export function subscribeActiveTripMarkers(
  routeId: string,
  onUpdate: (markers: ActiveTripMarker[]) => void,
  onError?: (error: Error) => void
): () => void {
  const statuses = ["online", "boarding", "in_progress"];
  const tripQuery = query(
    collection(db, "trips"),
    where("routeId", "==", routeId),
    where("status", "in", statuses),
    limit(20)
  );

  return onSnapshot(
    tripQuery,
    async (snapshot) => {
    const markers: ActiveTripMarker[] = [];

    for (const tripDoc of snapshot.docs) {
      const trip = { id: tripDoc.id, ...tripDoc.data() } as Trip;

      const driverDoc = await getDoc(doc(db, "drivers", trip.driverId));
      if (!driverDoc.exists()) continue;

      const driver = driverDoc.data() as Driver;
      if (!driver.currentLocation) continue;

      let vehicle: Vehicle | undefined;
      if (driver.vehicleId) {
        const vehicleDoc = await getDoc(doc(db, "vehicles", driver.vehicleId));
        if (vehicleDoc.exists()) {
          vehicle = { id: vehicleDoc.id, ...vehicleDoc.data() } as Vehicle;
        }
      }

      let routeData: Route | undefined;
      if (trip.routeId) {
        const routeDoc = await getDoc(doc(db, "routes", trip.routeId));
        if (routeDoc.exists()) {
          routeData = { id: routeDoc.id, ...routeDoc.data() } as Route;
        }
      }

      const driverName = await resolveUserName(trip.driverId);

      markers.push({
        trip: {
          ...trip,
          driverName,
          // Prefer onboarding data on the driver doc; admin vehicles doc as fallback
          vehiclePlate: driver.vehicleRegistration || vehicle?.numberPlate,
          vehicleColor: driver.vehicleColor || vehicle?.color,
          vehicleBrand: vehicle?.brand,
          vehicleCapacity: vehicle?.capacity,
          origin: routeData?.origin,
          destination: routeData?.destination,
        },      driverLocation: driver.currentLocation,
      availableSeats: driver.availableSeats ?? 0,
    });
    }

    onUpdate(markers);
    },
    (error) => {
      // A failed listener (e.g. missing Firestore index) previously died
      // silently, leaving the map permanently empty with no clue why.
      console.error("[map] active-trips listener failed:", error);
      onError?.(error);
    }
  );
}

// ---------------------------------------------------------------------------
// Driver's own trip data (driver map)
// ---------------------------------------------------------------------------

/**
 * Get the driver's active trip (if any) with joined route info.
 */
export async function getDriverActiveTrip(
  driverId: string
): Promise<Trip | null> {
  const tripQuery = query(
    collection(db, "trips"),
    where("driverId", "==", driverId),
    where("status", "in", ["online", "boarding", "in_progress"]),
    limit(1)
  );

  const snapshot = await getDocs(tripQuery);
  if (snapshot.empty) return null;

  const tripDoc = snapshot.docs[0];
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
}

/**
 * Subscribe to the driver's active trip in real-time.
 */
export function subscribeDriverActiveTrip(
  driverId: string,
  onUpdate: (trip: Trip | null) => void,
  onError?: (error: Error) => void
): () => void {
  const tripQuery = query(
    collection(db, "trips"),
    where("driverId", "==", driverId),
    where("status", "in", ["online", "boarding", "in_progress"]),
    limit(1)
  );

  return onSnapshot(
    tripQuery,
    async (snapshot) => {
      if (snapshot.empty) {
        onUpdate(null);
        return;
      }

    const tripDoc = snapshot.docs[0];
    const trip = { id: tripDoc.id, ...tripDoc.data() } as Trip;

    if (trip.routeId) {
      const routeDoc = await getDoc(doc(db, "routes", trip.routeId));
      if (routeDoc.exists()) {
        const route = routeDoc.data() as Route;
        trip.origin = route.origin;
        trip.destination = route.destination;
      }
    }

      onUpdate(trip);
    },
    (error) => {
      // Surface listener failures — silent death here makes the driver
      // dashboard show no active trip and no bookings with zero feedback.
      console.error("[map] driver active-trip listener failed:", error);
      onError?.(error);
    }
  );
}

/**
 * Get bookings for an active trip (driver map — shows relevant passengers).
 */
export async function getTripBookings(tripId: string) {
  const bookingsQuery = query(
    collection(db, "bookings"),
    where("tripId", "==", tripId),
    limit(20)
  );

  // If bookings don't have a tripId yet (current schema uses driverId + routeId),
  // we fall back to querying by driverId on the trip
  const snapshot = await getDocs(bookingsQuery);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Get passenger pickup locations for a driver's active trip.
 * Returns pickup coordinates + passenger name for map markers.
 */
export async function getDriverPickupLocations(
  driverId: string
): Promise<Array<{ id: string; latitude: number; longitude: number; passengerName: string; seats: number; status: string }>> {
  const bookingsQuery = query(
    collection(db, "bookings"),
    where("driverId", "==", driverId),
    where("status", "in", ["pending", "confirmed"]),
    limit(20)
  );

  const snapshot = await getDocs(bookingsQuery);
  const pickups: Array<{ id: string; latitude: number; longitude: number; passengerName: string; seats: number; status: string }> = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.pickupLocation?.latitude && data.pickupLocation?.longitude) {
      // Embedded name first — users/{uid} reads are owner/admin-only now.
      const passengerName =
        data.passengerName || (await resolveUserName(data.passengerId));
      pickups.push({
        id: doc.id,
        latitude: data.pickupLocation.latitude,
        longitude: data.pickupLocation.longitude,
        passengerName,
        seats: data.seats || 1,
        status: data.status,
      });
    }
  }

  return pickups;
}

/**
 * Subscribe to a driver's real-time location updates.
 * Used by passengers to track the driver after booking.
 */
/**
 * Live position of the driver a passenger is tracking. Extends the raw
 * coordinates with direction-of-travel and the time the driver's device
 * last published a fix, so callers can animate movement and ignore stale
 * points (e.g. leftovers from a previous session).
 */
export type TrackedDriverLocation = {
  latitude: number;
  longitude: number;
  /** Compass bearing in degrees (0 = north), or null when stationary/unknown */
  heading: number | null;
  /** ISO timestamp of the driver's last GPS write, or null if never reported */
  updatedAt: string | null;
};

export function subscribeDriverLocation(
  driverId: string,
  onUpdate: (location: TrackedDriverLocation | null) => void
): () => void {
  return onSnapshot(doc(db, "drivers", driverId), (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      if (data.currentLocation) {
        onUpdate({
          latitude: data.currentLocation.latitude,
          longitude: data.currentLocation.longitude,
          heading: typeof data.heading === "number" ? data.heading : null,
          updatedAt: typeof data.locationUpdatedAt === "string" ? data.locationUpdatedAt : null,
        });
      } else {
        onUpdate(null);
      }
    } else {
      onUpdate(null);
    }
  });
}

/**
 * Subscribe to a driver's active bookings in real-time.
 * Resolves passenger names from the users collection.
 */
export function subscribeDriverBookings(
  driverId: string,
  onUpdate: (bookings: any[]) => void,
  onError?: (error: Error) => void
): () => void {
  // Live work only — completed and cancelled bookings belong in the trips
  // history, not on the driver's working map.
  const bookingsQuery = query(
    collection(db, "bookings"),
    where("driverId", "==", driverId),
    where("status", "in", ["pending", "confirmed"]),
    limit(20)
  );

  return onSnapshot(
    bookingsQuery,
    async (snapshot) => {
      const bookings = await Promise.all(
        snapshot.docs.map(async (d) => {
          const data = d.data();
          // Prefer the name embedded at booking creation — reading the
          // passenger's profile doc is no longer permitted by the rules.
          const passengerName =
            data.passengerName ||
            (data.passengerId ? await resolveUserName(data.passengerId) : "Passenger");
          return { id: d.id, ...data, passengerName };
        })
      );
      onUpdate(bookings);
    },
    (error) => {
      // Surface listener failures — this is the query that feeds the
      // driver's booking list; a silent death here means drivers never
      // see new bookings and nobody knows why.
      console.error("[map] driver bookings listener failed:", error);
      onError?.(error);
    }
  );
}

/**
 * Get bookings by driverId for their active trip (one-time fetch fallback).
 */
export async function getDriverActiveBookings(driverId: string) {
  const bookingsQuery = query(
    collection(db, "bookings"),
    where("driverId", "==", driverId),
    where("status", "in", ["pending", "confirmed"]),
    limit(20)
  );

  const snapshot = await getDocs(bookingsQuery);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Get total available seats across all active trips for a specific route.
 * Used on the passenger route list to show seat availability.
 */
export async function getRouteAvailableSeats(routeId: string): Promise<{ totalSeats: number; totalCapacity: number; tripCount: number }> {
  const statuses = ["online", "boarding", "in_progress"];
  const tripQuery = query(
    collection(db, "trips"),
    where("routeId", "==", routeId),
    where("status", "in", statuses),
    limit(20)
  );

  const snapshot = await getDocs(tripQuery);
  let totalSeats = 0;
  let totalCapacity = 0;

  for (const tripDoc of snapshot.docs) {
    const trip = tripDoc.data();
    const driverDoc = await getDoc(doc(db, "drivers", trip.driverId));
    if (driverDoc.exists()) {
      const driver = driverDoc.data();
      totalSeats += driver.availableSeats ?? 0;
      totalCapacity += driver.vehicleCapacity ?? 12;
    }
  }

  return { totalSeats, totalCapacity, tripCount: snapshot.size };
}
