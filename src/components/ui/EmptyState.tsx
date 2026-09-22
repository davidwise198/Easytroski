import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "./AppText";
import { COLORS, SPACING } from "../../theme";
import { useThemeColors } from "../../contexts/ThemeContext";

/**
 * The one place a screen says "nothing here yet", "still loading" or "that
 * failed" — so no screen is ever a blank white page, and every one of them
 * looks the same.
 */
type EmptyStateProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: "neutral" | "error";
  /** Shows a spinner in place of the icon — used while loading. */
  busy?: boolean;
};

export default function EmptyState({
  icon,
  title,
  message,
  actionLabel,
  onAction,
  tone = "neutral",
  busy = false,
}: EmptyStateProps) {
  const { colors } = useThemeColors();
  const accent = tone === "error" ? COLORS.danger : COLORS.primary;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}
    >
      {busy ? (
        <ActivityIndicator color={COLORS.primary} />
      ) : (
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: tone === "error" ? "rgba(239,68,68,0.12)" : colors.blueWash },
          ]}
        >
          <MaterialCommunityIcons name={icon} size={26} color={accent} />
        </View>
      )}

      <AppText variant="heading" style={[styles.title, { color: colors.text }]}>
        {title}
      </AppText>

      {message ? (
        <AppText variant="caption" style={[styles.message, { color: colors.textSecondary }]}>
          {message}
        </AppText>
      ) : null}

      {actionLabel && onAction ? (
        <Pressable
          style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}
          onPress={onAction}
        >
          <AppText variant="caption" style={styles.actionText}>
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: SPACING.md,
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: SPACING.md,
    textAlign: "center",
  },
  message: {
    marginTop: SPACING.xs,
    textAlign: "center",
    lineHeight: 18,
  },
  action: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm + 2,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
  },
  actionText: {
    color: COLORS.white,
    fontWeight: "700",
  },
});
