import React from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
} from "react-native";

import { SPACING } from "../../theme";
import { useThemeColors } from "../../contexts/ThemeContext";

type ButtonVariant = "primary" | "secondary" | "outline";

interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  style?: ViewStyle;
}

export default function PrimaryButton({
  title,
  onPress,
  disabled = false,
  variant = "primary",
  style,
}: PrimaryButtonProps) {
  const { colors } = useThemeColors();

  const variantStyles = {
    primary: { backgroundColor: colors.primary },
    secondary: { backgroundColor: colors.navy },
    outline: { backgroundColor: "transparent", borderWidth: 2, borderColor: colors.primary },
  };
  const textStyles = {
    primary: { color: "#FFFFFF" as const },
    secondary: { color: "#FFFFFF" as const },
    outline: { color: colors.primary },
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variantStyles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.text, textStyles[variant]]}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xl,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 8,
    },
    shadowOpacity: 0.15,
    shadowRadius: 15,
    elevation: 6,
  },

  text: {
    fontSize: 16,
    fontWeight: "600",
  },

  pressed: {
    transform: [
      {
        scale: 0.97,
      },
    ],
  },

  disabled: {
    opacity: 0.5,
  },
});