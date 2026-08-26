// ---------------------------------------------------------------------------
// Centralized error handler for EasyTroski
// ---------------------------------------------------------------------------

import { FirebaseError } from "firebase/app";

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | "network"
  | "auth"
  | "permission"
  | "validation"
  | "not-found"
  | "server"
  | "unknown";

/**
 * Classify an error into a category so callers can decide how to respond
 * (retry, redirect to login, show validation message, etc.).
 */
export function classifyError(error: unknown): ErrorCategory {
  const code = getErrorCode(error);

  if (!code) {
    if (error instanceof TypeError && /network/i.test(error.message)) {
      return "network";
    }
    return "unknown";
  }

  // Network
  if (
    /network-request-failed|failed|offline|timeout|unavailable/i.test(code)
  ) {
    return "network";
  }

  // Auth
  if (/^auth\//.test(code)) {
    return "auth";
  }

  // Permission
  if (/permission-denied|unauthenticated/i.test(code)) {
    return "permission";
  }

  // Not found
  if (/not-found|does-not-exist/i.test(code)) {
    return "not-found";
  }

  // Validation
  if (/invalid-argument|failed-precondition|out-of-range/i.test(code)) {
    return "validation";
  }

  // Server
  if (/internal|deadline-exceeded|data-loss|resource-exhausted/i.test(code)) {
    return "server";
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Error extraction helpers
// ---------------------------------------------------------------------------

/** Extract a Firebase error code string, or null. */
export function getErrorCode(error: unknown): string | null {
  if (error instanceof FirebaseError) return error.code;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return null;
}

/** Extract a readable message from any error. */
export function getErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  if (typeof error === "string") return error;
  return "An unexpected error occurred.";
}

/**
 * Returns true if the error indicates the user's session has expired.
 * Useful for deciding whether to redirect to login.
 */
export function isSessionExpired(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    code === "auth/id-token-expired" ||
    code === "auth/user-token-expired" ||
    code === "auth/network-request-failed" ||
    code === "permission-denied"
  );
}

/**
 * Returns true if the error is retryable (network, server, transient).
 */
export function isRetryable(error: unknown): boolean {
  const category = classifyError(error);
  return category === "network" || category === "server";
}

// ---------------------------------------------------------------------------
// Sanitize error for logging (never log sensitive data)
// ---------------------------------------------------------------------------

export function sanitizeForLogging(error: unknown): {
  message: string;
  code: string | null;
  category: ErrorCategory;
} {
  const message = getErrorMessage(error);
  const code = getErrorCode(error);
  const category = classifyError(error);

  // Strip any potential tokens, emails, or PII from the message
  const sanitized = message
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, "[REDACTED_TOKEN]")
    .replace(/\b\d{10,}\b/g, "[REDACTED_NUMBER]");

  return { message: sanitized, code, category };
}

// ---------------------------------------------------------------------------
// Log error (production-safe)
// ---------------------------------------------------------------------------

/**
 * Log an error in a structured, safe way. In dev it console.error's; in
 * production you'd pipe this to Sentry / Bugsnag / etc.
 */
export function logError(error: unknown, context?: string) {
  const info = sanitizeForLogging(error);
  const prefix = context ? `[${context}]` : "[Error]";

  if (__DEV__) {
    console.error(prefix, info);
  }
  // In production: Sentry.captureException(error, { extra: { context, ...info } });
}

// ---------------------------------------------------------------------------
// Async wrapper — catches and classifies errors from async operations
// ---------------------------------------------------------------------------

type Result<T> = { ok: true; data: T } | { ok: false; error: unknown; category: ErrorCategory };

/**
 * Wrap any async function with centralized error handling.
 * Returns a Result type so callers don't need try/catch.
 */
export async function safeAsync<T>(fn: () => Promise<T>, context?: string): Promise<Result<T>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (error) {
    logError(error, context);
    return { ok: false, error, category: classifyError(error) };
  }
}
