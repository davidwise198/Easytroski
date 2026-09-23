// ---------------------------------------------------------------------------
// /reap-expired — housekeeping, for the schedule only.
//
// Wired to a scheduler (Supabase cron or any external one) and nothing else:
//   • requests the driver never answered  → seats released
//   • payment windows that closed         → seats released, booking expired
//   • drivers whose app stopped reporting → taken offline, bookings cleaned up
//   • completed rides                     → earnings released to the wallet
//
// Every release is guarded by `seatReleasedAt`, so running it more often than
// necessary can never double-credit a seat — but it does write, and it can end
// a trip and cancel bookings, so it is not a public endpoint. Requests must
// carry the shared secret in `x-reap-secret`, compared to the value held in
// Supabase function secrets.
//
// When REAP_SECRET is not configured the function refuses everything (fails
// closed). Expiries still happen meanwhile, because the booking and payment
// paths run the same housekeeping server-side as a side effect of the work they
// were already doing.
// ---------------------------------------------------------------------------

import { json, preflight } from "../_shared/http.ts";
import { runMaintenance } from "../_shared/tripFlow.ts";
import { REAP_SECRET } from "../_shared/env.ts";

/** Constant-time-ish comparison of two secrets. */
function sameSecret(expected: string, provided: string): boolean {
  if (!expected || expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return preflight();

  const expected = REAP_SECRET();
  const provided =
    request.headers.get("x-reap-secret") ||
    (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");

  if (!sameSecret(expected, provided.trim())) {
    if (!expected) {
      console.error(
        "[reap-expired] refused: REAP_SECRET is not configured, so no caller can be trusted"
      );
    } else {
      console.error("[reap-expired] refused: missing or wrong secret");
    }
    return json({ error: "not_authorised" }, 401);
  }

  // Cron callers may be GET or POST; both do the same work.
  try {
    const result = await runMaintenance();
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("[reap-expired] failed", error);
    return json({ ok: false, error: "maintenance_failed" }, 500);
  }
});
