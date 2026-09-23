// ---------------------------------------------------------------------------
// Mate foundation: identity, connection, and trip assignment
//
// Two ideas that must never be confused:
//
//   mateConnections/{driverId}__{mateId}
//     "this mate is allowed to work with this driver" — may last for months
//
//   trips/{tripId}.mateId + .mateActive
//     "this mate is working THIS trip right now" — ends with the trip
//
// A connection on its own grants no access to any booking. Only an active trip
// assignment does, and only for bookings belonging to that driver.
//
// Everything here is server-side. The app can read connection and request
// documents (so it can show them), but nothing in them can be created,
// accepted or changed from a phone — accepting a mate is a driver decision and
// assigning one is a trip decision, so both are authorized here.
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
  type FsDoc,
} from "./firestore.ts";
import { ApiError } from "./errors.ts";
import { notify, writeAudit } from "./audit.ts";
import { codeField, codeKind, generateCode, normaliseCode, type IdKind } from "./ids.ts";
import { LIVE_TRIP_STATUSES } from "./state.ts";
import { writeSeatsOffered, type SeatUsage } from "./seats.ts";

/** A mate may keep this many requests outstanding at once. */
export const MAX_PENDING_MATE_REQUESTS = 3;

/** …and may ask the same driver at most this often in 24 hours. */
export const MAX_REQUESTS_PER_PAIR_PER_DAY = 5;

// LIVE_TRIP_STATUSES now lives in state.ts: the seat authority, the trip
// authority and the booking flow all ask "is this trip live?", and a second
// definition here is how a seat ends up counted against a finished trip.

/** Bookings that mean a trip still has passengers to look after. */
const PASSENGER_STATUSES = ["pending", "awaiting_payment", "confirmed", "picked_up"];

// ─── Identity ─────────────────────────────────────────────────────────────

export function connectionId(driverId: string, mateId: string): string {
  return `${driverId}__${mateId}`;
}

/**
 * Claim a unique code. Creating `idCodes/{code}` is create-only, so a
 * collision fails the write instead of overwriting someone's identity — we
 * then simply draw another number.
 */
async function claimCode(kind: IdKind, profilePath: string): Promise<string | null> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateCode(kind);
    try {
      await commit([createWrite(`idCodes/${code}`, { kind, profilePath, createdAt: nowIso() })]);
      return code;
    } catch {
      // Already taken — try again.
    }
  }
  return null;
}

/**
 * Give a driver their permanent Driver ID. Called from the app and again when
 * they start a trip, so a driver always has an ID before a mate can need it.
 */
export async function ensureDriverCode(driverId: string): Promise<string | null> {
  const driver = await getDocument(`drivers/${driverId}`);
  if (!driver) return null;

  const existing = driver.data.driverCode;
  if (typeof existing === "string" && existing) return existing;

  const code = await claimCode("driver", `drivers/${driverId}`);
  if (!code) return null;

  try {
    await commit([
      updateWrite(
        `drivers/${driverId}`,
        { [codeField("driver")]: code, updatedAt: nowIso() },
        [codeField("driver"), "updatedAt"],
        driver.updateTime
      ),
    ]);
    return code;
  } catch {
    // Another request assigned one first — theirs wins, ours is left unused.
    const fresh = await getDocument(`drivers/${driverId}`);
    const assigned = fresh?.data.driverCode;
    return typeof assigned === "string" && assigned ? assigned : null;
  }
}

export type MateProfile = { id: string; name: string; code: string | null };

/**
 * Create or refresh the mate's own profile. A mate account is theirs, not the
 * driver's: it survives leaving one driver and joining another, and it is what
 * carries their Mate ID.
 */
