import React from "react";
import { View, Text, StyleSheet } from "react-native";

// ---------------------------------------------------------------------------
// Web-safe stubs for react-native-maps.
// The real map renders only on native (iOS / Android).
// On web these placeholders keep the bundle alive and show an informative
// message instead of crashing.
// ---------------------------------------------------------------------------

export const PROVIDER_DEFAULT = null;

type AnyProps = Record<string, any>;

export function MapView({ children, style, ...rest }: AnyProps) {
  return (
    <View style={[styles.container, style]}>
      <Text style={styles.heading}>🗺️ EasyTroski Map</Text>
      <Text style={styles.body}>
        The interactive map is available on the mobile app.
      </Text>
      <Text style={styles.hint}>
        Open EasyTroski in Expo Go or a native build to see live maps,
        route markers, and driver locations.
      </Text>
      {/* Render children so downstream components don't error */}
      {children}
    </View>
  );
}

export function Marker(_props: AnyProps) {
  // Markers are invisible on web; the MapView placeholder already explains.
  return null;
}

export function Callout(_props: AnyProps) {
  return null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E8F3FF",
    padding: 32,
  },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: "#102A43",
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: "#66788A",
    textAlign: "center",
    lineHeight: 22,
  },
  hint: {
    fontSize: 13,
    color: "#9AA8B5",
    textAlign: "center",
    marginTop: 12,
    lineHeight: 18,
  },
});
