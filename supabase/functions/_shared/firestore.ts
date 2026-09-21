// ---------------------------------------------------------------------------
// Firestore REST client (service account)
//
// The backend acts with admin authority, which is exactly why the client rules
// can be locked down: money and seat writes only ever happen here.
//
// Concurrency: `update` writes carry a `currentDocument.updateTime`
// precondition, giving real compare-and-swap semantics — if another request
// changed the driver's seat count first, the commit fails with
// FAILED_PRECONDITION and the caller retries on fresh data. Nobody can
// double-spend a seat.
// ---------------------------------------------------------------------------

import { FIREBASE_CLIENT_EMAIL, FIREBASE_PROJECT_ID, firebasePrivateKey } from "./env.ts";
import { ConflictError } from "./errors.ts";

const DOCS_ROOT = () =>
  `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID()}/databases/(default)/documents`;

// ─── Google access token (cached) ──────────────────────────────────────────

let tokenCache: { token: string; expiresAt: number } | null = null;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function googleAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt > now + 60) return tokenCache.token;

  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: FIREBASE_CLIENT_EMAIL(),
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)))}.${
    base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)))
  }`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(firebasePrivateKey()),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );

  const assertion = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firestore auth failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: body.access_token, expiresAt: now + (body.expires_in || 3600) };
  return body.access_token;
}

// ─── Value codec ──────────────────────────────────────────────────────────

export type FsFields = Record<string, unknown>;

export function toFsValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => toFsValue(item)) } };
  }
  if (typeof value === "object") {
    const fields: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (nested === undefined) continue;
      fields[key] = toFsValue(nested);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

export function toFsFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    fields[key] = toFsValue(value);
  }
  return fields;
}

export function fromFsValue(value: any): unknown {
  if (value === null || value === undefined) return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue as string;
  if ("arrayValue" in value) {
    const values = value.arrayValue?.values || [];
    return values.map((item: unknown) => fromFsValue(item));
  }
  if ("mapValue" in value) {
    return fromFsFields(value.mapValue?.fields || {});
  }
  if ("referenceValue" in value) return value.referenceValue;
  return null;
}

export function fromFsFields(fields: Record<string, any> | undefined): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    data[key] = fromFsValue(value);
  }
  return data;
}

// ─── Documents ────────────────────────────────────────────────────────────

export type FsDoc = {
  /** `collection/id` or `collection/id/subcollection/id` */
  path: string;
  id: string;
  data: Record<string, unknown>;
  /** Opaque version token used for compare-and-swap preconditions. */
  updateTime: string;
};

function docName(path: string): string {
  return `${DOCS_ROOT()}/${path}`;
}

function pathFromName(name: string): string {
  return name.replace(`${DOCS_ROOT()}/`, "");
}

async function fsFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = await googleAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}

export async function getDocument(path: string): Promise<FsDoc | null> {
  const response = await fsFetch(docName(path));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Firestore read failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  }
  const raw = await response.json();
  return {
    path: pathFromName(raw.name),
    id: path.split("/").pop() as string,
    data: fromFsFields(raw.fields),
    updateTime: raw.updateTime as string,
  };
}

export type FsFilter = { field: string; value: unknown; op?: "EQUAL" | "NOT_EQUAL" | "LESS_THAN" | "GREATER_THAN" };

export type FsQuery = {
  collection: string;
  /** Optional parent document path, e.g. `drivers/uid` for subcollections. */
  parent?: string;
  filters?: FsFilter[];
  orderBy?: { field: string; direction?: "ASCENDING" | "DESCENDING" };
  limit?: number;
};

export async function queryDocuments(query: FsQuery): Promise<FsDoc[]> {
  const filters = (query.filters || []).map((filter) => ({
    fieldFilter: {
      field: { fieldPath: filter.field },
      op: filter.op || "EQUAL",
      value: toFsValue(filter.value),
    },
  }));

  const structuredQuery: Record<string, unknown> = {
    from: [{ collectionId: query.collection }],
  };

  if (filters.length === 1) structuredQuery.where = filters[0];
  if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: "AND", filters } };
  if (query.orderBy) {
    structuredQuery.orderBy = [
      { field: { fieldPath: query.orderBy.field }, direction: query.orderBy.direction || "ASCENDING" },
    ];
  }
  structuredQuery.limit = query.limit ?? 50;

  const url = query.parent
    ? `${DOCS_ROOT()}/${query.parent}:runQuery`
    : `${DOCS_ROOT()}:runQuery`;

  const response = await fsFetch(url, {
    method: "POST",
    body: JSON.stringify({ structuredQuery }),
  });

  if (!response.ok) {
    throw new Error(`Firestore query failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }

  const rows = (await response.json()) as Array<{ document?: any }>;
  return rows
    .filter((row) => row.document)
    .map((row) => ({
      path: pathFromName(row.document.name),
      id: (row.document.name as string).split("/").pop() as string,
      data: fromFsFields(row.document.fields),
      updateTime: row.document.updateTime as string,
    }));
}

