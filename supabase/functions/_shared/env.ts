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

/** Service-account credentials used for privileged Firestore writes. */
export const FIREBASE_CLIENT_EMAIL = () => read("FIREBASE_CLIENT_EMAIL");

/** PEM private key; supports "\n" escapes as pasted into a secrets file. */
export function firebasePrivateKey(): string {
  return read("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n").trim();
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
