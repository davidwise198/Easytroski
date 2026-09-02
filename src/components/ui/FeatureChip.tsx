import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "./AppText";
import { useThemeColors } from "../../contexts/ThemeContext";
import { useMemo } from "react";
import { COLORS, SPACING } from "../../theme";

type FeatureChipProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  delay?: number;
};

export default function FeatureChip({ icon, label, delay = 0 }: FeatureChipProps) {
  const { colors } = useThemeColors();
  const ds = useMemo(() => ({
    label: { color: colors.text },
  }), [colors]);
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(entrance, {
        toValue: 1,
        friction: 8,
        tension: 65,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, entrance]);

  return (
    <Animated.View
      style={[
        styles.chip,
        {
          opacity: entrance,
          transform: [
            {
              translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }),
            },
            { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
          ],
        },
      ]}
    >
      <View style={styles.iconWrap}>
        <MaterialCommunityIcons name={icon} size={15} color={COLORS.primary} />
      </View>
      <AppText variant="caption" style={[styles.label, ds.label]}>
        {label}
      </AppText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(23,105,224,0.12)",
    marginBottom: SPACING.xs,
  },
  label: {
    color: COLORS.navy,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
  },
});
