// ---------------------------------------------------------------------------
// Driver resume self-heal
//
// When the driver app starts up we check whether this device actually went
// away. If the last GPS write is older than the liveness window, any trip that
// survived the kill is ended, held bookings are cancelled and the driver goes
// offline — passengers must never see a driver who isn't running the app.
//
// The window is deliberately much shorter than the maintenance sweep so it only
// fires for a genuine restart, not for a driver who is simply slow.
// ---------------------------------------------------------------------------

import { commit, getDocument, nowIso, queryDocuments, toMillis, updateWrite } from "./firestore.ts";
import { endTripCore } from "./tripFlow.ts";

const RESTART_STALE_MS = 90_000;

export async function driverResumedCore(driverId: string): Promise<{ healed: boolean; tripEnded?: boolean }> {
  const driver = await getDocument(`drivers/${driverId}`);
  if (!driver) return { healed: false };
  if (driver.data.online !== true) return { healed: false };

  const lastSeen = toMillis(driver.data.locationUpdatedAt);
  if (lastSeen !== null && Date.now() - lastSeen < RESTART_STALE_MS) {
    // The device kept publishing: nothing to heal.
    return { healed: false };
  }

  // Find the surviving trip and tear it down properly (with refunds).
  const trips = await queryDocuments({
    collection: "trips",
    filters: [{ field: "driverId", value: driverId }],
    limit: 10,
  });
  const active = trips.find((trip) =>
    ["online", "boarding", "in_progress"].includes(String(trip.data.status))
  );

  if (!active) {
    // No trip, just a stale online flag.
    const fresh = await getDocument(`drivers/${driverId}`);
    if (fresh) {
      await commit([
        updateWrite(
          `drivers/${driverId}`,
          { online: false, status: "offline", availableSeats: 0, updatedAt: nowIso() },
          ["online", "status", "availableSeats", "updatedAt"],
          fresh.updateTime
        ),
      ]);
    }
    return { healed: true };
  }

  await endTripCore(driverId, active.id);
  return { healed: true, tripEnded: true };
}
