import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";

export type LocationPermissionState = "undetermined" | "granted" | "denied" | "error";

type UseLocationPermissionResult = {
  status: LocationPermissionState;
  /** Live user location — updated continuously while permission is granted */
  location: Location.LocationObject | null;
  /** True while the permission request or first position fetch is in progress */
  loading: boolean;
  /** Human-readable explanation shown when permission is denied */
  deniedMessage: string;
  /** Request permission and start (or restart) the live location watcher */
  requestPermission: () => Promise<void>;
};

/**
 * Gracefully handles location permission requests AND keeps a live position.
 *
 * - Does NOT assume permission is granted.
 * - If denied, continues to function with `status: "denied"` so callers can show fallback.
 * - While granted, holds a single shared `watchPositionAsync` subscription so every
 *   screen sees the user's position move in real time (the previous implementation
 *   fetched the position once and never updated it, which froze the user's dot and
 *   every distance computed from it).
 * - Does not crash on error.
 */
export default function useLocationPermission(): UseLocationPermissionResult {
  const [status, setStatus] = useState<LocationPermissionState>("undetermined");
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [loading, setLoading] = useState(false);
  const [deniedMessage, setDeniedMessage] = useState("");

  const watchRef = useRef<Location.LocationSubscription | null>(null);

  const startWatch = useCallback(async () => {
    // Replace any previous watcher — params or permission state may have changed.
    try {
      watchRef.current?.remove();
    } catch {
      // subscription already gone
    }
    watchRef.current = null;

    try {
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 4000,
          distanceInterval: 8,
        },
        (fresh) => {
          setLocation(fresh);
        }
      );
    } catch (error) {
      console.warn("Live location watch failed:", error);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    setLoading(true);
    try {
      const { status: permissionStatus } =
        await Location.requestForegroundPermissionsAsync();

      if (permissionStatus === "granted") {
        setStatus("granted");
        try {
          const currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setLocation(currentLocation);
        } catch {
          // Location fetch failed — permission is still granted but no position yet
          setLocation(null);
        }
        // Live updates from here on
        void startWatch();
      } else if (permissionStatus === "denied") {
        setStatus("denied");
        setDeniedMessage(
          "Location permission is needed to show nearby routes and drivers. " +
            "You can still browse routes without location access."
        );
      } else {
        // "undetermined" on some platforms means first-time prompt was dismissed
        setStatus("denied");
        setDeniedMessage(
          "Please grant location permission in your device settings to see nearby routes."
        );
      }
    } catch {
      setStatus("error");
      setDeniedMessage(
        "Unable to check location permission. You can still browse routes."
      );
    } finally {
      setLoading(false);
    }
  }, [startWatch]);

  // On mount, check existing permission without prompting again.
  // When already granted, start the live watcher immediately.
  useEffect(() => {
    let cancelled = false;

    const checkExisting = async () => {
      const { status: existingStatus } =
        await Location.getForegroundPermissionsAsync();

      if (cancelled) return;

      if (existingStatus === "granted") {
        setStatus("granted");
        try {
          const currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          if (!cancelled) setLocation(currentLocation);
        } catch {
          // No location yet, that's fine — the watcher will deliver one
        }
        if (!cancelled) void startWatch();
      } else if (existingStatus === "denied") {
        setStatus("denied");
        setDeniedMessage(
          "Location permission is needed to show nearby routes and drivers. " +
            "You can still browse routes without location access."
        );
      }
    };

    void checkExisting();

    return () => {
      cancelled = true;
      try {
        watchRef.current?.remove();
      } catch {
        // subscription already gone
      }
      watchRef.current = null;
    };
  }, [startWatch]);

  return { status, location, loading, deniedMessage, requestPermission };
}
