import {
  addDoc,
  collection,
  doc,
  getDocs,
  getDoc,
  limit,
  orderBy,
  query,
  setDoc,
  where,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "./firebase";
import { Booking, Location, Route, Trip } from "../types/models";

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

  return bookingReference.id;
};

export const createLocation = (address: string): Location => ({
  latitude: 0,
  longitude: 0,
  address,
});

export const setDriverAvailability = async (
  driverId: string,
  online: boolean
) => {
  await setDoc(
    doc(db, "drivers", driverId),
    {
      userId: driverId,
      online,
      status: online ? "online" : "offline",
      availableSeats: 0,
    },
    { merge: true }
  );
};

export const startTrip = async (
  driverId: string,
  routeId: string,
  direction: "going" | "returning"
) => {
  const tripReference = await addDoc(collection(db, "trips"), {
    driverId,
    routeId,
    direction,
    status: "in_progress",
    startTime: new Date().toISOString(),
  });

  await setDriverAvailability(driverId, true);
  return tripReference.id;
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