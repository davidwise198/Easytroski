// ---------------------------------------------------------------------------
// Google Directions — road-route polyline + distance/duration
//
// Uses the Google Maps key already embedded in the native build
// (app.json → android.config.googleMaps.apiKey). If the Directions API is
// not enabled for that key, or a request fails, callers get a graceful
// straight-line fallback so live tracking never breaks.
// ---------------------------------------------------------------------------

import Constants from "expo-constants";

import { haversineMeters, LatLng } from "../utils/geo";

export type RoutePath = {
  coordinates: LatLng[];
  distanceMeters: number;
  durationSeconds: number;
  /** false when the Directions API was unavailable and a straight line was used */
  fromRoads: boolean;
};

let warnedUnavailable = false;

function getApiKey(): string | null {
  const key =
    (Constants.expoConfig as unknown as {
      android?: { config?: { googleMaps?: { apiKey?: string } } };
    })?.android?.config?.googleMaps?.apiKey ?? null;
  return key;
}

// --- Google encoded-polyline decoding (inline, no external dependency) ------

function decodePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ latitude: lat * 1e-5, longitude: lng * 1e-5 });
  }

  return points;
}

// --- Cache: one request per rounded pair, deduped while in flight -----------

const CACHE_TTL_MS = 45_000; // short — the "from" leg moves with the driver
const cache = new Map<string, { at: number; path: RoutePath }>();
const inFlight = new Map<string, Promise<RoutePath>>();

function cacheKey(from: LatLng, to: LatLng): string {
  const r = (n: number) => Math.round(n * 1000); // ~100 m buckets
  return `${r(from.latitude)},${r(from.longitude)}|${r(to.latitude)},${r(to.longitude)}`;
}

function straightLineFallback(from: LatLng, to: LatLng): RoutePath {
  return {
    coordinates: [from, to],
    distanceMeters: haversineMeters(from, to),
    durationSeconds: 0,
    fromRoads: false,
  };
}

/**
 * Fetch the road route between two points.
 * Falls back to a straight line on any failure (API off, no key, network).
 */
export async function fetchRoutePath(
  from: LatLng,
  to: LatLng
): Promise<RoutePath> {
  const key = cacheKey(from, to);

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.path;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const apiKey = getApiKey();
  if (!apiKey) {
    if (!warnedUnavailable) {
      console.warn(
        "[directions] No Google Maps API key — using straight-line fallback"
      );
      warnedUnavailable = true;
    }
    return straightLineFallback(from, to);
  }

  const promise = (async (): Promise<RoutePath> => {
    const url =
      `https://maps.googleapis.com/maps/api/directions/json` +
      `?origin=${from.latitude},${from.longitude}` +
      `&destination=${to.latitude},${to.longitude}` +
      `&mode=driving&alternatives=false&units=metric&key=${apiKey}`;

    const response = await fetch(url);
    const json = (await response.json()) as {
      status?: string;
      routes?: Array<{
        overview_polyline?: { points?: string };
        legs?: Array<{
          distance?: { value?: number };
          duration?: { value?: number };
        }>;
      }>;
    };

    const route = json?.routes?.[0];
    if (json?.status !== "OK" || !route?.overview_polyline?.points) {
      // Most commonly: the Directions API is not enabled for this key.
      if (!warnedUnavailable) {
        console.warn(
          `[directions] API unavailable (${json?.status ?? "no response"}) — using straight-line fallback. Enable "Directions API" in the Google Cloud console to get road routes.`
        );
        warnedUnavailable = true;
      }
      return straightLineFallback(from, to);
    }

    const leg = route.legs?.[0];
    const path: RoutePath = {
      coordinates: decodePolyline(route.overview_polyline.points),
      distanceMeters: leg?.distance?.value ?? haversineMeters(from, to),
      durationSeconds: leg?.duration?.value ?? 0,
      fromRoads: true,
    };
    cache.set(key, { at: Date.now(), path });
    return path;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    console.warn(
      "[directions] request failed — using straight-line fallback:",
      error
    );
    return straightLineFallback(from, to);
  } finally {
    inFlight.delete(key);
  }
}

// --- Route splitting (covered vs remaining) ---------------------------------

/** Perpendicular distance from a point to a segment, in meters (flat approx). */
function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const kx = 111320 * Math.cos((p.latitude * Math.PI) / 180);
  const ky = 110574;
  const px = p.longitude * kx;
  const py = p.latitude * ky;
  const ax = a.longitude * kx;
  const ay = a.latitude * ky;
  const bx = b.longitude * kx;
  const by = b.latitude * ky;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Split a route at the driver's current position:
 *  - `covered`  — the head of the route already driven (rendered dimmed)
 *  - `remaining` — from the driver's live position to the pickup (rendered blue)
 */
export function splitRouteAtDriver(
  coordinates: LatLng[],
  driverPos: LatLng
): { covered: LatLng[]; remaining: LatLng[] } {
  if (coordinates.length < 2) {
    return { covered: [], remaining: coordinates };
  }

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const d = pointToSegmentMeters(driverPos, coordinates[i], coordinates[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  return {
    covered: [...coordinates.slice(0, bestIdx + 1), driverPos],
    remaining: [driverPos, ...coordinates.slice(bestIdx + 1)],
  };
}

/** Total length of a polyline in meters. */
export function polylineLengthMeters(coordinates: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    total += haversineMeters(coordinates[i], coordinates[i + 1]);
  }
  return total;
}

/**
 * Snap a live GPS position onto the nearest point of a route polyline.
 * The driver's raw fix is often a few meters off the road centerline; without
 * snapping, the rendered "remaining" leg starts in mid-air and the line looks
 * broken. Returns the original point when the route is too short to snap to.
 */
export function snapToRoute(
  point: LatLng,
  coordinates: LatLng[]
): LatLng {
  if (coordinates.length < 2) return point;

  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const d = pointToSegmentMeters(point, coordinates[i], coordinates[i + 1]);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  // Project the point onto the winning segment (same flat-earth math as above)
  const kx = 111320 * Math.cos((point.latitude * Math.PI) / 180);
  const ky = 110574;
  const px = point.longitude * kx;
  const py = point.latitude * ky;
  const a = coordinates[bestIdx];
  const b = coordinates[bestIdx + 1];
  const ax = a.longitude * kx;
  const ay = a.latitude * ky;
  const bx = b.longitude * kx;
  const by = b.latitude * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));

  return {
    latitude: a.latitude + t * (b.latitude - a.latitude),
    longitude: a.longitude + t * (b.longitude - a.longitude),
  };
}
