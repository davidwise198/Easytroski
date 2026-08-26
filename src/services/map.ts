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
    }

    markers.push({
      trip: {
        ...trip,
        driverName: driver.userId,
        vehiclePlate: vehicle?.numberPlate,
        vehicleColor: vehicle?.color,
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
  onUpdate: (markers: ActiveTripMarker[]) => void
): () => void {
  const statuses = ["online", "boarding", "in_progress"];
  const tripQuery = query(
    collection(db, "trips"),
    where("routeId", "==", routeId),
    where("status", "in", statuses),
    limit(20)
  );

  return onSnapshot(tripQuery, async (snapshot) => {
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

      markers.push({
        trip: {
          ...trip,
          driverName: driver.userId,
          vehiclePlate: vehicle?.numberPlate,
          vehicleColor: vehicle?.color,
          vehicleBrand: vehicle?.brand,
          vehicleCapacity: vehicle?.capacity,
          origin: routeData?.origin,
          destination: routeData?.destination,
        },
        driverLocation: driver.currentLocation,
        availableSeats: driver.availableSeats ?? 0,
      });
    }

    onUpdate(markers);
  });
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
  onUpdate: (trip: Trip | null) => void
): () => void {
  const tripQuery = query(
    collection(db, "trips"),
    where("driverId", "==", driverId),
    where("status", "in", ["online", "boarding", "in_progress"]),
    limit(1)
  );

  return onSnapshot(tripQuery, async (snapshot) => {
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
  });
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
 * Subscribe to a driver's real-time location updates.
 * Used by passengers to track the driver after booking.
 */
export function subscribeDriverLocation(
  driverId: string,
  onUpdate: (location: { latitude: number; longitude: number } | null) => void
): () => void {
  return onSnapshot(doc(db, "drivers", driverId), (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      if (data.currentLocation) {
        onUpdate(data.currentLocation);
      } else {
        onUpdate(null);
      }
    } else {
      onUpdate(null);
    }
  });
}

/**
 * Get bookings by driverId for their active trip.
 * This works with the current schema where bookings reference driverId directly.
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
