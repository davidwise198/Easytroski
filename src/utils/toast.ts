// ---------------------------------------------------------------------------
// Standalone toast helper — can be called from anywhere, even outside React.
//
// In components that have access to `useToast()`, prefer using that hook
// directly. This module is a fallback for service files, callbacks, and
// places where the hook isn't available.
// ---------------------------------------------------------------------------

import { Alert } from "react-native";

type StandaloneShowFn = (
  type: "error" | "success" | "info" | "warning",
  title: string,
  message?: string
) => void;

let externalShowFn: StandaloneShowFn | null = null;

/**
 * Called by the ToastProvider once it mounts so the standalone helper can
 * delegate to the real animated toast.
 */
export function registerToastShow(fn: StandaloneShowFn) {
  externalShowFn = fn;
}

/**
 * Show a toast from anywhere in the app. Falls back to Alert if the
 * ToastProvider hasn't mounted yet (e.g. during early init).
 */
export function showToast(
  type: "error" | "success" | "info" | "warning",
  title: string,
  message?: string
) {
  if (externalShowFn) {
    externalShowFn(type, title, message);
  } else {
    // Fallback — native alert. Only hits when ToastProvider isn't mounted.
    const body = message ? `${title}\n\n${message}` : title;
    Alert.alert(type === "error" ? "Error" : title, message || undefined);
  }
}

/** Convenience: show an error toast from any error object. */
export function showError(error: unknown, fallbackTitle = "Error") {
  let message = "Something went wrong. Please try again.";
  if (typeof error === "object" && error !== null && "message" in error) {
    const msg = String((error as { message: unknown }).message);
    if (!/firebase|internal|stack/i.test(msg)) {
      message = msg;
    }
  }
  showToast("error", fallbackTitle, message);
}

/** Convenience: show a success toast. */
export function showSuccess(title: string, message?: string) {
  showToast("success", title, message);
}
