import { useCallback, useEffect, useState } from "react";
import * as Location from "expo-location";

export type LocationPermissionState = "undetermined" | "granted" | "denied" | "error";

type UseLocationPermissionResult = {
  status: LocationPermissionState;
  /** Current user location, null if not available */
  location: Location.LocationObject | null;
  /** True while permission request or location fetch is in progress */
  loading: boolean;
  /** Human-readable explanation shown when permission is denied */
  deniedMessage: string;
  /** Request permission and fetch location */
  requestPermission: () => Promise<void>;
};

/**
 * Gracefully handles location permission requests.
 *
 * - Does NOT assume permission is granted.
 * - If denied, continues to function with `status: "denied"` so callers can show fallback.
 * - Does not crash on error.
 */
export default function useLocationPermission(): UseLocationPermissionResult {
  const [status, setStatus] = useState<LocationPermissionState>("undetermined");
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [loading, setLoading] = useState(false);
  const [deniedMessage, setDeniedMessage] = useState("");

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
  }, []);

  // On mount, check existing permission without prompting again
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
          // No location yet, that's fine
        }
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
    };
  }, []);

  return { status, location, loading, deniedMessage, requestPermission };
}
