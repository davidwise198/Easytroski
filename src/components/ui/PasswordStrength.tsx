import React from "react";
import { View, StyleSheet } from "react-native";
import AppText from "./AppText";
import { COLORS, SPACING } from "../../theme";

function getStrength(password: string): {
  score: number;
  label: string;
  color: string;
} {
  let score = 0;
  if (password.length >= 6) score++;
  if (password.length >= 10) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: "Weak", color: COLORS.danger };
  if (score <= 3) return { score, label: "Fair", color: COLORS.warning };
  return { score, label: "Strong", color: COLORS.success };
}

export default function PasswordStrength({
  password,
}: {
  password: string;
}) {
  if (!password) return null;

  const { score, label, color } = getStrength(password);
  const segments = 5;

  return (
    <View style={styles.container}>
      <View style={styles.barRow}>
        {Array.from({ length: segments }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.segment,
              i < score && { backgroundColor: color },
            ]}
          />
        ))}
      </View>
      <AppText variant="caption" style={[styles.label, { color }]}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.xs,
  },
  barRow: {
    flex: 1,
    flexDirection: "row",
    gap: 3,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.veryLightBlue,
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    minWidth: 40,
  },
});
