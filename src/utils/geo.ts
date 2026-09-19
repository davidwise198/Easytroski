// ---------------------------------------------------------------------------
// Geo utilities — shared distance/ETA math for maps & live tracking
// ---------------------------------------------------------------------------

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6371000;

/**
 * Average city speed used for ETA fallbacks when no road-route duration
 * is available (meters are covered at this pace in tro-tro traffic).
 */
const AVG_SPEED_KMH = 18;

/** Great-circle distance between two coordinates, in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** "850 m" / "1.4 km" */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** "~3 min" (never less than 1 minute) */
export function formatEta(minutes: number): string {
  return `~${Math.max(1, Math.round(minutes))} min`;
}

/** ETA in minutes for a distance at the average city speed. */
export function etaFromDistance(meters: number): number {
  return (meters / 1000 / AVG_SPEED_KMH) * 60;
}

/**
 * A driver position is only trustworthy for live decisions ("driver has
 * arrived", "driver is approaching") while the reporting device is still
 * actively publishing fixes. Older than STALE_MS we treat it as unknown —
 * it may be a leftover point from a previous session.
 */
const STALE_MS = 90_000;

export function isLocationFresh(updatedAt: string | number | null | undefined): boolean {
  if (!updatedAt) return false;
  const ts = typeof updatedAt === "number" ? updatedAt : Date.parse(updatedAt);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < STALE_MS;
}

/**
 * Compass bearing (degrees, 0 = north, clockwise) from a → b.
 * Returns null when the two points are so close together that the
 * direction would be meaningless noise.
 */
export function bearingDegrees(a: LatLng, b: LatLng, minMeters = 4): number | null {
  if (haversineMeters(a, b) < minMeters) return null;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
