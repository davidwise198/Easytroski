// ---------------------------------------------------------------------------
// /reap-expired — housekeeping, safe to call as often as you like.
//
// Wired to a schedule (Supabase cron) and also reachable manually:
//   • requests the driver never answered  → seats released
//   • payment windows that closed         → seats released, booking expired
//   • drivers whose app stopped reporting → taken offline, bookings cleaned up
//   • completed rides                     → earnings released to the wallet
//
// Every release is guarded by `seatReleasedAt`, so running it more often than
// necessary can never double-credit a seat.
// ---------------------------------------------------------------------------

import { json, preflight } from "../_shared/http.ts";
import { runMaintenance } from "../_shared/tripFlow.ts";

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return preflight();

  // Cron callers may be GET or POST; both do the same work.
  try {
    const result = await runMaintenance();
    return json({ ok: true, ...result });
  } catch (error) {
    console.error("[reap-expired] failed", error);
    return json({ ok: false, error: "maintenance_failed" }, 500);
  }
});
