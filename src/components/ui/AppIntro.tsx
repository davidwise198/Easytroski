import React, { useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import AppBackground from "./AppBackground";
import AnimatedBrandMark from "./AnimatedBrandMark";
import AppText from "./AppText";
import { COLORS, SPACING } from "../../theme";

type AppIntroProps = {
  onComplete: () => void;
};

export default function AppIntro({ onComplete }: AppIntroProps) {
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(12)).current;

  const handleLogoReady = () => {
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
    ]).start();

    setTimeout(onComplete, 650);
  };

  return (
    <View style={styles.overlay}>
      <StatusBar style="dark" />
      <AppBackground>
        <View style={styles.center}>
          <AnimatedBrandMark size={104} loop={false} onComplete={handleLogoReady} />
          <Animated.View
            style={[
              styles.copy,
              {
                opacity: contentOpacity,
                transform: [{ translateY: contentTranslateY }],
              },
            ]}
          >
            <AppText variant="title" style={styles.title}>EasyTroski</AppText>
            <AppText variant="body" style={styles.subtitle}>Move smarter. Ride easier.</AppText>
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
  copy: {
    alignItems: "center",
    marginTop: SPACING.lg,
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