export async function ensureMateProfile(mateId: string): Promise<MateProfile> {
  const user = await getDocument(`users/${mateId}`);
  const name = String(user?.data.name || user?.data.displayName || "Mate");
  const phone = typeof user?.data.phone === "string" ? user.data.phone : null;

  const existing = await getDocument(`mates/${mateId}`);

  if (existing) {
    let code = typeof existing.data.mateCode === "string" ? existing.data.mateCode : null;
    if (!code) {
      code = await claimCode("mate", `mates/${mateId}`);
      if (code) {
        await commit([
          updateWrite(
            `mates/${mateId}`,
            { [codeField("mate")]: code, updatedAt: nowIso() },
            [codeField("mate"), "updatedAt"],
            existing.updateTime
          ),
        ]);
      }
    }
    // Keep the display name in step with the user profile, best-effort.
    if (name && existing.data.name !== name) {
      const fresh = await getDocument(`mates/${mateId}`);
      if (fresh) {
        await commit([
          updateWrite(
            `mates/${mateId}`,
            { name, phone, updatedAt: nowIso() },
            ["name", "phone", "updatedAt"],
            fresh.updateTime
          ),
        ]).catch(() => {});
      }
    }
    return { id: mateId, name, code };
  }

  const code = await claimCode("mate", `mates/${mateId}`);
  if (!code) throw new ApiError("unknown", "We couldn't create your Mate ID. Please try again.", 500);

  try {
    await commit([
      createWrite(`mates/${mateId}`, {
        userId: mateId,
        name,
        phone,
        [codeField("mate")]: code,
        status: "active",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }),
    ]);
  } catch {
    // Created concurrently — read back whatever exists.
    const race = await getDocument(`mates/${mateId}`);
    const raced = race?.data.mateCode;
    return { id: mateId, name, code: typeof raced === "string" ? raced : code };
  }

  return { id: mateId, name, code };
}

/** Called by the app on start so the signed-in user has whatever ID fits their role. */
export async function ensureIds(
  uid: string,
  role: unknown
): Promise<{ role: string; driverCode?: string | null; mateCode?: string | null }> {
  const roleName = typeof role === "string" ? role : "";
  if (roleName === "driver") return { role: roleName, driverCode: await ensureDriverCode(uid) };
  if (roleName === "mate") {
    const profile = await ensureMateProfile(uid);
    return { role: roleName, mateCode: profile.code };
  }
  return { role: roleName };
}

// ─── Reading a code ───────────────────────────────────────────────────────

function firstName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Driver";
  return trimmed.split(/\s+/)[0];
}

function plateOf(driver: Record<string, unknown>): string | null {
  const plate = driver.vehicleRegistration;
  return typeof plate === "string" && plate ? plate : null;
}

async function routeLabelFor(driver: Record<string, unknown>): Promise<string | null> {
  const routeId =
    (typeof driver.defaultRouteId === "string" && driver.defaultRouteId) ||
    (typeof driver.routeId === "string" && driver.routeId) ||
    "";
  if (!routeId) return null;
  const route = await getDocument(`routes/${routeId}`);
  if (!route) return null;
  const origin = String(route.data.origin || "");
  const destination = String(route.data.destination || "");
  if (!origin || !destination) return null;
  return `${origin} → ${destination}`;
}

type ResolvedDriver = {
  driverId: string;
  code: string;
  driver: FsDoc;
  driverName: string;
};

async function resolveDriverByCode(rawCode: unknown): Promise<ResolvedDriver> {
  const code = normaliseCode(rawCode);
  if (!code) {
    throw new ApiError(
      "invalid_driver_code",
      "That doesn't look like a Driver ID. It should look like ET-DV-48291.",
      400
    );
  }
  if (codeKind(code) !== "driver") {
    throw new ApiError("invalid_driver_code", "That's a Mate ID. Ask the driver for their Driver ID.", 400);
  }

  const entry = await getDocument(`idCodes/${code}`);
  const path = String(entry?.data.profilePath || "");
  if (!entry || !path.startsWith("drivers/")) {
    throw new ApiError("driver_not_found", "We couldn't find a driver with that ID.", 404);
  }

  const driverId = path.slice("drivers/".length);
  const driver = await getDocument(`drivers/${driverId}`);
  if (!driver) throw new ApiError("driver_not_found", "We couldn't find a driver with that ID.", 404);

  return { driverId, code, driver, driverName: firstName(String(driver.data.name || "Driver")) };
}

