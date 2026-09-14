import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Marker, Polyline } from "./MapExports";

import { COLORS } from "../../theme";
import { splitRouteAtDriver } from "../../services/directions";

// ---------------------------------------------------------------------------
// RouteLine — Bolt-style route overlay between a live driver and a pickup.
// Renders the covered portion dimmed and the remaining route in blue, plus a
// pickup pin. Returns null on web (the web map is a placeholder).
// ---------------------------------------------------------------------------

export type RouteLineProps = {
  /** Driver's live position */
  driver: { latitude: number; longitude: number };
  /** Pickup destination of the route */
  destination: { latitude: number; longitude: number };
  /** Road coordinates (Directions API) or straight 2-point fallback */
  coordinates: { latitude: number; longitude: number }[];
};

export function RouteLine({ driver, destination, coordinates }: RouteLineProps) {
  const { covered, remaining } = useMemo(
    () => splitRouteAtDriver(coordinates, driver),
    [coordinates, driver.latitude, driver.longitude]
  );

  return (
    <>
      {/* Covered portion — dimmed gray behind the driver */}
      {covered.length >= 2 && (
        <Polyline
          coordinates={covered}
          strokeColor="rgba(120,120,128,0.5)"
          strokeWidth={4}
          lineDashPattern={[1, 4]}
        />
      )}

      {/* Remaining route — solid blue to the pickup */}
      {remaining.length >= 2 && (
        <Polyline
          coordinates={remaining}
          strokeColor={COLORS.primary}
          strokeWidth={5}
        />
      )}

      {/* Pickup pin */}
      <Marker coordinate={destination} anchor={{ x: 0.5, y: 1 }}>
        <View style={styles.pin}>
          <View style={styles.pinInner} />
        </View>
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: COLORS.white,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  pinInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.white,
  },
});
