// ---------------------------------------------------------------------------
// Firebase ID token verification
//
// The app authenticates with Firebase Auth; the backend trusts only Firebase
// ID tokens. We verify the RS256 signature against Google's published JWKS and
// check issuer/audience/expiry exactly as Firebase documents, using WebCrypto
// so this function needs no external dependencies.
// ---------------------------------------------------------------------------

import { FIREBASE_PROJECT_ID } from "./env.ts";
import { ApiError } from "./errors.ts";

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string; use?: string };

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // Google rotates rarely; refresh hourly.

async function loadJwks(force = false): Promise<Jwk[]> {
  const now = Date.now();
  if (!force && jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const response = await fetch(JWKS_URL);
  if (!response.ok) {
    throw new ApiError("unknown", "Could not load signing keys", 503);
  }
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = (body.keys || []).filter((k) => k.kty === "RSA");
  if (!keys.length) throw new ApiError("unknown", "No signing keys available", 503);
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

function base64UrlToUint8(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decode a JWT segment. Anything that is not valid base64/JSON is a bad token,
 * not a server fault — so it answers 401 like every other rejection instead of
 * surfacing as a 500.
 */
function decodeJsonSegment<T>(segment: string): T {
  try {
    const bytes = base64UrlToUint8(segment);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new ApiError("not_signed_in", "Malformed token", 401);
  }
}

export type VerifiedUser = {
  uid: string;
  email?: string;
  /** Custom claim written at sign-up; used for admin-only actions. */
  role?: string;
};

type FirebaseClaims = {
  iss?: string;
  aud?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  email?: string;
  role?: string;
  [key: string]: unknown;
};

/**
 * Verify a Firebase ID token. Throws ApiError("not_signed_in") for anything
 * that doesn't check out — callers should not need to inspect internals.
 */
export async function verifyIdToken(token: string): Promise<VerifiedUser> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new ApiError("not_signed_in", "Malformed token", 401);

  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = decodeJsonSegment<{ alg?: string; kid?: string }>(headerSegment);
  const claims = decodeJsonSegment<FirebaseClaims>(payloadSegment);

  if (header.alg !== "RS256" || !header.kid) {
    throw new ApiError("not_signed_in", "Unsupported token", 401);
  }

  let keys = await loadJwks();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Key rotated since our last fetch — refresh once.
    keys = await loadJwks(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new ApiError("not_signed_in", "Unknown signing key", 401);

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true } as JsonWebKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToUint8(signatureSegment),
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`)
  );
  if (!valid) throw new ApiError("not_signed_in", "Invalid token signature", 401);

  const projectId = FIREBASE_PROJECT_ID();
  const now = Math.floor(Date.now() / 1000);

  if (claims.aud !== projectId) throw new ApiError("not_signed_in", "Wrong audience", 401);
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new ApiError("not_signed_in", "Wrong issuer", 401);
  }
  if (!claims.sub || typeof claims.sub !== "string") {
    throw new ApiError("not_signed_in", "Missing subject", 401);
  }
  if (!claims.exp || claims.exp <= now) throw new ApiError("not_signed_in", "Token expired", 401);
  if (claims.iat && claims.iat > now + 300) throw new ApiError("not_signed_in", "Token not yet valid", 401);

  return {
    uid: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
    role: typeof claims.role === "string" ? claims.role : undefined,
  };
}

/** Extract and verify the bearer token from an incoming request. */
export async function authenticate(request: Request): Promise<VerifiedUser> {
  const header = request.headers.get("Authorization") || request.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    throw new ApiError("not_signed_in", "Sign in to continue", 401);
  }
  return verifyIdToken(header.slice(7).trim());
}

/** An admin is a user whose Firestore profile carries role: "admin". */
export async function requireAdmin(roleFromToken: string | undefined, isAdminInFirestore: boolean): Promise<void> {
  if (roleFromToken === "admin" || isAdminInFirestore) return;
  throw new ApiError("not_authorised", "Admins only", 403);
}