async function requestsForMate(mateId: string): Promise<FsDoc[]> {
  return queryDocuments({
    collection: "mateJoinRequests",
    filters: [{ field: "mateId", value: mateId }],
    limit: 50,
  });
}

async function pendingRequestBetween(mateId: string, driverId: string): Promise<FsDoc | null> {
  const requests = await requestsForMate(mateId);
  return requests.find((r) => r.data.driverId === driverId && r.data.status === "pending") ?? null;
}

/**
 * What the mate sees before sending a request: enough to confirm they have the
 * right driver, and nothing else. First name only, plus the plate and route
 * they can see with their own eyes.
 */
export async function driverPreview(mateId: string, rawCode: unknown) {
  const resolved = await resolveDriverByCode(rawCode);
  if (resolved.driverId === mateId) throw new ApiError("invalid_driver_code", "That's your own ID.", 400);

  const connection = await getDocument(`mateConnections/${connectionId(resolved.driverId, mateId)}`);
  const pending = await pendingRequestBetween(mateId, resolved.driverId);

  return {
    driverName: resolved.driverName,
    vehiclePlate: plateOf(resolved.driver.data),
    routeLabel: await routeLabelFor(resolved.driver.data),
    alreadyConnected: connection?.data.status === "active",
    requestPending: Boolean(pending),
  };
}

// ─── Join requests ────────────────────────────────────────────────────────

export async function requestJoin(mateId: string, rawCode: unknown) {
  const resolved = await resolveDriverByCode(rawCode);
  if (resolved.driverId === mateId) throw new ApiError("invalid_driver_code", "That's your own ID.", 400);

  const connection = await getDocument(`mateConnections/${connectionId(resolved.driverId, mateId)}`);
  if (connection?.data.status === "active") {
    throw new ApiError("already_connected", "You're already connected to this driver.", 409);
  }

  const profile = await ensureMateProfile(mateId);
  const requests = await requestsForMate(mateId);

  // Repeat taps are not a new request — they return the one already waiting.
  const waiting = requests.find((r) => r.data.driverId === resolved.driverId && r.data.status === "pending");
  if (waiting) {
    return {
      requestId: waiting.id,
      status: "pending" as const,
      alreadySent: true,
      driverName: resolved.driverName,
    };
  }

  const pendingElsewhere = requests.filter((r) => r.data.status === "pending").length;
  if (pendingElsewhere >= MAX_PENDING_MATE_REQUESTS) {
    throw new ApiError(
      "too_many_requests",
      `You already have ${MAX_PENDING_MATE_REQUESTS} requests waiting for an answer. Please wait for one of them.`,
      429
    );
  }

  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const todayForThisDriver = requests.filter(
    (r) => r.data.driverId === resolved.driverId && (toMillis(r.data.createdAt) ?? 0) > dayAgo
  ).length;
  if (todayForThisDriver >= MAX_REQUESTS_PER_PAIR_PER_DAY) {
    throw new ApiError(
      "too_many_requests",
      "You've asked this driver several times today. Please try again tomorrow.",
      429
    );
  }

  const requestId = newId();
  await commit([
    createWrite(`mateJoinRequests/${requestId}`, {
      driverId: resolved.driverId,
      driverCode: resolved.code,
      driverName: resolved.driverName,
      mateId,
      mateName: profile.name,
      mateCode: profile.code,
      status: "pending",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }),
  ]);

  await writeAudit({
    event: "MATE_JOIN_REQUESTED",
    entityType: "mate",
    entityId: mateId,
    actorId: mateId,
    actorRole: "mate",
    meta: {
      driverId: resolved.driverId,
      driverCode: resolved.code,
      mateCode: profile.code,
      requestId,
    },
  });

  await notify({
    recipientId: resolved.driverId,
    type: "mate_request",
    title: "New Mate Request",
    body: `${profile.name} wants to join you as a mate.`,
  });

  return { requestId, status: "pending" as const, alreadySent: false, driverName: resolved.driverName };
}

