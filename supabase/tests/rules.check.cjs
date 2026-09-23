// ---------------------------------------------------------------------------
// Firestore rules — authority regression check
//
// Evaluates `firestore.rules` against the cases that matter, using the official
// Firebase Rules API `:test` endpoint. Nothing is deployed and no project data
// is read or written: the API compiles the source and answers allow/deny for
// each synthetic request. A mismatch exits 1, so this belongs in CI.
//
//   node supabase/tests/rules.check.cjs
//
// It needs a way to authenticate to Google. Any one of these works:
//
//   1. GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
//   2. FIREBASE_RULES_TOKEN=<an OAuth access token with the firebase scope>
//   3. The Firebase CLI's own login on this machine (`firebase login`), which
//      is what a developer normally has. Use only on a trusted machine.
//
// The project id is read from .env / .env.local, so this follows the project
// rather than hard-coding one.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Firebase CLI's public OAuth client (shipped in firebase-tools; not a secret).
const CLI_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLI_CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

const root = path.resolve(__dirname, "..", "..");

function readEnvValue(key) {
  for (const file of [".env.local", ".env"]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (match && match[1] === key) return match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return null;
}

const PROJECT =
  process.env.FIREBASE_PROJECT_ID || readEnvValue("EXPO_PUBLIC_FIREBASE_PROJECT_ID");

function base64Url(input) {
  const buffer = Buffer.isBuffer(input)
    ? input
    : Buffer.from(typeof input === "string" ? input : JSON.stringify(input));
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function tokenFromServiceAccount(file) {
  const sa = JSON.parse(fs.readFileSync(file, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url({ alg: "RS256", typ: "JWT" });
  const claims = base64Url({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = base64Url(signer.sign(sa.private_key));

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error("service-account token exchange failed");
  return body.access_token;
}

async function tokenFromFirebaseCli() {
  const configPath = path.join(
    process.env.USERPROFILE || process.env.HOME || "",
    ".config",
    "configstore",
    "firebase-tools.json"
  );
  if (!fs.existsSync(configPath)) throw new Error("no Firebase CLI login found");
  const refreshToken = JSON.parse(fs.readFileSync(configPath, "utf8")).tokens?.refresh_token;
  if (!refreshToken) throw new Error("Firebase CLI has no refresh token");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLI_CLIENT_ID,
      client_secret: CLI_CLIENT_SECRET,
    }),
  });
  const body = await response.json();
  if (!body.access_token) throw new Error("Firebase CLI token exchange failed");
  return body.access_token;
}

async function accessToken() {
  if (process.env.FIREBASE_RULES_TOKEN) return process.env.FIREBASE_RULES_TOKEN;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return tokenFromServiceAccount(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  return tokenFromFirebaseCli();
}

// ─── Cases ────────────────────────────────────────────────────────────────
//
// `expectation` is what the rules MUST answer. Anything else fails the run.

const DB = "/databases/(default)/documents";
const alice = { uid: "alice", token: {} };
const bob = { uid: "bob", token: {} };
const driver = { uid: "d1", token: {} };
const mate = { uid: "m1", token: {} };

/** Mock the `get()` that isAdmin() performs, in the exact form the API records. */
const roleMock = (uid, role) => ({
  function: "get",
  args: [{ exactValue: `/databases/%28default%29/documents/users/${uid}` }],
  result: { value: { data: { role } } },
});

const userDoc = (role, extra = {}) => ({
  data: { name: "A User", email: "a@example.com", role, ...extra },
});

const cases = [
  // ── Objective 1: a profile cannot claim authority ──────────────────────
  {
    label: "SECURITY: a passenger cannot make themselves an admin",
    expectation: "DENY",
    request: {
      path: `${DB}/users/alice`,
      method: "update",
      auth: alice,
      resource: userDoc("admin"),
    },
    resource: userDoc("passenger"),
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "SECURITY: a driver cannot make themselves an admin",
    expectation: "DENY",
    request: {
      path: `${DB}/users/d1`,
      method: "update",
      auth: driver,
      resource: userDoc("admin"),
    },
    resource: userDoc("driver"),
    functionMocks: [roleMock("d1", "driver")],
  },
  {
    label: "SECURITY: a mate cannot make themselves an admin",
    expectation: "DENY",
    request: {
      path: `${DB}/users/m1`,
      method: "update",
      auth: mate,
      resource: userDoc("admin"),
    },
    resource: userDoc("mate"),
    functionMocks: [roleMock("m1", "mate")],
  },
  {
    label: "a new account cannot be created as an admin",
    expectation: "DENY",
    request: {
      path: `${DB}/users/carol`,
      method: "create",
      auth: { uid: "carol", token: {} },
      resource: userDoc("admin"),
    },
  },
  {
    label: "a new account can be created as a passenger",
    expectation: "ALLOW",
    request: {
      path: `${DB}/users/carol`,
      method: "create",
      auth: { uid: "carol", token: {} },
      resource: userDoc("passenger"),
    },
  },
  {
    label: "a passenger cannot change somebody else's role",
    expectation: "DENY",
    request: {
      path: `${DB}/users/bob`,
      method: "update",
      auth: alice,
      resource: userDoc("admin", { name: "Bob" }),
    },
    resource: userDoc("passenger", { name: "Bob" }),
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "a passenger may still edit their own profile",
    expectation: "ALLOW",
    request: {
      path: `${DB}/users/alice`,
      method: "update",
      auth: alice,
      resource: { data: { name: "Alice A.", phone: "0244000000", role: "passenger" } },
    },
    resource: userDoc("passenger"),
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "a passenger may still switch to the driver app",
    expectation: "ALLOW",
    request: {
      path: `${DB}/users/alice`,
      method: "update",
      auth: alice,
      resource: userDoc("driver"),
    },
    resource: userDoc("passenger"),
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "a passenger cannot write a field the app never writes",
    expectation: "DENY",
    request: {
      path: `${DB}/users/alice`,
      method: "update",
      auth: alice,
      resource: userDoc("passenger", { isAdmin: true, walletBalancePesewas: 999999 }),
    },
    resource: userDoc("passenger"),
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "a user cannot point their profile at another account",
    expectation: "DENY",
    request: {
      path: `${DB}/users/alice`,
      method: "update",
      auth: alice,
      resource: userDoc("passenger", { uid: "bob" }),
    },
    resource: userDoc("passenger", { uid: "alice" }),
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "an admin can still change a role (server-verified role)",
    expectation: "ALLOW",
    request: {
      path: `${DB}/users/bob`,
      method: "update",
      auth: alice,
      resource: userDoc("mate", { name: "Bob" }),
    },
    resource: userDoc("passenger", { name: "Bob" }),
    functionMocks: [roleMock("alice", "admin")],
  },
  {
    label: "as a passenger, alice cannot read the payments ledger",
    expectation: "DENY",
    request: { path: `${DB}/payments/pay_1`, method: "get", auth: alice },
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "as a passenger, alice cannot read the audit log",
    expectation: "DENY",
    request: { path: `${DB}/auditLogs/log_1`, method: "get", auth: alice },
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "as a passenger, alice cannot rewrite a fare",
    expectation: "DENY",
    request: {
      path: `${DB}/routes/omanjor-accra`,
      method: "update",
      auth: alice,
      resource: { data: { origin: "Omanjor", destination: "Accra", farePesewas: 1 } },
    },
    resource: { data: { origin: "Omanjor", destination: "Accra", farePesewas: 1000 } },
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "a real admin can still set a fare",
    expectation: "ALLOW",
    request: {
      path: `${DB}/routes/omanjor-accra`,
      method: "update",
      auth: alice,
      resource: { data: { origin: "Omanjor", destination: "Accra", farePesewas: 700 } },
    },
    resource: { data: { origin: "Omanjor", destination: "Accra", farePesewas: 1000 } },
    functionMocks: [roleMock("alice", "admin")],
  },

  // ── Objective 2: the vehicle's capacity is not client-writable ─────────
  {
    label: "SECURITY: a driver cannot raise their vehicle's capacity",
    expectation: "DENY",
    request: {
      path: `${DB}/drivers/d1`,
      method: "update",
      auth: driver,
      resource: { data: { userId: "d1", vehicleCapacity: 60, availableSeats: 12 } },
    },
    resource: { data: { userId: "d1", vehicleCapacity: 12, availableSeats: 12 } },
    functionMocks: [roleMock("d1", "driver")],
  },
  {
    label: "the driver can still declare it once, at registration",
    expectation: "ALLOW",
    request: {
      path: `${DB}/drivers/d1`,
      method: "create",
      auth: driver,
      resource: { data: { userId: "d1", vehicleCapacity: 12, availableSeats: 12 } },
    },
  },
  {
    label: "an admin can still correct a capacity",
    expectation: "ALLOW",
    request: {
      path: `${DB}/drivers/d1`,
      method: "update",
      auth: alice,
      resource: { data: { userId: "d1", vehicleCapacity: 14, availableSeats: 14 } },
    },
    resource: { data: { userId: "d1", vehicleCapacity: 12, availableSeats: 12 } },
    functionMocks: [roleMock("alice", "admin")],
  },
  {
    label: "SECURITY: a driver still cannot write their own seat counter",
    expectation: "DENY",
    request: {
      path: `${DB}/drivers/d1`,
      method: "update",
      auth: driver,
      resource: { data: { userId: "d1", vehicleCapacity: 12, availableSeats: 60 } },
    },
    resource: { data: { userId: "d1", vehicleCapacity: 12, availableSeats: 12 } },
    functionMocks: [roleMock("d1", "driver")],
  },

  // ── Objective 3: live bookings cannot be deleted from a client ─────────
  {
    label: "SECURITY: a passenger cannot delete a pending booking",
    expectation: "DENY",
    request: { path: `${DB}/bookings/bk_1`, method: "delete", auth: alice },
    resource: { data: { passengerId: "alice", driverId: "d1", status: "pending", seats: 2 } },
  },
  {
    label: "SECURITY: a passenger cannot delete an unpaid booking",
    expectation: "DENY",
    request: { path: `${DB}/bookings/bk_2`, method: "delete", auth: alice },
    resource: { data: { passengerId: "alice", driverId: "d1", status: "awaiting_payment" } },
  },
  {
    label: "SECURITY: a passenger cannot delete a confirmed booking",
    expectation: "DENY",
    request: { path: `${DB}/bookings/bk_3`, method: "delete", auth: alice },
    resource: { data: { passengerId: "alice", driverId: "d1", status: "confirmed", seats: 1 } },
  },
  {
    label: "SECURITY: a passenger cannot delete the booking they are sitting in",
    expectation: "DENY",
    request: { path: `${DB}/bookings/bk_4`, method: "delete", auth: alice },
    resource: { data: { passengerId: "alice", driverId: "d1", status: "picked_up", seats: 3 } },
  },
  {
    label: "a passenger can still clear a finished booking from history",
    expectation: "ALLOW",
    request: { path: `${DB}/bookings/bk_5`, method: "delete", auth: alice },
    resource: { data: { passengerId: "alice", driverId: "d1", status: "completed" } },
  },
  {
    label: "a cancelled booking can be cleared too",
    expectation: "ALLOW",
    request: { path: `${DB}/bookings/bk_6`, method: "delete", auth: alice },
    resource: { data: { passengerId: "alice", driverId: "d1", status: "cancelled" } },
  },
  {
    label: "a passenger cannot delete somebody else's finished booking",
    expectation: "DENY",
    request: { path: `${DB}/bookings/bk_7`, method: "delete", auth: alice },
    resource: { data: { passengerId: "bob", driverId: "d1", status: "completed" } },
  },

  // ── Unchanged protections (regression) ────────────────────────────────
  {
    label: "a client cannot forge a paid booking",
    expectation: "DENY",
    request: {
      path: `${DB}/bookings/bk_8`,
      method: "create",
      auth: alice,
      resource: { data: { passengerId: "alice", totalPesewas: 0, status: "confirmed" } },
    },
  },
  {
    label: "a driver cannot accept a booking by writing it",
    expectation: "DENY",
    request: {
      path: `${DB}/bookings/bk_9`,
      method: "update",
      auth: driver,
      resource: { data: { status: "confirmed", paymentStatus: "paid" } },
    },
    resource: { data: { driverId: "d1", passengerId: "alice", status: "pending" } },
  },
  {
    label: "a client cannot write a trip's mate assignment",
    expectation: "DENY",
    request: {
      path: `${DB}/trips/t1`,
      method: "update",
      auth: driver,
      resource: { data: { status: "in_progress", mateId: "mallory", mateActive: true } },
    },
    resource: { data: { driverId: "d1", status: "in_progress" } },
  },
  {
    label: "a trip cannot be created with a mate already on it",
    expectation: "DENY",
    request: {
      path: `${DB}/trips/t2`,
      method: "create",
      auth: driver,
      resource: { data: { driverId: "d1", routeId: "route-1", status: "in_progress", mateId: "m1" } },
    },
  },
  {
    label: "a passenger cannot read another passenger's booking",
    expectation: "DENY",
    request: { path: `${DB}/bookings/bk_10`, method: "get", auth: alice },
    resource: { data: { passengerId: "bob", driverId: "d1" } },
  },
  {
    label: "a mate cannot read a booking that does not name them",
    expectation: "DENY",
    request: { path: `${DB}/bookings/bk_11`, method: "get", auth: mate },
    resource: { data: { passengerId: "alice", driverId: "d1", mateId: "other" } },
  },
  {
    label: "a mate can read the booking that names them",
    expectation: "ALLOW",
    request: { path: `${DB}/bookings/bk_12`, method: "get", auth: mate },
    resource: { data: { passengerId: "alice", driverId: "d1", mateId: "m1" } },
  },
  {
    label: "the webhook ledger stays backend-only",
    expectation: "DENY",
    request: { path: `${DB}/webhookEvents/e1`, method: "get", auth: alice },
    functionMocks: [roleMock("alice", "passenger")],
  },
  {
    label: "the ID ledger stays backend-only",
    expectation: "DENY",
    request: { path: `${DB}/idCodes/ET-DV-12345`, method: "get", auth: alice },
    functionMocks: [roleMock("alice", "passenger")],
  },
];

// ─── Run ──────────────────────────────────────────────────────────────────

(async () => {
  if (!PROJECT) {
    console.error("No Firebase project id: set FIREBASE_PROJECT_ID or EXPO_PUBLIC_FIREBASE_PROJECT_ID.");
    process.exit(2);
  }

  const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
  let token;
  try {
    token = await accessToken();
  } catch (error) {
    console.error(`Could not authenticate to Google: ${error.message}`);
    console.error("Set GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_RULES_TOKEN, or run `firebase login`.");
    process.exit(2);
  }

  const response = await fetch(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        source: { files: [{ name: "firestore.rules", content: rules }] },
        testSuite: {
          testCases: cases.map(({ label, ...testCase }) => testCase),
        },
      }),
    }
  );

  const body = await response.json();
  if (!response.ok) {
    console.error("Rules API rejected the request:", response.status);
    console.error(JSON.stringify(body).slice(0, 1500));
    process.exit(2);
  }

  const results = body.testResults || body.results || [];
  console.log(`EasyTroski — Firestore rules authority check (project ${PROJECT})\n`);

  let failures = 0;
  results.forEach((result, index) => {
    const testCase = cases[index];
    const ok = result.state === "SUCCESS";
    if (!ok) failures += 1;
    console.log(`${ok ? "  ok  " : "  FAIL"} ${testCase.label} — expected ${testCase.expectation}`);
    if (!ok) {
      const detail = JSON.stringify(result.debugMessages || result.errorPosition || result).slice(0, 300);
      console.log(`       ${detail}`);
    }
  });

  console.log(`\n${results.length} cases, ${failures} behaved differently from the expectation`);
  if (failures > 0) process.exit(1);
})();