// ─── Writes (compare-and-swap) ────────────────────────────────────────────

type RawWrite = Record<string, unknown>;

/**
 * Build the nested `fields` object for an update mask. Dotted paths such as
 * `refund.status` become nested mapValue structures, which is how Firestore
 * expects partial document updates.
 */
export function buildUpdateFields(
  data: Record<string, unknown>,
  paths: string[]
): Record<string, unknown> {
  const root: Record<string, any> = {};

  for (const path of paths) {
    const segments = path.split(".");
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i];
      cursor[segment] = cursor[segment] || {};
      cursor = cursor[segment];
    }
    const leaf = segments[segments.length - 1];
    const value = path
      .split(".")
      .reduce<any>((acc, key) => (acc == null ? undefined : (acc as any)[key]), data);
    cursor[leaf] = toFsValue(value);
  }

  // Wrap leaf maps into mapValue shapes, innermost first.
  const wrap = (node: Record<string, any>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      const isWrapper = value && typeof value === "object" && !("mapValue" in value) &&
        !("stringValue" in value) && !("integerValue" in value) && !("doubleValue" in value) &&
        !("booleanValue" in value) && !("nullValue" in value) && !("arrayValue" in value) &&
        !("timestampValue" in value);
      out[key] = isWrapper ? { mapValue: { fields: wrap(value as Record<string, any>) } } : value;
    }
    return out;
  };

  return wrap(root);
}

/**
 * Create a document only if it doesn't exist yet. Used for idempotency: a
 * retried request can never create a second booking or payment.
 */
export function createWrite(path: string, data: Record<string, unknown>): RawWrite {
  return {
    update: { name: docName(path), fields: toFsFields(data) },
    currentDocument: { exists: false },
  };
}

/** Partial update. Pass the read `updateTime` to make it compare-and-swap. */
export function updateWrite(
  path: string,
  data: Record<string, unknown>,
  paths: string[],
  preconditionUpdateTime?: string | null
): RawWrite {
  const write: RawWrite = {
    update: { name: docName(path), fields: buildUpdateFields(data, paths) },
    updateMask: { fieldPaths: paths },
  };
  if (preconditionUpdateTime) {
    write.currentDocument = { updateTime: preconditionUpdateTime };
  } else {
    write.currentDocument = { exists: true };
  }
  return write;
}

/** Atomic numeric increment, for counters like lifetime earnings. */
export function incrementWrite(path: string, increments: Record<string, number>): RawWrite {
  return {
    transform: {
      document: docName(path),
      fieldTransforms: Object.entries(increments).map(([fieldPath, delta]) => ({
        fieldPath,
        increment: toFsValue(delta),
      })),
    },
  };
}

export function deleteWrite(path: string): RawWrite {
  return { delete: docName(path) };
}

/**
 * Commit writes atomically. Throws ConflictError when a precondition failed,
 * which is the signal to re-read and retry.
 */
export async function commit(writes: RawWrite[]): Promise<void> {
  if (!writes.length) return;

  const response = await fsFetch(`${DOCS_ROOT()}:commit`, {
    method: "POST",
    body: JSON.stringify({ writes }),
  });

  if (response.ok) return;

  const text = await response.text();
  if (response.status === 409 || /FAILED_PRECONDITION|ABORTED|conflict/i.test(text)) {
    throw new ConflictError(text.slice(0, 200));
  }
  throw new Error(`Firestore commit failed (${response.status}): ${text.slice(0, 300)}`);
}

/** Retry a read-modify-write section until it wins its race. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ConflictError) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new ConflictError();
}

/** Random-ish id generator for new collection documents. */
export function newId(prefix = ""): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return prefix ? `${prefix}${id}` : id;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Parse a Firestore timestamp (ISO string or Timestamp object) to millis. */
export function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object" && value !== null) {
    const seconds = (value as { seconds?: number; _seconds?: number }).seconds ??
      (value as { _seconds?: number })._seconds;
    if (typeof seconds === "number") return seconds * 1000;
  }
  return null;
}