/** Create or reactivate the driver↔mate connection. */
async function activateConnection(
  driverId: string,
  mateId: string,
  info: { driverName: string | null; driverCode: string | null; mateName: string | null; mateCode: string | null }
): Promise<string> {
  const id = connectionId(driverId, mateId);
  const existing = await getDocument(`mateConnections/${id}`);

  const fields: Record<string, unknown> = {
    driverId,
    mateId,
    driverName: info.driverName,
    driverCode: info.driverCode,
    mateName: info.mateName,
    mateCode: info.mateCode,
    status: "active",
    endedAt: null,
    endedBy: null,
    updatedAt: nowIso(),
  };

  if (existing) {
    await commit([
      updateWrite(`mateConnections/${id}`, fields, Object.keys(fields), existing.updateTime),
    ]);
    return id;
  }

  await commit([createWrite(`mateConnections/${id}`, { ...fields, createdAt: nowIso() })]);
  return id;
}

export async function decideJoin(requestId: string, driverId: string, decision: "accept" | "reject") {
  const request = await getDocument(`mateJoinRequests/${requestId}`);
  if (!request) throw new ApiError("request_not_found", "We couldn't find that request.", 404);
  if (request.data.driverId !== driverId) {
    throw new ApiError("not_your_mate", "That request isn't for you.", 403);
  }
  if (request.data.status !== "pending") {
    throw new ApiError("request_not_pending", "That request has already been answered.", 409);
  }

  const mateId = String(request.data.mateId);
  const mateName = typeof request.data.mateName === "string" ? request.data.mateName : "A mate";
  const mateCode = typeof request.data.mateCode === "string" ? request.data.mateCode : null;

  // Claim the decision first: the compare-and-swap means only one of two
  // racing taps can ever decide this request.
  try {
    await commit([
      updateWrite(
        `mateJoinRequests/${requestId}`,
        {
          status: decision === "accept" ? "accepted" : "rejected",
          decidedAt: nowIso(),
          decidedBy: driverId,
          updatedAt: nowIso(),
        },
        ["status", "decidedAt", "decidedBy", "updatedAt"],
        request.updateTime
      ),
    ]);
  } catch {
    throw new ApiError("request_not_pending", "That request has already been answered.", 409);
  }

  const driver = await getDocument(`drivers/${driverId}`);
  const driverName = String(driver?.data.name || "The driver");
  const driverCode = typeof driver?.data.driverCode === "string" ? driver.data.driverCode : null;

  if (decision === "reject") {
    await writeAudit({
      event: "MATE_JOIN_REJECTED",
      entityType: "mate",
      entityId: mateId,
      actorId: driverId,
      actorRole: "driver",
      meta: { driverId, driverCode, mateCode, requestId },
    });
    await notify({
      recipientId: mateId,
      type: "mate_rejected",
      title: "Request declined",
      body: `${firstName(driverName)} declined your request to join as a mate.`,
    });
    return { requestId, status: "rejected" as const };
  }

  await activateConnection(driverId, mateId, { driverName, driverCode, mateName, mateCode });

  await writeAudit({
    event: "MATE_JOIN_ACCEPTED",
    entityType: "mate",
    entityId: mateId,
    actorId: driverId,
    actorRole: "driver",
    meta: { driverId, driverCode, mateCode, requestId },
  });

  await notify({
    recipientId: mateId,
    type: "mate_accepted",
    title: "You can work with this driver",
    body: `${firstName(driverName)} accepted you as a mate. They can now assign you to a trip.`,
  });

  return { requestId, status: "accepted" as const, driverId };
}

// ─── Connection lifecycle ─────────────────────────────────────────────────

