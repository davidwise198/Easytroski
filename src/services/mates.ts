// ---------------------------------------------------------------------------
// Mates — client service
//
// Two halves, deliberately separated:
//
//   WRITES  go to the backend (src/services/payments.ts → the payments
//           function). Nothing about a connection, a join decision or a trip
//           assignment can be changed from a phone, so every mutation is an
//           authenticated call the server authorises against live data.
//
//   READS   are direct Firestore listeners, which is what makes the mate's
//           screens live: a join request, an acceptance or an assignment
//           appears without a refresh. The rules allow each side to read only
//           its own connections and requests.
//
// The mate screens themselves land in Phase 1; this module is the data layer
// they will use, so the shapes below are the contract between the two.
// ---------------------------------------------------------------------------

import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { db } from "./firebase";
import { callPaymentsApi } from "./payments";
import type {
  Booking,
  Driver,
  MateConnection,
  MateJoinRequest,
  Route,
  Trip,
} from "../types/models";

// ─── Actions (backend-authorised) ─────────────────────────────────────────

export type EnsuredIds = { role: string; driverCode?: string | null; mateCode?: string | null };

/**
 * Make sure the signed-in user has the ID their role needs: a Driver ID for a
 * driver, a Mate ID and profile for a mate. Safe to call on every app start —
 * it returns the existing ID rather than making a new one.
 */
export function ensureMyIds() {
  return callPaymentsApi<EnsuredIds>("ensureIds", {});
}

export type DriverPreview = {
  driverName: string;
  vehiclePlate: string | null;
  routeLabel: string | null;
  alreadyConnected: boolean;
  requestPending: boolean;
};

/** Look up a Driver ID before sending a request, so the mate can confirm it. */
export function previewDriver(driverCode: string) {
  return callPaymentsApi<DriverPreview>("mateDriverPreview", { driverCode });
}

export function requestToJoinDriver(driverCode: string) {
  return callPaymentsApi<{
    requestId: string;
    status: "pending";
    alreadySent: boolean;
    driverName: string;
  }>("mateJoinRequest", { driverCode });
}

/** Driver accepts or rejects a mate request. */
export function decideJoinRequest(requestId: string, decision: "accept" | "reject") {
  return callPaymentsApi<{ requestId: string; status: string; driverId?: string }>(
    "mateJoinDecide",
    { requestId, decision }
  );
}

export function leaveDriver(driverId: string) {
  return callPaymentsApi<{ driverId: string; status: string }>("mateLeaveDriver", { driverId });
}

export function removeMate(mateId: string) {
  return callPaymentsApi<{ mateId: string; status: string }>("driverRemoveMate", { mateId });
}

export function assignMateToTrip(tripId: string, mateId: string) {
  return callPaymentsApi<{
    tripId: string;
    mateId: string;
    mateName: string;
    mateCode: string | null;
  }>("assignMate", { tripId, mateId });
}

export function unassignMateFromTrip(tripId: string) {
  return callPaymentsApi<{ tripId: string; mateId: string; status: string }>("unassignMate", {
    tripId,
  });
}

// ─── Reads (live) ─────────────────────────────────────────────────────────

const LIVE_TRIP_STATUSES = ["online", "scheduled", "boarding", "in_progress"];

/** True while this mate is actually working the trip (assignment still live). */
export function isMateWorkingTrip(trip: Pick<Trip, "mateActive" | "status">): boolean {
  return trip.mateActive !== false && LIVE_TRIP_STATUSES.includes(String(trip.status));
}

/**
 * The mate's own connections — the drivers they are allowed to work with.
 * A connection is not an assignment: it stays after the trip ends.
 */
export function subscribeMateConnections(
  mateId: string,
  onUpdate: (connections: MateConnection[]) => void,
  onError?: (error: Error) => void
): () => void {
  const connectionsQuery = query(
    collection(db, "mateConnections"),
    where("mateId", "==", mateId),
    limit(20)
  );

  return onSnapshot(
    connectionsQuery,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as MateConnection[]);
    },
    (error) => onError?.(error as Error)
  );
}

/** A driver's connections — the mates they are allowed to put on a trip. */
export function subscribeDriverConnections(
  driverId: string,
  onUpdate: (connections: MateConnection[]) => void,
  onError?: (error: Error) => void
): () => void {
  const connectionsQuery = query(
    collection(db, "mateConnections"),
    where("driverId", "==", driverId),
    limit(20)
  );

  return onSnapshot(
    connectionsQuery,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as MateConnection[]);
    },
    (error) => onError?.(error as Error)
  );
}

/** Join requests waiting on this driver's answer. */
export function subscribeDriverJoinRequests(
  driverId: string,
  onUpdate: (requests: MateJoinRequest[]) => void,
  onError?: (error: Error) => void
): () => void {
  const requestsQuery = query(
    collection(db, "mateJoinRequests"),
    where("driverId", "==", driverId),
    limit(20)
  );

  return onSnapshot(
    requestsQuery,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as MateJoinRequest[]);
    },
    (error) => onError?.(error as Error)
  );
}

/** Requests this mate has sent, so they can see "waiting for an answer". */
export function subscribeMateJoinRequests(
  mateId: string,
  onUpdate: (requests: MateJoinRequest[]) => void,
  onError?: (error: Error) => void
): () => void {
  const requestsQuery = query(
    collection(db, "mateJoinRequests"),
    where("mateId", "==", mateId),
    limit(20)
  );

  return onSnapshot(
    requestsQuery,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as MateJoinRequest[]);
    },
    (error) => onError?.(error as Error)
  );
}

/**
 * The trip this mate is working right now, if any. Filtered in code rather
 * than in the query because Firestore needs a composite index for a second
 * equality filter, and this list is at most a handful of documents.
 */
export function subscribeMateActiveTrip(
  mateId: string,
  onUpdate: (trip: Trip | null, allTrips: Trip[]) => void,
  onError?: (error: Error) => void
): () => void {
  const tripsQuery = query(collection(db, "trips"), where("mateId", "==", mateId), limit(10));

  return onSnapshot(
    tripsQuery,
    (snapshot) => {
      const trips = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Trip[];
      onUpdate(trips.find((trip) => isMateWorkingTrip(trip)) ?? null, trips);
    },
    (error) => onError?.(error as Error)
  );
}

/**
 * The bookings this mate may work on: the backend stamps `mateId` on a trip's
 * live bookings while they are assigned to it, and clears it when they come
 * off. Read-only — every action still goes through the backend, which
 * re-checks the live assignment.
 */
export function subscribeMateBookings(
  mateId: string,
  onUpdate: (bookings: Booking[]) => void,
  onError?: (error: Error) => void
): () => void {
  const bookingsQuery = query(
    collection(db, "bookings"),
    where("mateId", "==", mateId),
    limit(40)
  );

  return onSnapshot(
    bookingsQuery,
    (snapshot) => {
      onUpdate(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as Booking[]);
    },
    (error) => onError?.(error as Error)
  );
}

/** Live driver document: name, plate and the seat count the backend owns. */
export function subscribeDriver(
  driverId: string,
  onUpdate: (driver: Driver | null) => void,
  onError?: (error: Error) => void
): () => void {
  return onSnapshot(
    doc(db, "drivers", driverId),
    (snapshot) => {
      onUpdate(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Driver) : null);
    },
    (error) => onError?.(error as Error)
  );
}

/** One-shot route lookup — the trip document only carries the id. */
export async function fetchRoute(routeId: string): Promise<Route | null> {
  const snapshot = await getDoc(doc(db, "routes", routeId));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as Route) : null;
}
