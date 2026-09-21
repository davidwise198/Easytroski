// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

import { ApiError } from "./errors.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export function preflight(): Response {
  return new Response("ok", { headers: CORS_HEADERS });
}

/**
 * Turn any thrown value into a safe JSON error response. Deliberate ApiErrors
 * keep their code; everything else becomes `unknown` so internal details never
 * reach the phone.
 */
export function errorResponse(error: unknown, label: string): Response {
  if (error instanceof ApiError) {
    return json({ error: error.code, message: error.message, details: error.details }, error.status);
  }
  console.error(`[${label}] unhandled:`, error);
  return json({ error: "unknown", message: "We couldn't complete that. Please try again." }, 500);
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError("invalid_request", "Malformed request body", 400);
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError("invalid_request", `Missing ${field}`, 400, { field });
  }
  return value.trim();
}

export function requireNumber(value: unknown, field: string): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) {
    throw new ApiError("invalid_request", `Invalid ${field}`, 400, { field });
  }
  return num;
}

export function requireLatLng(value: unknown, field: string): { latitude: number; longitude: number; address?: string } {
  const obj = value as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") {
    throw new ApiError("invalid_request", `Missing ${field}`, 400, { field });
  }
  const latitude = requireNumber(obj.latitude, `${field}.latitude`);
  const longitude = requireNumber(obj.longitude, `${field}.longitude`);
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new ApiError("invalid_request", `Invalid ${field}`, 400, { field });
  }
  const address = typeof obj.address === "string" ? obj.address : undefined;
  return { latitude, longitude, address };
}