/** The live trip this mate is working right now, if any. */
export async function getTripAssignedToMate(mateId: string): Promise<FsDoc | null> {
  const trips = await queryDocuments({
    collection: "trips",
    filters: [{ field: "mateId", value: mateId }],
    limit: 10,
  });

  return (
    trips.find(
      (trip) => trip.data.mateActive !== false && LIVE_TRIP_STATUSES.includes(String(trip.data.status))
    ) ?? null
  );
}

export async function leaveDriver(mateId: string, driverId: string) {
  const id = connectionId(driverId, mateId);
  const connection = await getDocument(`mateConnections/${id}`);
  if (!connection || connection.data.status !== "active") {
    throw new ApiError("not_connected", "You're not connected to that driver.", 409);
  }

  const trip = await getTripAssignedToMate(mateId);
  if (trip && trip.data.driverId === driverId) {
    throw new ApiError(
      "mate_assigned_to_trip",
      "You're still on a trip with this driver. Finish the trip before leaving.",
      409
    );
  }

  await commit([
    updateWrite(
      `mateConnections/${id}`,
      { status: "left", endedAt: nowIso(), endedBy: mateId, updatedAt: nowIso() },
      ["status", "endedAt", "endedBy", "updatedAt"],
      connection.updateTime
    ),
  ]);

  const mateName = typeof connection.data.mateName === "string" ? connection.data.mateName : "Your mate";
  const mateCode = typeof connection.data.mateCode === "string" ? connection.data.mateCode : null;

  await writeAudit({
    event: "MATE_LEFT",
    entityType: "mate",
    entityId: mateId,
    actorId: mateId,
    actorRole: "mate",
    meta: { driverId, mateCode },
  });

  await notify({
    recipientId: driverId,
    type: "mate_left",
    title: "Mate left",
    body: `${mateName} is no longer working with you. You can add another mate.`,
  });

  return { driverId, status: "left" as const };
}

export async function removeMate(driverId: string, mateId: string) {
  const id = connectionId(driverId, mateId);
  const connection = await getDocument(`mateConnections/${id}`);
  if (!connection || connection.data.status !== "active") {
    throw new ApiError("not_connected", "That mate isn't connected to you.", 409);
  }

  const trip = await getTripAssignedToMate(mateId);
  if (trip && trip.data.driverId === driverId) {
    throw new ApiError(
      "mate_assigned_to_trip",
      "This mate is still on a trip with you. Finish the trip before removing them.",
      409
    );
  }

  await commit([
    updateWrite(
      `mateConnections/${id}`,
      { status: "removed", endedAt: nowIso(), endedBy: driverId, updatedAt: nowIso() },
      ["status", "endedAt", "endedBy", "updatedAt"],
      connection.updateTime
    ),
  ]);

  const driver = await getDocument(`drivers/${driverId}`);
  const driverName = firstName(String(driver?.data.name || "The driver"));

  await writeAudit({
    event: "MATE_REMOVED",
    entityType: "mate",
    entityId: mateId,
    actorId: driverId,
    actorRole: "driver",
    meta: { driverId, mateCode: connection.data.mateCode ?? null },
  });

  await notify({
    recipientId: mateId,
    type: "mate_removed",
    title: "Removed",
    body: `${driverName} removed you as a mate. You can join another driver any time.`,
  });

  return { mateId, status: "removed" as const };
}

// ─── Read visibility ──────────────────────────────────────────────────────

/** Bookings that are still this trip's live work. */
const LIVE_BOOKING_STATUSES = ["pending", "awaiting_payment", "confirmed", "picked_up"];

/**
 * Stamp (or clear) the mate on the live bookings of a trip.
 *
 * This is **read visibility only**. The security rules can then say "this mate
 * may read bookings that name them", which the rules engine can evaluate on a
 * simple query — it cannot follow the assignment itself. Authority is never
 * taken from this field: `resolveBookingActor()` re-checks the live assignment
 * on every accept, reject, pickup and completion, so clearing a stamp early or
 * late can only change what someone *sees*, never what they can do.
 */
