import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { COLORS } from "../../theme";

type AnimatedBrandMarkProps = {
  size?: number;
  style?: ViewStyle;
  loop?: boolean;
  onComplete?: () => void;
};

export default function AnimatedBrandMark({
  size = 40,
  style,
  loop = true,
  onComplete,
}: AnimatedBrandMarkProps) {
  const passengerProgress = useRef(new Animated.Value(0)).current;
  const vehicleProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const introSequence = Animated.sequence([
        Animated.timing(passengerProgress, {
          toValue: 1,
          duration: 480,
          useNativeDriver: true,
        }),
        Animated.delay(260),
        Animated.timing(vehicleProgress, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.delay(850),
        Animated.parallel([
          Animated.timing(vehicleProgress, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
          Animated.timing(passengerProgress, {
            toValue: 0,
            duration: 350,
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(500),
      ]);
    const animation = loop ? Animated.loop(introSequence) : introSequence;

    animation.start(({ finished }) => {
      if (finished && !loop) {
        onComplete?.();
      }
    });
    return () => animation.stop();
  }, [loop, onComplete, passengerProgress, vehicleProgress]);

  const passengerTranslateX = passengerProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-size * 0.7, 0],
  });
  const passengerOpacity = passengerProgress.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 1, 0.35],
  });
  const vehicleTranslateX = vehicleProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, size * 0.65],
  });

  return (
    <Animated.View
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size * 0.35 },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.vehicle,
          {
            transform: [{ translateX: vehicleTranslateX }],
          },
        ]}
      >
        <MaterialCommunityIcons name="bus" size={size * 0.58} color={COLORS.secondary} />
      </Animated.View>
      <Animated.View
        style={[
          styles.passenger,
          {
            opacity: passengerOpacity,
            transform: [{ translateX: passengerTranslateX }],
          },
        ]}
      >
        <MaterialCommunityIcons name="walk" size={size * 0.38} color={COLORS.secondary} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 5,
    overflow: "hidden",
  },
  vehicle: {
    position: "absolute",
    left: 4,
    bottom: 5,
  },
  passenger: {
    position: "absolute",
    left: 2,
    bottom: 7,
  },
});
