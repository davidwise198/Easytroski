import React from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
} from "react-native";

import { COLORS, SPACING } from "../../theme";

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
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.text, styles[`text_${variant}`]]}>
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

  primary: {
    backgroundColor: COLORS.primary,
  },

  secondary: {
    backgroundColor: COLORS.navy,
  },

  outline: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: COLORS.primary,
  },

  text: {
    fontSize: 16,
    fontWeight: "600",
  },

  text_primary: {
    color: "#FFFFFF",
  },

  text_secondary: {
    color: "#FFFFFF",
  },

  text_outline: {
    color: COLORS.primary,
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