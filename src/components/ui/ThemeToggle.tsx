import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import { useThemeColors } from "../../contexts/ThemeContext";

/**
 * Icon-only theme toggle.
 * - Tap: flip to the opposite of the current effective theme (light <-> dark).
 * - Long-press: reset to "system" so the app follows the phone again.
 */
export default function ThemeToggle() {
  const { colors, isDark, themeMode, setThemeMode } = useThemeColors();

  return (
    <Pressable
      onPress={() => setThemeMode(isDark ? "light" : "dark")}
      onLongPress={() => setThemeMode("system")}
      accessibilityRole="button"
      accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
      accessibilityHint="Long-press to follow the system theme"
      style={[
        styles.button,
        {
          backgroundColor: colors.veryLightBlue,
          borderColor: colors.glassBorder,
        },
      ]}
    >
      <MaterialCommunityIcons
        name={isDark ? "white-balance-sunny" : "moon-waning-crescent"}
        size={20}
        color={colors.primary}
      />
      {/* Small dot indicates the app is following the system theme */}
      {themeMode === "system" && (
        <View style={[styles.systemDot, { backgroundColor: colors.primary }]} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  systemDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});