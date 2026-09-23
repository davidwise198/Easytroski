// ---------------------------------------------------------------------------
// Phase 4 — seat recycling test harness
//
// This runs the REAL backend code: the same bookings.ts, seats.ts, mates.ts,
// tripFlow.ts and cancelFlow.ts that production uses, over the same
// firestore.ts client. Nothing is mocked at the module level.
//
// Instead, the network layer is replaced with an in-memory Firestore that
// speaks the actual REST protocol:
//
//   · GET  documents/{path}            → read, or 404
//   · POST :runQuery                   → EQUAL/NOT_EQUAL/LESS_THAN/GREATER_THAN
//                                        field filters, composite AND, orderBy,
//                                        limit
//   · POST :commit                     → update masks (dotted paths),
//                                        create-only writes, atomic increments,
//                                        deletes, and — critically —
//                                        `currentDocument` preconditions, which
//                                        is what makes compare-and-swap real
//
// Because preconditions genuinely fail here, `withRetry()` genuinely retries,
// so the "two passengers, one last seat" race is tested as a race rather than
// asserted about. A test that passes against this harness has exercised the
// same interleaving the production database would produce.
//
// Run:  deno run --allow-env supabase/tests/seats.check.ts
// ---------------------------------------------------------------------------

import { fromFsFields } from "../functions/_shared/firestore.ts";

// ─── In-memory Firestore ──────────────────────────────────────────────────

type StoredDoc = { fields: Record<string, any>; updateTime: string };

const PROJECT = "phase4-test";
const DOCS_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const store = new Map<string, StoredDoc>();
let versionCounter = 0;
let commitCount = 0;
const networkLog: string[] = [];

/** Doc paths touched in the order commits arrived — used to prove serialisation. */
const commitOrder: string[][] = [];

function nextVersion(): string {
  versionCounter += 1;
  return `2026-01-01T00:00:${String(versionCounter).padStart(2, "0")}.000000Z`;
}

function pathFromName(name: string): string {
  return name.replace(`${DOCS_ROOT}/`, "");
}

function nameFromPath(path: string): string {
  return `${DOCS_ROOT}/${path}`;
}

const toFsValue = (value: unknown): Record<string, unknown> => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFsValue) } };
  if (typeof value === "object") {
    const fields: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) continue;
      fields[key] = toFsValue(nested);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
};

const toFsFields = (data: Record<string, unknown>): Record<string, any> => {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    fields[key] = toFsValue(value);
  }
  return fields;
};

/** Read a value out of a written `fields` tree, following dotted segments. */
function readNested(fields: Record<string, any>, path: string): Record<string, any> {
  const segments = path.split(".");
  let cursor: Record<string, any> | undefined = fields;
  for (let i = 0; i < segments.length; i += 1) {
    if (!cursor) return { nullValue: null };
    const node: Record<string, any> | undefined = cursor[segments[i]];
    if (node === undefined) return { nullValue: null };
    if (i === segments.length - 1) return node;
    cursor = node.mapValue?.fields as Record<string, any> | undefined;
  }
  return { nullValue: null };
}

/** Write a value into a doc's fields, creating nested maps for dotted paths. */
function writeNested(fields: Record<string, any>, path: string, value: Record<string, any>): void {
  const segments = path.split(".");
  let cursor = fields;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const node = cursor[segments[i]];
    if (!node || typeof node !== "object" || !node.mapValue) {
      cursor[segments[i]] = { mapValue: { fields: {} } };
    }
    cursor = cursor[segments[i]].mapValue.fields;
  }
  cursor[segments[segments.length - 1]] = value;
}

function decodeValue(value: any): unknown {
  if (value === null || value === undefined) return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(decodeValue);
  if ("mapValue" in value) return fromFsFields(value.mapValue?.fields || {});
  return null;
}

type RawFilter = { fieldFilter: { field: { fieldPath: string }; op?: string; value: any } };

function matchesFilter(doc: StoredDoc, filter: RawFilter): boolean {
  const wanted = decodeValue(filter.fieldFilter.value);
  const actual = decodeValue(readNested(doc.fields, filter.fieldFilter.field.fieldPath));
  switch (filter.fieldFilter.op || "EQUAL") {
    case "EQUAL":
      return actual === wanted;
    case "NOT_EQUAL":
      return actual !== wanted;
    case "LESS_THAN":
      return typeof actual === "number" && typeof wanted === "number" && actual < wanted;
    case "GREATER_THAN":
      return typeof actual === "number" && typeof wanted === "number" && actual > wanted;
    default:
      return false;
  }
}