async function stampBookingsMate(
  driverId: string,
  tripId: string,
  mate: { id: string; name: string | null } | null
): Promise<number> {
  if (!driverId) return 0;

  const bookings = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "driverId", value: driverId }],
    limit: 50,
  });

  let stamped = 0;
  for (const booking of bookings) {
    if (!LIVE_BOOKING_STATUSES.includes(String(booking.data.status))) continue;
    // A booking made before the driver's trip existed belongs to this trip too.
    if (booking.data.tripId && booking.data.tripId !== tripId) continue;

    try {
      await commit([
        updateWrite(
          `bookings/${booking.id}`,
          { mateId: mate?.id ?? null, mateName: mate?.name ?? null, updatedAt: nowIso() },
          ["mateId", "mateName", "updatedAt"],
          booking.updateTime
        ),
      ]);
      stamped += 1;
    } catch {
      // The booking moved on underneath us — it is no longer this trip's work.
    }
  }
  return stamped;
}

// ─── Trip assignment ──────────────────────────────────────────────────────

/**
 * Put a connected mate on today's trip. The connection is what makes this
 * legal; the assignment is what grants access to that trip's bookings.
 */
export async function assignMate(driverId: string, tripId: string, mateId: string) {
  const trip = await getDocument(`trips/${tripId}`);
  if (!trip || trip.data.driverId !== driverId) {
    throw new ApiError("not_your_trip", "That trip isn't yours.", 403);
  }
  if (!LIVE_TRIP_STATUSES.includes(String(trip.data.status))) {
    throw new ApiError("trip_not_running", "Start the trip before assigning a mate.", 409);
  }

  const connection = await getDocument(`mateConnections/${connectionId(driverId, mateId)}`);
  if (!connection || connection.data.status !== "active") {
    throw new ApiError("not_connected", "That mate isn't connected to you yet.", 409);
  }

  const otherTrip = await getTripAssignedToMate(mateId);
  if (otherTrip && otherTrip.id !== tripId) {
    throw new ApiError("mate_busy", "That mate is already working on another trip.", 409);
  }

  const mateName = typeof connection.data.mateName === "string" ? connection.data.mateName : "Mate";
  const mateCode = typeof connection.data.mateCode === "string" ? connection.data.mateCode : null;

  await commit([
    updateWrite(
      `trips/${tripId}`,
      {
        mateId,
        mateName,
        mateCode,
        mateActive: true,
        mateAssignedAt: nowIso(),
        mateUnassignedAt: null,
        updatedAt: nowIso(),
      },
      ["mateId", "mateName", "mateCode", "mateActive", "mateAssignedAt", "mateUnassignedAt", "updatedAt"],
      trip.updateTime
    ),
  ]);

  // Live bookings that are already waiting become visible to this mate.
  await stampBookingsMate(driverId, tripId, { id: mateId, name: mateName });

  await writeAudit({
    event: "MATE_ASSIGNED",
    entityType: "trip",
    entityId: tripId,
    actorId: driverId,
    actorRole: "driver",
    meta: { driverId, tripId, mateId, mateCode },
  });

  await notify({
    recipientId: mateId,
    type: "mate_assigned",
    title: "You're on this trip",
    body: "The driver assigned you to today's trip. Booking requests are now yours to handle.",
  });

  return { tripId, mateId, mateName, mateCode };
}

/**
 * Take the mate off the trip. Their id stays on the trip document forever —
 * that is the historical record of who worked it.
 */
