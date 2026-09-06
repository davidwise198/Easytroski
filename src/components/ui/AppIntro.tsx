import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";

import AppBackground from "./AppBackground";
import AppText from "./AppText";
import { useThemeColors } from "../../contexts/ThemeContext";
import { COLORS, SPACING } from "../../theme";

type AppIntroProps = {
  onComplete: () => void;
};

export default function AppIntro({ onComplete }: AppIntroProps) {
  const { colors, isDark } = useThemeColors();
  const ds = useMemo(
    () => ({
      title: { color: colors.text },
      subtitle: { color: colors.textSecondary },
      overlay: { backgroundColor: colors.background },
      road: { borderColor: colors.textSecondary },
      bus: { color: colors.navy },
    }),
    [colors],
  );

  // ── Meet-your-ride scene progress values ──
  const busX = useRef(new Animated.Value(0)).current; // bus arrival (0→0.45) then departure (0.45→1)
  const paxX = useRef(new Animated.Value(0)).current; // passenger walk-in from the left
  const board = useRef(new Animated.Value(0)).current; // passenger boards the bus
  const ring = useRef(new Animated.Value(0)).current; // pick-up pulse ring

  // ── Wordmark copy reveal ──
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(12)).current;

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const sequence = Animated.sequence([
      Animated.parallel([
        // 1. Bus arrives from the right and stops at the pick-up point
        Animated.timing(busX, {
          toValue: 0.45,
          duration: 900,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        // 2. Passenger walks in from the left, starting just after the bus stops
        Animated.sequence([
          Animated.delay(160),
          Animated.timing(paxX, {
            toValue: 1,
            duration: 1050,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.delay(200),
      // 3. Pick-up beat: passenger fades into the bus, pulse ring expands
      Animated.parallel([
        Animated.timing(board, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(ring, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(250),
      // 4. Bus departs to the left
      Animated.timing(busX, {
        toValue: 1,
        duration: 950,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      // 5. Wordmark copy reveal
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(contentTranslateY, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
        }),
      ]),
    ]);

    sequence.start(() => {
      setTimeout(() => onCompleteRef.current(), 650);
    });

    return () => {
      sequence.stop();
    };
  }, [busX, paxX, board, ring, contentOpacity, contentTranslateY]);

  // ── Interpolations ──
  const busTranslateX = busX.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [230, 0, -250],
  });
  const paxTranslateX = paxX.interpolate({
    inputRange: [0, 1],
    outputRange: [-175, 14],
  });
  const paxBob = paxX.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: [0, -3, 0, -3, 0],
  });
  const boardOpacity = board.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [1, 1, 0],
  });
  const boardScale = board.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.45],
  });
  const ringScale = ring.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 2.3],
  });
  const ringOpacity = ring.interpolate({
    inputRange: [0, 0.65, 1],
    outputRange: [0.85, 0.85, 0],
  });

  return (
    <View style={[styles.overlay, ds.overlay]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <AppBackground>
        <View style={styles.center}>
          {/* ── Meet-your-ride hero scene ── */}
          <View style={styles.scene}>
            <View style={[styles.road, ds.road]} />
            <Animated.View
              style={[
                styles.bus,
                { transform: [{ translateX: busTranslateX }] },
              ]}
            >
              <MaterialCommunityIcons name="bus" size={64} color={ds.bus.color} />
            </Animated.View>
            <Animated.View
              style={[
                styles.ring,
                {
                  borderColor: colors.accent,
                  opacity: ringOpacity,
                  transform: [{ scale: ringScale }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.passenger,
                { transform: [{ translateX: paxTranslateX }] },
              ]}
            >
              <Animated.View
                style={{
                  opacity: boardOpacity,
                  transform: [{ translateY: paxBob }, { scale: boardScale }],
                }}
              >
                <MaterialCommunityIcons name="walk" size={36} color={colors.accent} />
              </Animated.View>
            </Animated.View>
          </View>

          {/* ── Wordmark copy ── */}
          <Animated.View
            style={[
              styles.copy,
              {
                opacity: contentOpacity,
                transform: [{ translateY: contentTranslateY }],
              },
            ]}
          >
            <AppText variant="title" style={[styles.title, ds.title]}>EasyTroski</AppText>
            <AppText variant="body" style={[styles.subtitle, ds.subtitle]}>Move smarter. Ride easier.</AppText>
            <View style={styles.accentLine} />
            <AppText variant="caption" style={styles.location}>GHANA'S EVERYDAY RIDE</AppText>
          </Animated.View>
        </View>
      </AppBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: COLORS.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xl,
  },
  scene: {
    width: 250,
    height: 120,
    position: "relative",
  },
  road: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 26,
    borderTopWidth: 2,
    borderStyle: "dashed",
  },
  bus: {
    position: "absolute",
    left: "50%",
    bottom: 26,
    marginLeft: -32,
    width: 64,
    alignItems: "center",
  },
  ring: {
    position: "absolute",
    left: "50%",
    bottom: 26,
    marginLeft: -24,
    marginBottom: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
  },
  passenger: {
    position: "absolute",
    left: "50%",
    bottom: 34,
    marginLeft: -18,
    width: 36,
    alignItems: "center",
  },
  copy: {
    alignItems: "center",
    marginTop: SPACING.xl,
  },
  title: {
    color: COLORS.navy,
    fontSize: 32,
    lineHeight: 40,
  },
  subtitle: {
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  accentLine: {
    width: 34,
    height: 3,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
    marginTop: SPACING.lg,
  },
  location: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginTop: SPACING.md,
  },
});
