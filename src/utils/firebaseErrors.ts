type FirebaseError = {
  code?: string;
  message?: string;
};

const ERROR_MAP: Record<string, string> = {
  // Auth errors
  "auth/user-not-found": "No account found with this email address.",
  "auth/user-disabled": "This account has been disabled. Please contact support.",
  "auth/wrong-password": "Incorrect password. Please try again.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/email-already-in-use": "An account with this email already exists.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes before trying again.",
  "auth/network-request-failed": "Network error. Please check your internet connection and try again.",
  "auth/invalid-credential": "Invalid credentials. Please check your email and password.",
  "auth/operation-not-allowed": "This sign-in method is not enabled. Please contact support.",
  "auth/popup-closed-by-user": "Sign-in was cancelled. Please try again.",
  "auth/popup-blocked": "Pop-up was blocked by your browser. Please allow pop-ups for this site.",
  "auth/account-exists-with-different-credential": "An account already exists with this email using a different sign-in method.",
  "auth/requires-recent-login": "For security, please sign in again before performing this action.",
  "auth/invalid-action-code": "The reset link has expired or is no longer valid. Please request a new one.",
  "auth/expired-action-code": "The reset link has expired. Please request a new one.",
  "auth/invalid-continue-uri": "The continue URL is not valid.",
  "auth/unauthorized-continue-uri": "The continue URL is not authorized.",

  // Firestore errors
  "permission-denied": "You don't have permission to perform this action.",
  "not-found": "The requested data was not found.",
  "already-exists": "This data already exists.",
  "resource-exhausted": "Too many requests. Please try again later.",
  "failed-precondition": "This action cannot be completed right now. Please try again.",
  "aborted": "The operation was cancelled. Please try again.",
  "internal": "An unexpected error occurred. Please try again.",
  "unavailable": "The service is currently unavailable. Please try again later.",
  "data-loss": "An unexpected error occurred. Please contact support.",
};

function getFirebaseCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as FirebaseError).code);
  }
  return null;
}

export function getFriendlyError(error: unknown): string {
  const code = getFirebaseCode(error);

  if (code) {
    // Strip "auth/" or "firestore/" prefix for lookup
    const stripped = code.replace(/^(auth|firestore|storage)\//, "");
    if (ERROR_MAP[code]) return ERROR_MAP[code];
    if (ERROR_MAP[stripped]) return ERROR_MAP[stripped];
  }

  // Fallback: return the original message if it's readable, otherwise generic
  if (typeof error === "object" && error !== null && "message" in error) {
    const msg = String((error as FirebaseError).message);
    // Don't expose raw Firebase messages to users
    if (msg.includes("Firebase") || msg.includes("firebase")) {
      return "Something went wrong. Please try again.";
    }
    return msg;
  }

  return "Something went wrong. Please try again.";
}

export function getFirebaseErrorCode(error: unknown): string {
  return getFirebaseCode(error) || "unknown-error";
}