export async function unassignMate(driverId: string, tripId: string) {
  const trip = await getDocument(`trips/${tripId}`);
  if (!trip || trip.data.driverId !== driverId) {
    throw new ApiError("not_your_trip", "That trip isn't yours.", 403);
  }
  if (!trip.data.mateId || trip.data.mateActive === false) {
    throw new ApiError("not_connected", "There's no mate on that trip.", 409);
  }

  // Never strand passengers (§16): the trip must be clear before it loses its
  // mate, otherwise nobody is authorised to look after them.
  const bookings = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "driverId", value: driverId }],
    limit: 50,
  });
  const stillTravelling = bookings.filter(
    (b) =>
      (b.data.tripId === tripId || !b.data.tripId) &&
      PASSENGER_STATUSES.includes(String(b.data.status))
  ).length;
  if (stillTravelling > 0) {
    throw new ApiError(
      "trip_has_passengers",
      "There are passengers on this trip. Drop them off or complete the trip before removing the mate.",
      409
    );
  }

  const mateId = String(trip.data.mateId);

  await commit([
    updateWrite(
      `trips/${tripId}`,
      { mateActive: false, mateUnassignedAt: nowIso(), updatedAt: nowIso() },
      ["mateActive", "mateUnassignedAt", "updatedAt"],
      trip.updateTime
    ),
  ]);

  // The mate stops seeing this trip's bookings the moment they come off it.
  await stampBookingsMate(driverId, tripId, null);

  await writeAudit({
    event: "MATE_UNASSIGNED",
    entityType: "trip",
    entityId: tripId,
    actorId: driverId,
    actorRole: "driver",
    meta: { driverId, tripId, mateId, mateCode: trip.data.mateCode ?? null },
  });

  return { tripId, mateId, status: "unassigned" as const };
}

/**
 * Called when a trip ends: the mate becomes free to work with anyone else, and
 * the trip keeps their identity for the record.
 */
export async function clearMateOnTripEnd(trip: FsDoc): Promise<void> {
  // The caller's copy of the trip is usually stale by now — ending a trip
  // writes its status first. A compare-and-swap against that old version can
  // only fail, and silently, so re-read for a version we know is current.
  const fresh = await getDocument(`trips/${trip.id}`);
  const mateId = fresh?.data.mateId ?? trip.data.mateId;
  if (!fresh || !mateId || fresh.data.mateActive === false) return;

  try {
    await commit([
      updateWrite(
        `trips/${trip.id}`,
        { mateActive: false, mateUnassignedAt: nowIso(), updatedAt: nowIso() },
        ["mateActive", "mateUnassignedAt", "updatedAt"],
        fresh.updateTime
      ),
    ]);
  } catch {
    // The trip already moved on; the assignment still ended.
  }

  await stampBookingsMate(String(trip.data.driverId || ""), trip.id, null);

  await writeAudit({
    event: "MATE_UNASSIGNED",
    entityType: "trip",
    entityId: trip.id,
    actorRole: "system",
    meta: { tripId: trip.id, driverId: trip.data.driverId ?? null, mateId, reason: "trip_ended" },
  });

  await notify({
    recipientId: String(mateId),
    type: "mate_unassigned",
    title: "Trip completed",
    body: "Your trip has ended. You're free to work with another driver.",
  });
}

// ─── Seats on offer ───────────────────────────────────────────────────────

/** The live trip this driver is running, if any. */
async function getLiveTripForDriver(driverId: string): Promise<FsDoc | null> {
  const trips = await queryDocuments({
    collection: "trips",
    filters: [{ field: "driverId", value: driverId }],
    limit: 10,
  });
  return trips.find((trip) => LIVE_TRIP_STATUSES.includes(String(trip.data.status))) ?? null;
}

/**
 * Change how many seats the vehicle is offering, on its running trip.
 *
 * Two people may do this, and the request never says which one it is — it is
 * resolved from the live trip:
 *   · the mate working the trip (the ordinary case all day)
 *   · the driver who owns it, so a vehicle with no mate can still stop selling
 *     seats once it is full
 *
 * This is deliberately **not** a booking decision, so the driver is allowed
 * here; the mate-only rule covers accepting, rejecting, pickup and drop-off.
 * Every change is attributed to whoever made it, and the seat authority refuses
 * anything that would leave the vehicle offering more seats than it can carry
 * or than are actually free.
 */
