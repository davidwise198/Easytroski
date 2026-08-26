import React, { createContext, useContext } from "react";
import * as Location from "expo-location";

import useLocationPermission, {
  LocationPermissionState,
} from "../hooks/useLocationPermission";

type LocationContextValue = {
  /** Current permission status */
  status: LocationPermissionState;
  /** Current user location, null if not available */
  location: Location.LocationObject | null;
  /** True while loading */
  loading: boolean;
  /** Message to show when permission is denied */
  deniedMessage: string;
  /** Request permission and fetch location */
  requestPermission: () => Promise<void>;
};

const LocationContext = createContext<LocationContextValue>({
  status: "undetermined",
  location: null,
  loading: false,
  deniedMessage: "",
  requestPermission: async () => {},
});

export function useLocation() {
  return useContext(LocationContext);
}

export default function LocationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const permission = useLocationPermission();

  return (
    <LocationContext.Provider value={permission}>
      {children}
    </LocationContext.Provider>
  );
}