function applyWrite(write: any): string | null {
  // ── delete ──
  if (write.delete) {
    store.delete(pathFromName(write.delete));
    return null;
  }

  // ── transform (atomic increment) ──
  if (write.transform) {
    const path = pathFromName(write.transform.document);
    const existing = store.get(path);
    if (!existing) return `FAILED_PRECONDITION: missing document ${path}`;
    for (const t of write.transform.fieldTransforms || []) {
      const delta = Number(decodeValue(t.increment) || 0);
      const current = Number(decodeValue(readNested(existing.fields, t.fieldPath)) || 0);
      writeNested(existing.fields, t.fieldPath, toFsValue(current + delta));
    }
    existing.updateTime = nextVersion();
    return null;
  }

  if (!write.update) return "INVALID_ARGUMENT: unknown write";

  const path = pathFromName(write.update.name);
  const existing = store.get(path);
  const precondition = write.currentDocument;

  if (precondition) {
    if (precondition.exists === false && existing) {
      return `FAILED_PRECONDITION: document already exists at ${path}`;
    }
    if (precondition.exists === true && !existing) {
      return `FAILED_PRECONDITION: no document to update at ${path}`;
    }
    if (precondition.updateTime !== undefined) {
      if (!existing) return `FAILED_PRECONDITION: no document to update at ${path}`;
      if (existing.updateTime !== precondition.updateTime) {
        return `FAILED_PRECONDITION: the stored version does not match the precondition at ${path}`;
      }
    }
  }

  const provided = write.update.fields || {};
  const mask: string[] | undefined = write.updateMask?.fieldPaths;

  if (!mask || !mask.length) {
    // Whole-document write (how `createWrite` behaves).
    store.set(path, { fields: JSON.parse(JSON.stringify(provided)), updateTime: nextVersion() });
    return null;
  }

  if (!existing) return `FAILED_PRECONDITION: no document to update at ${path}`;
  for (const fieldPath of mask) {
    writeNested(existing.fields, fieldPath, readNested(provided, fieldPath));
  }
  existing.updateTime = nextVersion();
  return null;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installStub(): void {
  const realFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    // Google OAuth — the JWT is still really signed by firestore.ts; we only
    // skip the round trip that would trade it for a token.
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      networkLog.push("oauth2.googleapis.com/token");
      return jsonResponse({ access_token: "stub-access-token", expires_in: 3600 });
    }

    // Paystack — canned, so a refund path can be exercised without the internet.
    if (url.startsWith("https://api.paystack.co/")) {
      networkLog.push(`paystack:${url.replace("https://api.paystack.co/", "")}`);
      return jsonResponse({
        status: true,
        message: "stub",
        data: { id: 1, status: "pending", amount: 100, transaction: { reference: "stub-ref" } },
      });
    }

    if (url.startsWith(`${DOCS_ROOT}/`) || url.startsWith(`${DOCS_ROOT}:`)) {
      networkLog.push(`firestore:${init?.method || "GET"}`);

      // ── runQuery ──
      if (url.endsWith(":runQuery")) {
        const body = JSON.parse(String(init?.body || "{}"));
        const sq = body.structuredQuery || {};
        const collectionId = sq.from?.[0]?.collectionId as string;
        type Row = StoredDoc & { __path: string };
        let rows: Row[] = [];
        for (const [path, doc] of store.entries()) {
          const parts = path.split("/");
          if (parts.length === 2 && parts[0] === collectionId) {
            rows.push({ ...doc, __path: path });
          }
        }

        const where = sq.where;
        if (where?.fieldFilter) {
          rows = rows.filter((doc) => matchesFilter(doc, where));
        } else if (where?.compositeFilter) {
          const filters: RawFilter[] = where.compositeFilter.filters || [];
          rows = rows.filter((doc) => filters.every((f) => matchesFilter(doc, f)));
        }

        if (sq.orderBy?.length) {
          const { field, direction } = sq.orderBy[0];
          const dir = direction === "DESCENDING" ? -1 : 1;
          rows = [...rows].sort((a, b) => {
            const av = decodeValue(readNested(a.fields, field.fieldPath));
            const bv = decodeValue(readNested(b.fields, field.fieldPath));
            if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
            return String(av).localeCompare(String(bv)) * dir;
          });
        }

        if (typeof sq.limit === "number") rows = rows.slice(0, sq.limit);

        // The document name matters: every caller takes the id from it, so a
        // blank name here would quietly change what the code under test does.
        return jsonResponse(
          rows.map((doc) => ({ document: { name: nameFromPath(doc.__path), fields: doc.fields } }))
        );
      }

      // ── commit ──
      if (url.endsWith(":commit")) {
        const body = JSON.parse(String(init?.body || "{}"));
        const writes = body.writes || [];
        commitCount += 1;
        commitOrder.push(writes.map((w: any) => pathFromName(w.update?.name || w.transform?.document || w.delete || "")));

        // Validate every write before applying any: Firestore commits are
        // atomic, so a failed precondition must leave the store untouched.
        for (const write of writes) {
          const name = pathFromName(write.update?.name || write.transform?.document || write.delete || "");
          const precondition = write.currentDocument;
          const existing = store.get(name);
          if (!precondition) continue;
          if (precondition.exists === false && existing) {
            return new Response("FAILED_PRECONDITION: document exists", { status: 409 });
          }
          if (precondition.updateTime !== undefined) {
            if (!existing || existing.updateTime !== precondition.updateTime) {
              return new Response("FAILED_PRECONDITION: version mismatch", { status: 409 });
            }
          }
        }

        for (const write of writes) {
          const failure = applyWrite(write);
          if (failure) return new Response(failure, { status: 409 });
        }
        return jsonResponse({ writeResults: writes.map(() => ({ updateTime: nextVersion() })) });
      }

      // ── getDocument ──
      const path = pathFromName(url);
      const doc = store.get(path);
      if (!doc) return new Response("NOT_FOUND", { status: 404 });
      return jsonResponse({ name: nameFromPath(path), fields: doc.fields, updateTime: doc.updateTime });
    }

    if (url.startsWith("https://exp.host/")) {
      networkLog.push("expo-push");
      return jsonResponse({ data: { status: "ok" } });
    }

    // Anything else would be a real outbound call. Fail loudly rather than
    // silently reaching the internet from a test.
    throw new Error(`UNSTUBBED NETWORK CALL: ${url}`);
  }) as typeof fetch;

  void realFetch;
}

