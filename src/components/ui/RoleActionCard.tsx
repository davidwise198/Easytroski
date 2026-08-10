import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View, ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "./AppText";
import { COLORS, SPACING } from "../../theme";

type RoleActionCardProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  title: string;
  description: string;
  onPress: () => void;
  style?: ViewStyle;
  tone?: "navy" | "blue";
  delay?: number;
};

export default function RoleActionCard({
  icon,
  title,
  description,
  onPress,
  style,
  tone = "navy",
  delay = 0,
}: RoleActionCardProps) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(entrance, {
        toValue: 1,
        friction: 8,
        tension: 55,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, entrance]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed, style]}
    >
      <Animated.View
        style={[
          styles.card,
          tone === "blue" ? styles.blueCard : styles.navyCard,
          {
            opacity: entrance,
            transform: [
              {
                translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }),
              },
              { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
            ],
          },
        ]}
      >
        <View style={[styles.iconWrap, tone === "blue" ? styles.blueIcon : styles.navyIcon]}>
          <MaterialCommunityIcons name={icon} size={25} color={COLORS.secondary} />
        </View>
        <View style={styles.copy}>
          <AppText variant="heading" style={styles.title}>
            {title}
          </AppText>
          <AppText variant="caption" style={styles.description}>
            {description}
          </AppText>
        </View>
        <View style={styles.arrowCircle}>
          <MaterialCommunityIcons name="arrow-top-right" size={18} color={COLORS.navy} />
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    width: "100%",
  },
  pressed: {
    transform: [{ scale: 0.975 }],
    opacity: 0.92,
  },
  card: {
    minHeight: 92,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    shadowColor: COLORS.navy,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5,
  },
  navyCard: {
    backgroundColor: COLORS.navy,
  },
  blueCard: {
    backgroundColor: COLORS.primary,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    marginRight: SPACING.md,
  },
  navyIcon: {
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  blueIcon: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  copy: {
    flex: 1,
    paddingRight: SPACING.sm,
  },
  title: {
    color: COLORS.secondary,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "700",
    marginBottom: 4,
  },
  description: {
    color: "rgba(255,255,255,0.76)",
    fontSize: 12,
    lineHeight: 17,
  },
  arrowCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.secondary,
  },
});
