import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "./AppText";
import { useThemeColors, ThemeMode } from "../../contexts/ThemeContext";

const MODES: { mode: ThemeMode; icon: string; label: string }[] = [
  { mode: "system", icon: "cellphone-cog", label: "System" },
  { mode: "light", icon: "white-balance-sunny", label: "Light" },
  { mode: "dark", icon: "moon-waning-crescent", label: "Dark" },
];

export default function ThemeToggle() {
  const { colors, themeMode, setThemeMode } = useThemeColors();
  const [expanded, setExpanded] = useState(false);

  const currentMode = MODES.find((m) => m.mode === themeMode) ?? MODES[0];

  return (
    <View style={styles.wrapper}>
      {/* Main toggle button */}
      <Pressable
        style={[
          styles.mainButton,
          {
            backgroundColor: colors.veryLightBlue,
            borderColor: colors.glassBorder,
          },
        ]}
        onPress={() => setExpanded(!expanded)}
      >
        <MaterialCommunityIcons
          name={currentMode.icon as any}
          size={18}
          color={colors.primary}
        />
        <AppText variant="caption" style={{ color: colors.primary, fontWeight: "700" }}>
          {currentMode.label}
        </AppText>
        <MaterialCommunityIcons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={14}
          color={colors.textSecondary}
        />
      </Pressable>

      {/* Expanded options */}
      {expanded && (
        <View
          style={[
            styles.optionsPanel,
            {
              backgroundColor: colors.surface,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          {MODES.map((m) => {
            const isActive = themeMode === m.mode;
            return (
              <Pressable
                key={m.mode}
                style={[
                  styles.optionRow,
                  isActive && { backgroundColor: colors.veryLightBlue },
                ]}
                onPress={() => {
                  setThemeMode(m.mode);
                  setExpanded(false);
                }}
              >
                <MaterialCommunityIcons
                  name={m.icon as any}
                  size={18}
                  color={isActive ? colors.primary : colors.textSecondary}
                />
                <AppText
                  variant="body"
                  style={{
                    color: isActive ? colors.primary : colors.text,
                    fontWeight: isActive ? "700" : "400",
                  }}
                >
                  {m.label}
                </AppText>
                {isActive && (
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={18}
                    color={colors.primary}
                    style={{ marginLeft: "auto" }}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "flex-end",
    zIndex: 100,
  },
  mainButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  optionsPanel: {
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    minWidth: 150,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
