import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { AnimatedRegion, MarkerAnimated } from "./MapExports";
import type { TrackedDriverLocation } from "../../services/map";
import { COLORS } from "../../theme";

type AnimatedDriverMarkerProps = {
  /** Live driver position stream (Firestore snapshot payload) */
  location: TrackedDriverLocation;
};

/**
 * Bolt-style moving driver marker.
 *
 * The driver's device publishes a fix roughly every 4–7 s; without
 * animation the marker teleports between those points. This component
 * glides the marker along each hop with an AnimatedRegion timed to the
 * expected update cadence, and rotates the bus icon toward the driver's
 * heading so movement direction is obvious at a glance.
 *
 * On platforms where MarkerAnimated/AnimatedRegion are stubbed (web),
 * it still renders — gliding just degrades to instant repositioning.
 */
export function AnimatedDriverMarker({ location }: AnimatedDriverMarkerProps) {
  const regionRef = useRef<AnimatedRegion | null>(null);
  const headingValue = useRef(new Animated.Value(0));
  // Unwrapped heading: we track the last raw heading so a hop across the
  // 359→0 compass wrap rotates the short way instead of spinning backwards.
  const lastRawHeading = useRef(0);
  const lastAnimatedHeading = useRef(0);

  // Lazily create the animated region on the first real position.
  if (!regionRef.current && location) {
    regionRef.current = new AnimatedRegion({
      latitude: location.latitude,
      longitude: location.longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    } as never);
  }

  useEffect(() => {
    if (!location || !regionRef.current) return;

    // Glide duration matches the driver's publishing cadence (~4–7 s
    // while carrying a booking) so one hop eases into the next.
    const hopMs = 3500;

    regionRef.current
      .timing({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0,
        longitudeDelta: 0,
        duration: hopMs,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: false, // map markers cannot use the native driver
      })
      .start();

    if (location.heading != null) {
      const raw = ((location.heading % 360) + 360) % 360;
      // Choose the equivalent target (raw ± 360) closest to the current
      // animated value so the icon always turns the short way around.
      let delta = raw - (lastAnimatedHeading.current % 360);
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const target = lastAnimatedHeading.current + delta;

      Animated.timing(headingValue.current, {
        toValue: target,
        duration: 900,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      lastAnimatedHeading.current = target;
      lastRawHeading.current = raw;
    }
  }, [location]);

  if (!location || !regionRef.current) return null;

  const spin = headingValue.current.interpolate({
    inputRange: [-360, 0, 360],
    outputRange: ["-360deg", "0deg", "360deg"],
  });

  return (
    <MarkerAnimated
      coordinate={regionRef.current as never}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
    >
      <Animated.View style={[styles.bus, { transform: [{ rotate: spin }] }]}>
        <MaterialCommunityIcons name="bus" size={20} color={COLORS.white} />
      </Animated.View>
    </MarkerAnimated>
  );
}

const styles = StyleSheet.create({
  bus: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: COLORS.white,
    shadowColor: COLORS.navy,
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
});
