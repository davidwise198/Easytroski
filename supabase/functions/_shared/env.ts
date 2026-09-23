// ---------------------------------------------------------------------------
// Environment access
//
// Secrets live only here (Supabase function secrets). They are never sent to
// the mobile app and never committed. A missing secret fails loudly rather
// than silently disabling verification.
// ---------------------------------------------------------------------------

function read(name: string, required = true): string {
  const value = Deno.env.get(name);
  if (!value) {
    if (required) throw new Error(`Missing required secret: ${name}`);
    return "";
  }
  return value;
}

/** Paystack private key. Test keys start with sk_test_, live with sk_live_. */
export const PAYSTACK_SECRET_KEY = () => read("PAYSTACK_SECRET_KEY");

export const PAYSTACK_ENV = (): "test" | "live" =>
  (Deno.env.get("PAYSTACK_ENV") || "test").toLowerCase() === "live" ? "live" : "test";

/** True when live keys are in use — surfaced to clients as a safety flag. */
export function isLiveMode(): boolean {
  const key = PAYSTACK_SECRET_KEY();
  if (PAYSTACK_ENV() === "live") return true;
  return key.startsWith("sk_live_");
}

export const FIREBASE_PROJECT_ID = () => read("FIREBASE_PROJECT_ID");

/**
 * Shared secret for the scheduled reaper.
 *
 * This is NOT a client secret and must never reach the app: it exists so that
 * housekeeping — which can end trips, cancel held bookings and take a driver
 * offline — can only be triggered by the schedule that is supposed to trigger
 * it, and not by anyone who happens to know the function's URL.
 *
 * It is optional on purpose: when it is not configured the reaper refuses every
 * request (fails closed) rather than standing open.
 */
export const REAP_SECRET = () => Deno.env.get("REAP_SECRET") || "";

/** Service-account credentials used for privileged Firestore writes. */
/**
 * Secrets get pasted with their surrounding quotes surprisingly often — the
 * service-account JSON shows the private key as a quoted string, and it's easy
 * to include one quote and not the other. A quote is never valid inside a PEM
 * or an email, so strip them instead of failing on a key that is otherwise
 * correct.
 */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed.replace(/^['"]+/, "").replace(/['"]+$/, "").trim();
}

/**
 * The service-account email, pulled out of whatever was pasted. A value copied
 * straight from the JSON can arrive as `...gserviceaccount.com",` — quotes and
 * a trailing comma included — so match the address itself rather than trusting
 * the value to be bare.
 */
export const FIREBASE_CLIENT_EMAIL = () => {
  const raw = read("FIREBASE_CLIENT_EMAIL");
  const match = raw.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  if (match) return match[0];
  const fallback = unquote(raw);
  if (!fallback) throw new Error("FIREBASE_CLIENT_EMAIL is not a usable address");
  return fallback;
};

/**
 * PEM private key, extracted by its own BEGIN/END markers.
 *
 * Secrets pasted from a JSON file easily pick up a leading quote, a trailing
 * quote-comma, or both. Only the PEM span matters, so take exactly that and
 * discard the surrounding punctuation. "\n" escapes and real newlines are both
 * accepted.
 */
export function firebasePrivateKey(): string {
  const raw = read("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const match = raw.match(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/);
  if (match) return match[0].trim();
  const fallback = unquote(raw);
  if (!fallback.includes("BEGIN") || !fallback.includes("END")) {
    throw new Error("FIREBASE_PRIVATE_KEY is not a PEM private key");
  }
  return fallback;
}

// ─── Business configuration (all overridable without a code change) ───────

/** Minutes the passenger's seats stay held while the driver decides. */
export const HOLD_MINUTES = Number(Deno.env.get("HOLD_MINUTES") || "5");

/** Minutes the passenger has to pay after the driver accepts. */
export const PAYMENT_WINDOW_MINUTES = Number(Deno.env.get("PAYMENT_WINDOW_MINUTES") || "5");

/** Platform commission on each fare (0.10 = 10%). */
export const COMMISSION_RATE = Number(Deno.env.get("COMMISSION_RATE") || "0.1");

/** Hour (Africa/Accra, UTC+0) after which drivers may withdraw. */
export const PAYOUT_CUTOFF_HOUR = Number(Deno.env.get("PAYOUT_CUTOFF_HOUR") || "20");

/** Smallest payout we will send (GH₵1). */
export const MIN_PAYOUT_PESEWAS = Number(Deno.env.get("MIN_PAYOUT_PESEWAS") || "100");

/** Minutes after which a driver who stopped publishing GPS is considered gone. */
export const DRIVER_STALE_MINUTES = Number(Deno.env.get("DRIVER_STALE_MINUTES") || "5");
