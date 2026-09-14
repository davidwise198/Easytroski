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
