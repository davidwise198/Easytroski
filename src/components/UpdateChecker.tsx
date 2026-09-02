import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Updates from "expo-updates";

import { useToast } from "../contexts/ToastContext";

/**
 * Checks for OTA updates on app startup.
 * When an update is available, it shows a toast notification and reloads the app.
 *
 * This component should be rendered inside the ToastProvider.
 */
export default function UpdateChecker({ children }: { children: React.ReactNode }) {
  const { showInfo, showSuccess, showError } = useToast();
  const hasChecked = useRef(false);

  useEffect(() => {
    // Only check once per app session
    if (hasChecked.current) return;
    hasChecked.current = true;

    async function checkForUpdates() {
      try {
        // Skip update checks in development (Metro bundler)
        if (__DEV__) return;

        const update = await Updates.checkForUpdateAsync();

        if (update.isAvailable) {
          // Show info toast that an update is available
          showInfo(
            "Update Available",
            "A new version is being downloaded..."
          );

          // Download and apply the update
          const { isNew } = await Updates.fetchUpdateAsync();

          if (isNew) {
            showSuccess(
              "Update Downloaded",
              "Restarting to apply the update..."
            );

            // Small delay so the user can see the toast
            setTimeout(() => {
              Updates.reloadAsync();
            }, 1500);
          }
        }
      } catch (error) {
        // Silently fail — don't block the app if update check fails
        if (__DEV__) {
          console.warn("[UpdateChecker] Failed to check for updates:", error);
        }
      }
    }

    // Delay the check slightly so the app finishes loading first
    const timer = setTimeout(checkForUpdates, 2000);

    return () => clearTimeout(timer);
  }, [showInfo, showSuccess, showError]);

  return <>{children}</>;
}
