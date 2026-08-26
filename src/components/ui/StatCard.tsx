import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "./AppText";
import { COLORS, SPACING } from "../../theme";

type StatCardProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  value: string | number;
  label: string;
  delay?: number;
  color?: string;
};

export default function StatCard({
  icon,
  value,
  label,
  delay = 0,
  color = COLORS.primary,
}: StatCardProps) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(entrance, {
        toValue: 1,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, entrance]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
            {
              scale: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ],
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: color + "18" }]}>
        <MaterialCommunityIcons name={icon} size={20} color={color} />
      </View>
      <AppText variant="heading" style={styles.value}>
        {value}
      </AppText>
      <AppText variant="caption" style={styles.label}>
        {label}
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: "center",
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderRadius: 18,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm,
  },
  value: {
    color: COLORS.navy,
    fontSize: 22,
    lineHeight: 28,
    marginBottom: 2,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },
});