// ─── Store helpers ────────────────────────────────────────────────────────

function put(path: string, data: Record<string, unknown>): void {
  store.set(path, { fields: toFsFields(data), updateTime: nextVersion() });
}

function get(path: string): Record<string, unknown> | null {
  const doc = store.get(path);
  return doc ? fromFsFields(doc.fields) : null;
}

function collectionDocs(collectionId: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const [path, doc] of store.entries()) {
    const parts = path.split("/");
    if (parts.length === 2 && parts[0] === collectionId) {
      out.push({ id: parts[1], ...fromFsFields(doc.fields) });
    }
  }
  return out;
}

function reset(): void {
  store.clear();
  commitCount = 0;
  commitOrder.length = 0;
  networkLog.length = 0;
}

// ─── Assertions ───────────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

async function expectApiError(label: string, fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
    check(label, false, "no error was thrown");
  } catch (error) {
    const actual = (error as { code?: string }).code;
    check(label, actual === code, `expected ${code}, got ${actual ?? String(error)}`);
  }
}

// ─── Fixture ──────────────────────────────────────────────────────────────

const CAPACITY = 12;
const DRIVER = "driver-1";
const MATE = "mate-1";
const OTHER_MATE = "mate-2";
const TRIP = "trip-1";

function seed(options: { offered?: number; capacity?: number } = {}): void {
  reset();
  const capacity = options.capacity ?? CAPACITY;
  const offered = options.offered ?? capacity;

  put(`drivers/${DRIVER}`, {
    userId: DRIVER,
    name: "Kwame Driver",
    vehicleRegistration: "GR-1234-24",
    vehicleColor: "White",
    vehicleCapacity: capacity,
    availableSeats: offered,
    online: true,
    status: "in_progress",
    locationUpdatedAt: new Date().toISOString(),
    vehicleLocation: { latitude: 5.6, longitude: -0.2 },
  });

  put("routes/route-1", {
    origin: "Omanjor",
    destination: "Accra",
    farePesewas: 500,
    active: true,
  });

  put(`trips/${TRIP}`, {
    driverId: DRIVER,
    routeId: "route-1",
    direction: "going",
    status: "in_progress",
    mateId: MATE,
    mateName: "Michael",
    mateCode: "ET-MT-18432",
    mateActive: true,
    startTime: new Date().toISOString(),
  });

  // A completed trip for the "mate from another trip" case.
  put("trips/trip-old", {
    driverId: "driver-other",
    routeId: "route-1",
    status: "completed",
    mateId: OTHER_MATE,
    mateActive: false,
  });

  put(`users/${MATE}`, { role: "mate", name: "Michael" });
}