export async function setSeatsOfferedCore(actorUid: string, seats: number): Promise<SeatUsage> {
  const ownTrip = await getLiveTripForDriver(actorUid);
  if (ownTrip) {
    return writeSeatsOffered(actorUid, seats, {
      actorId: actorUid,
      actorRole: "driver",
      driverId: actorUid,
      tripId: ownTrip.id,
    });
  }

  const trip = await getTripAssignedToMate(actorUid);
  if (!trip) {
    throw new ApiError("not_your_trip", "You're not on a trip right now.", 403);
  }

  const driverId = String(trip.data.driverId || "");
  if (!driverId) throw new ApiError("driver_unavailable", "That trip has no driver.", 409);

  return writeSeatsOffered(driverId, seats, {
    actorId: actorUid,
    actorRole: "mate",
    driverId,
    tripId: trip.id,
    mateCode: typeof trip.data.mateCode === "string" ? trip.data.mateCode : null,
    mateName: typeof trip.data.mateName === "string" ? trip.data.mateName : null,
  });
}

// ─── Who may act on a booking ─────────────────────────────────────────────

export type BookingActor = {
  driverId: string;
  actorId: string;
  actorRole: "driver" | "mate";
  mateCode?: string | null;
  mateName?: string | null;
  tripId?: string | null;
};

/** Which decision the caller is trying to make. Only the wording differs. */
export type BookingAction = "decide" | "pickup" | "complete";

const MATE_REQUIRED_MESSAGE: Record<BookingAction, string> = {
  decide: "Assign a Mate before accepting passenger bookings.",
  pickup: "Assign a Mate before marking passengers picked up.",
  complete: "Assign a Mate before completing passenger bookings.",
};

/**
 * The one authority question the booking flows ask.
 *
 *  · the mate assigned to that driver's live trip — and only while assigned
 *  · nobody else. A driver is **not** a fallback: passenger decisions are the
 *    mate's job, so a driver who tries is told to assign one.
 *
 * A connected mate with no trip assignment is rejected here, which is what
 * keeps "allowed to work with" and "working now" from blurring together.
 *
 * Trip-level actions (start trip, end trip, cancel the ride, go online) do not
 * come through here — the driver keeps all of those.
 */
export async function resolveBookingActor(
  booking: FsDoc,
  actorUid: string,
  action: BookingAction = "decide"
): Promise<BookingActor> {
  const driverId = String(booking.data.driverId || "");
  const bookingTripId = typeof booking.data.tripId === "string" ? booking.data.tripId : null;

  // Deliberately checked before any read: the answer is the same whether or not
  // a mate happens to be assigned, so a driver can never take a booking action.
  if (actorUid === driverId) {
    throw new ApiError("mate_required", MATE_REQUIRED_MESSAGE[action], 409);
  }

  const trip = await getTripAssignedToMate(actorUid);
  if (trip && trip.data.driverId === driverId) {
    if (bookingTripId && bookingTripId !== trip.id) {
      throw new ApiError("not_your_trip", "That booking isn't on your trip.", 403);
    }
    return {
      driverId,
      actorId: actorUid,
      actorRole: "mate",
      mateCode: typeof trip.data.mateCode === "string" ? trip.data.mateCode : null,
      mateName: typeof trip.data.mateName === "string" ? trip.data.mateName : null,
      tripId: trip.id,
    };
  }

  throw new ApiError("not_your_trip", "That booking isn't yours.", 403);
}

/** Attribution recorded alongside every action, so an audit line names both people. */
export function actorMeta(actor: BookingActor): Record<string, unknown> {
  return {
    driverId: actor.driverId,
    tripId: actor.tripId ?? null,
    mateId: actor.actorRole === "mate" ? actor.actorId : null,
    mateCode: actor.mateCode ?? null,
    mateName: actor.mateName ?? null,
  };
}
