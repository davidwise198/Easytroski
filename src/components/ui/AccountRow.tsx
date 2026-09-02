import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "./AppText";
import { useThemeColors } from "../../contexts/ThemeContext";
import { useMemo } from "react";
import { COLORS, SPACING } from "../../theme";

type AccountRowProps = {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  label: string;
  value: string;
};

export default function AccountRow({ icon, label, value }: AccountRowProps) {
  const { colors } = useThemeColors();
  const ds = useMemo(() => ({
    label: { color: colors.textSecondary },
    value: { color: colors.text },
    iconWrap: { backgroundColor: colors.blueWash },
  }), [colors]);
  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, ds.iconWrap]}>
        <MaterialCommunityIcons name={icon} size={17} color={COLORS.primary} />
      </View>
      <View style={styles.copy}>
        <AppText variant="caption" style={[styles.label, ds.label]}>
          {label}
        </AppText>
        <AppText variant="body" style={[styles.value, ds.value]}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: SPACING.sm + 2,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
    marginRight: SPACING.md,
  },
  copy: {
    flex: 1,
  },
  label: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginBottom: 1,
  },
  value: {
    color: COLORS.navy,
    fontSize: 15,
  },
});