/** A booking as the real flow would have left it, holding `seats`. */
function seedBooking(
  id: string,
  fields: Partial<Record<string, unknown>> & { seats: number; status: string }
): void {
  put(`bookings/${id}`, {
    passengerId: `passenger-${id}`,
    passengerName: `Passenger ${id}`,
    driverId: DRIVER,
    tripId: TRIP,
    routeId: "route-1",
    mateId: MATE,
    mateName: "Michael",
    pickupLocation: { latitude: 5.6, longitude: -0.2, address: "Omanjor" },
    dropOffLocation: { latitude: 5.61, longitude: -0.21, address: "Lapaz" },
    farePerSeatPesewas: 500,
    totalPesewas: 500 * fields.seats,
    paymentStatus: "not_started",
    currency: "GHS",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...fields,
  });
}

async function main(): Promise<void> {
  // A real RSA key, generated here, so firestore.ts signs its JWT for real.
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  let binary = "";
  for (const byte of pkcs8) binary += String.fromCharCode(byte);
  const pem = `-----BEGIN PRIVATE KEY-----\n${(btoa(binary).match(/.{1,64}/g) || []).join(
    "\n"
  )}\n-----END PRIVATE KEY-----`;

  Deno.env.set("FIREBASE_PROJECT_ID", PROJECT);
  Deno.env.set("FIREBASE_CLIENT_EMAIL", "phase4@phase4-test.iam.gserviceaccount.com");
  Deno.env.set("FIREBASE_PRIVATE_KEY", pem);
  Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test_phase4");
  Deno.env.set("PAYSTACK_ENV", "test");

  installStub();

  // Imported after the environment is in place, so no module reads a missing
  // secret at load time.
  const { releaseSeatsOnce, completeBooking, markPickedUp, driverDecide, expireStaleHolds, getBooking } =
    await import("../functions/_shared/bookings.ts");
  const { readSeatUsage, assertOfferAllowed, DEFAULT_VEHICLE_CAPACITY } = await import("../functions/_shared/seats.ts");
  const { setSeatsOfferedCore } = await import("../functions/_shared/mates.ts");
  const { setDriverCapacityCore, endTripCore } = await import("../functions/_shared/tripFlow.ts");
  const { cancelBookingCore } = await import("../functions/_shared/cancelFlow.ts");

  console.log("EasyTroski — Phase 4 seat recycling\n==================================");

  // ─────────────────────────────────────────────────────────────────────────
  section("1. The seat model, before anything moves");

  seed();
  let usage = await readSeatUsage(DRIVER);
  check("a fresh vehicle offers its whole capacity", usage.offered === CAPACITY, JSON.stringify(usage));
  check("nothing is committed yet", usage.committed === 0);
  check("capacity is read from the driver document", usage.capacity === CAPACITY);
  check("maxOffer is capacity when nothing is taken", usage.maxOffer === CAPACITY);
  check("the default capacity matches the app's fallback", DEFAULT_VEHICLE_CAPACITY === 12);

  seed();
  await expectApiError(
    "offering more seats than the vehicle holds is refused",
    () => setSeatsOfferedCore(MATE, CAPACITY + 1),
    "seats_over_capacity"
  );
  await expectApiError(
    "a negative seat count is refused",
    () => assertOfferAllowed(DRIVER, -1),
    "invalid_request"
  );

  // ─────────────────────────────────────────────────────────────────────────
  section("2. Holding seats (unchanged behaviour)");

  seed();
  const { createBookingRequest } = await import("../functions/_shared/bookings.ts");
  const created = await createBookingRequest({
    passengerId: "passenger-a",
    passengerName: "Ama",
    driverId: DRIVER,
    routeId: "route-1",
    seats: 3,
    pickupLocation: { latitude: 5.6, longitude: -0.2, address: "Omanjor" },
    dropOffLocation: { latitude: 5.61, longitude: -0.21, address: "Lapaz" },
  });

  check("3 seats were held", Number(get(`drivers/${DRIVER}`)?.availableSeats) === CAPACITY - 3);
  usage = await readSeatUsage(DRIVER);
  check("committed counts the held seats", usage.committed === 3);
  check("held seats show as waiting", usage.waiting === 3);
  check("on board is still empty", usage.onBoard === 0);

  const bookingA = created.bookingId;

  // ─────────────────────────────────────────────────────────────────────────
  section("3. Who may decide a booking");

  await expectApiError("the driver cannot accept a request", () => driverDecide(bookingA, DRIVER, "accept"), "mate_required");
  await expectApiError("the driver cannot reject a request", () => driverDecide(bookingA, DRIVER, "reject"), "mate_required");
  await expectApiError(
    "a mate who is not on this trip cannot decide",
    () => driverDecide(bookingA, OTHER_MATE, "accept"),
    "not_your_trip"
  );

  await driverDecide(bookingA, MATE, "accept");
  check("the assigned mate can accept", get(`bookings/${bookingA}`)?.status === "awaiting_payment");

  // Payment verification is a provider round trip (already covered elsewhere),
  // so the paid state is written directly. Seats are unchanged by payment — the
  // hold simply stops expiring.
  put(`bookings/${bookingA}`, {
    ...(get(`bookings/${bookingA}`) as Record<string, unknown>),
    status: "confirmed",
    paymentStatus: "paid",
    paidAt: new Date().toISOString(),
  });

  await expectApiError("the driver cannot mark a pickup", () => markPickedUp(bookingA, DRIVER), "mate_required");
  await markPickedUp(bookingA, MATE);
  const pickedUp = get(`bookings/${bookingA}`) as Record<string, unknown>;
  check("the mate's pickup is recorded", pickedUp.status === "picked_up");
  check("the pickup names the mate who did it", pickedUp.pickedUpBy === MATE && pickedUp.pickedUpByRole === "mate");

  usage = await readSeatUsage(DRIVER);
  check("an on-board passenger still holds their seats", usage.onBoard === 3 && usage.committed === 3);

  // ─────────────────────────────────────────────────────────────────────────
  section("4. Drop-off returns the seats (the Phase 4 feature)");

  await expectApiError(
    "the driver cannot drop a passenger off",
    () => completeBooking(bookingA, DRIVER),
    "mate_required"
  );
  await expectApiError(
    "a mate from another trip cannot drop a passenger off",
    () => completeBooking(bookingA, OTHER_MATE),
    "not_your_trip"
  );

  await completeBooking(bookingA, MATE);
  const dropped = get(`bookings/${bookingA}`) as Record<string, unknown>;
  check("the passenger is recorded as dropped off", dropped.status === "completed");
  check("the drop-off time is recorded", typeof dropped.completedAt === "string");
  check("the drop-off names the mate who did it", dropped.droppedOffBy === MATE && dropped.droppedOffByRole === "mate");
  check("the seat release is stamped", typeof dropped.seatReleasedAt === "string");
  check("the release reason is the drop-off", dropped.seatReleaseReason === "dropped_off");
  check("the booking is kept, not deleted", get(`bookings/${bookingA}`) !== null);
  check(
    "the passenger's history survives the drop-off",
    dropped.passengerName === "Ama" &&
      String(dropped.pickupLocation && (dropped.pickupLocation as Record<string, unknown>).address) === "Omanjor" &&
      Number(dropped.totalPesewas) === 1500,
    JSON.stringify(dropped.passengerName)
  );

  const offeredAfterDrop = Number(get(`drivers/${DRIVER}`)?.availableSeats);
  check("exactly 3 seats came back", offeredAfterDrop === CAPACITY, `offered=${offeredAfterDrop}`);
  usage = await readSeatUsage(DRIVER);
  check("nothing is committed after the drop-off", usage.committed === 0);
  check("the invariant holds: offered + committed = capacity", usage.offered + usage.committed === CAPACITY);

  // ─────────────────────────────────────────────────────────────────────────
  section("5. Idempotency — a double tap must not return the seats twice");

  const firstReleaseStamp = String((get(`bookings/${bookingA}`) as Record<string, unknown>).seatReleasedAt);
  const offeredBeforeSecond = Number(get(`drivers/${DRIVER}`)?.availableSeats);

  await completeBooking(bookingA, MATE);
  await completeBooking(bookingA, MATE);
  await releaseSeatsOnce(bookingA, { actorId: MATE, actorRole: "mate", reason: "dropped_off" });
  await releaseSeatsOnce(bookingA, { actorId: MATE, actorRole: "mate", reason: "dropped_off" });

  const offeredAfterRepeats = Number(get(`drivers/${DRIVER}`)?.availableSeats);
  check("repeated drop-offs do not add seats", offeredAfterRepeats === offeredBeforeSecond, `${offeredBeforeSecond} → ${offeredAfterRepeats}`);
  check("the seats never exceed capacity", offeredAfterRepeats <= CAPACITY);
  check(
    "the release stamp is not rewritten",
    String((get(`bookings/${bookingA}`) as Record<string, unknown>).seatReleasedAt) === firstReleaseStamp
  );

  const releases = collectionDocs("auditLogs").filter((row) => row.event === "SEATS_RELEASED");
  check("seats were recorded as released exactly once", releases.length === 1, `${releases.length} audit rows`);
  const releaseMeta = (releases[0]?.meta || {}) as Record<string, unknown>;
  check("the release audit names the mate", releaseMeta.mateId === MATE && releaseMeta.mateCode === "ET-MT-18432");
  check("the release audit records the seat count", Number(releaseMeta.seats) === 3);

  // ─────────────────────────────────────────────────────────────────────────
  section("6. Only the seats that got off come back");

  seed();
  // 12 seats: A holds 2, B holds 3 (paid, on board). A gets off.
  seedBooking("stay", { seats: 3, status: "picked_up", paymentStatus: "paid" });
  seedBooking("leave", { seats: 2, status: "picked_up", paymentStatus: "paid" });
  put(`drivers/${DRIVER}`, { ...(get(`drivers/${DRIVER}`) as Record<string, unknown>), availableSeats: CAPACITY - 5 });

  await completeBooking("leave", MATE);
  usage = await readSeatUsage(DRIVER);
  check("only the 2 seats released came back", usage.offered === CAPACITY - 5 + 2, JSON.stringify(usage));
  check("the passenger still on board keeps their 3 seats", usage.onBoard === 3);
  check("the drop-off did not touch the other booking", get("bookings/stay")?.status === "picked_up");
  check("the other booking was not released", get("bookings/stay")?.seatReleasedAt == null);
  check("the invariant still holds", usage.offered + usage.committed === CAPACITY);

  // ─────────────────────────────────────────────────────────────────────────
  section("7. Getting off before the final stop (intermediate destination)");

  seed();
  seedBooking("lapaz", {
    seats: 2,
    status: "picked_up",
    paymentStatus: "paid",
    dropOffLocation: { latitude: 5.61, longitude: -0.21, address: "Lapaz" },
  });
  put(`drivers/${DRIVER}`, { ...(get(`drivers/${DRIVER}`) as Record<string, unknown>), availableSeats: CAPACITY - 2 });

  await completeBooking("lapaz", MATE);
  usage = await readSeatUsage(DRIVER);
  check("a passenger can get off mid-route and free their seats", usage.offered === CAPACITY, JSON.stringify(usage));
  check(
    "the record keeps where they were going",
    ((get("bookings/lapaz") as Record<string, unknown>).dropOffLocation as Record<string, unknown>)?.address === "Lapaz"
  );

  const refill = await createBookingRequest({
    passengerId: "passenger-later",
    passengerName: "Kofi",
    driverId: DRIVER,
    routeId: "route-1",
    seats: 2,
    pickupLocation: { latitude: 5.61, longitude: -0.21, address: "Lapaz" },
    dropOffLocation: { latitude: 5.63, longitude: -0.22, address: "Accra" },
  });
  check("a new passenger can take the freed seats", typeof refill.bookingId === "string");
  usage = await readSeatUsage(DRIVER);
  check("the freed seats were resold exactly once", usage.offered === CAPACITY - 2 && usage.committed === 2);
  check("the invariant holds after resale", usage.offered + usage.committed === CAPACITY);

  // ─────────────────────────────────────────────────────────────────────────
  section("8. Mate seat control, bounded by what is already taken");

  seed();
  seedBooking("held", { seats: 5, status: "confirmed", paymentStatus: "paid" });
  put(`drivers/${DRIVER}`, { ...(get(`drivers/${DRIVER}`) as Record<string, unknown>), availableSeats: CAPACITY - 5 });

  const seven = await setSeatsOfferedCore(MATE, CAPACITY - 5);
  check("the mate can keep all free seats on offer", seven.offered === 7 && seven.committed === 5);

  await expectApiError(
    "the mate cannot offer a seat a passenger already holds",
    () => setSeatsOfferedCore(MATE, 8),
    "seats_over_capacity"
  );

  const restricted = await setSeatsOfferedCore(MATE, 2);
  check("the mate can reduce the seats on offer", restricted.offered === 2);
  check("reducing the offer does not touch paid seats", restricted.committed === 5);

  const auditRows = collectionDocs("auditLogs").filter((row) => row.event === "SEATS_OFFERED_SET");
  check("seat-offer changes are recorded", auditRows.length >= 1);
  const setMeta = (auditRows[auditRows.length - 1]?.meta || {}) as Record<string, unknown>;
  check("the seat-offer audit names the mate and the trip", setMeta.mateId === MATE && setMeta.tripId === TRIP);
  check("the seat-offer audit keeps the old and new value", Number(setMeta.previousOffered) === 7 && Number(setMeta.offered) === 2);

  seed();
  seedBooking("holds-3", { seats: 3, status: "confirmed", paymentStatus: "paid" });
  put(`drivers/${DRIVER}`, { ...(get(`drivers/${DRIVER}`) as Record<string, unknown>), availableSeats: CAPACITY - 3 });
  const driverSet = await setDriverCapacityCore(DRIVER, CAPACITY - 3);
  check("the driver can offer every genuinely free seat", driverSet.availableSeats === CAPACITY - 3, JSON.stringify(driverSet));
  await expectApiError(
    "the driver cannot offer a seat a passenger already holds either",
    () => setDriverCapacityCore(DRIVER, CAPACITY),
    "seats_over_capacity"
  );
  check(
    "the refused write left the seat count alone",
    Number(get(`drivers/${DRIVER}`)?.availableSeats) === CAPACITY - 3,
    String(get(`drivers/${DRIVER}`)?.availableSeats)
  );

  // ─────────────────────────────────────────────────────────────────────────
  section("9. Two passengers, one last seat (a real race)");

  // A nearly-full vehicle: 10 seats are on board, 2 are left to sell. Seeding
  // the matching booking keeps offered + committed = capacity, which is the
  // state a real trip is always in.
  seed({ offered: 2 });
  seedBooking("already-aboard", { seats: 10, status: "picked_up", paymentStatus: "paid" });
  const racers = await Promise.allSettled([
    createBookingRequest({
      passengerId: "racer-a",
      passengerName: "Racer A",
      driverId: DRIVER,
      routeId: "route-1",
      seats: 2,
      pickupLocation: { latitude: 5.6, longitude: -0.2 },
      dropOffLocation: { latitude: 5.61, longitude: -0.21 },
    }),
    createBookingRequest({
      passengerId: "racer-b",
      passengerName: "Racer B",
      driverId: DRIVER,
      routeId: "route-1",
      seats: 2,
      pickupLocation: { latitude: 5.6, longitude: -0.2 },
      dropOffLocation: { latitude: 5.61, longitude: -0.21 },
    }),
  ]);

  const won = racers.filter((r) => r.status === "fulfilled").length;
  const lost = racers.filter(
    (r) => r.status === "rejected" && (r.reason as { code?: string })?.code === "no_seats"
  ).length;
  check("only one of the two racers got the last seats", won === 1, `${won} succeeded`);
  check("the other was told the seats were gone", lost === 1, `${lost} refused with no_seats`);

  usage = await readSeatUsage(DRIVER);
  check("the last 2 seats went to exactly one racer", usage.offered === 0, JSON.stringify(usage));
  check("the seats were handed out once, not twice", usage.committed === CAPACITY, JSON.stringify(usage));
  check("no seat was over-committed", usage.committed <= usage.capacity);
  check("the counter never went negative", usage.offered >= 0);
  check("the invariant survived the race", usage.offered + usage.committed === CAPACITY);
  check("the compare-and-swap really had to retry", commitCount > 2, `${commitCount} commits`);

  // ─────────────────────────────────────────────────────────────────────────
  section("10. A drop-off racing a new booking");

  seed({ offered: CAPACITY - 2 });
  seedBooking("onboard", { seats: 2, status: "picked_up", paymentStatus: "paid" });

  const [bookResult, dropResult] = await Promise.allSettled([
    createBookingRequest({
      passengerId: "racing-booker",
      passengerName: "Racing Booker",
      driverId: DRIVER,
      routeId: "route-1",
      seats: 2,
      pickupLocation: { latitude: 5.6, longitude: -0.2 },
      dropOffLocation: { latitude: 5.61, longitude: -0.21 },
    }),
    completeBooking("onboard", MATE),
  ]);

  check("the booking succeeded alongside the drop-off", bookResult.status === "fulfilled");
  check("the drop-off succeeded alongside the booking", dropResult.status === "fulfilled");

  usage = await readSeatUsage(DRIVER);
  check("the freed seats and the sold seats both counted exactly once", usage.offered === CAPACITY - 2, JSON.stringify(usage));
  check("the new passenger's 2 seats are the only ones committed", usage.committed === 2);
  check("nothing went negative in the race", usage.offered >= 0 && usage.committed >= 0);
  check("the race left the invariant intact", usage.offered + usage.committed === CAPACITY);

  // ─────────────────────────────────────────────────────────────────────────
  section("11. Regression — the existing release paths still release once");

  seed();
  seedBooking("stale-hold", {
    seats: 2,
    status: "pending",
    seatHoldExpiresAt: new Date(Date.now() - 60_000).toISOString(),
  });
  put(`drivers/${DRIVER}`, { ...(get(`drivers/${DRIVER}`) as Record<string, unknown>), availableSeats: CAPACITY - 2 });

  await expireStaleHolds();
  await expireStaleHolds();
  check("an expired hold is cancelled", get("bookings/stale-hold")?.status === "cancelled");
  check(
    "an expired hold returns its seats exactly once",
    Number(get(`drivers/${DRIVER}`)?.availableSeats) === CAPACITY,
    String(get(`drivers/${DRIVER}`)?.availableSeats)
  );

  seed();
  seedBooking("cancel-me", { seats: 3, status: "confirmed", paymentStatus: "paid" });
  put(`drivers/${DRIVER}`, { ...(get(`drivers/${DRIVER}`) as Record<string, unknown>), availableSeats: CAPACITY - 3 });

  await cancelBookingCore({ bookingId: "cancel-me", by: "passenger", actorId: "passenger-cancel-me" });
  await cancelBookingCore({ bookingId: "cancel-me", by: "passenger", actorId: "passenger-cancel-me" }).catch(() => {});
  check("a cancelled booking returns its seats exactly once", Number(get(`drivers/${DRIVER}`)?.availableSeats) === CAPACITY);

  seed();
  seedBooking("paid-on-trip", { seats: 4, status: "confirmed", paymentStatus: "paid" });
  put(`drivers/${DRIVER}`, { ...(get(`drivers/${DRIVER}`) as Record<string, unknown>), availableSeats: CAPACITY - 4 });

  await endTripCore(DRIVER, TRIP);
  check("ending the trip cancels the paid booking", get("bookings/paid-on-trip")?.status === "cancelled");
  check(
    "ending the trip releases the booking's hold on its seats",
    typeof get("bookings/paid-on-trip")?.seatReleasedAt === "string"
  );
  check(
    "an offline vehicle advertises no seats at all",
    Number(get(`drivers/${DRIVER}`)?.availableSeats) === 0,
    String(get(`drivers/${DRIVER}`)?.availableSeats)
  );
  check(
    "no seat was lost — nothing is committed and the vehicle is whole",
    (await readSeatUsage(DRIVER)).committed === 0 && (await readSeatUsage(DRIVER)).capacity === CAPACITY
  );
  check("the trip is closed", get(`trips/${TRIP}`)?.status === "completed");
  check("the mate's assignment ends but their identity is kept", get(`trips/${TRIP}`)?.mateActive === false && get(`trips/${TRIP}`)?.mateId === MATE);
  check("the driver goes offline with no seats advertised", get(`drivers/${DRIVER}`)?.online === false && Number(get(`drivers/${DRIVER}`)?.availableSeats) === 0);
  check("a refund was attempted for the money taken", networkLog.some((entry) => entry.startsWith("paystack:")), networkLog.join(","));
  check("no unstubbed call escaped the harness", !networkLog.some((entry) => entry === "OTHER"));

  // A mate whose trip has ended can no longer act on its bookings.
  seed();
  seedBooking("after-end", { seats: 1, status: "confirmed", paymentStatus: "paid" });
  put(`trips/${TRIP}`, { ...(get(`trips/${TRIP}`) as Record<string, unknown>), status: "completed", mateActive: false });
  await expectApiError(
    "a mate cannot act after their trip has ended",
    () => completeBooking("after-end", MATE),
    "not_your_trip"
  );
  check("no seats were released by the refused action", Number(get(`drivers/${DRIVER}`)?.availableSeats) === CAPACITY);

  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n==================================`);
  console.log(`${passed} checks passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const failure of failures) console.log(`  · ${failure}`);
    Deno.exit(1);
  }
}

await main();
