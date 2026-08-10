import React, { useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  TextInputProps,
  Pressable,
  Text,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";

import { COLORS, SPACING } from "../../theme";

interface GlassInputProps extends TextInputProps {
  label?: string;
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  error?: string;
  showPasswordToggle?: boolean;
}

export default function GlassInput({
  label,
  icon,
  error,
  showPasswordToggle = false,
  secureTextEntry = false,
  style,
  ...props
}: GlassInputProps) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  return (
    <View style={styles.container}>
      <View style={styles.inputWrapper}>
        <BlurView intensity={40} style={StyleSheet.absoluteFill} />

        <View style={styles.inputContent}>
          {icon && (
            <MaterialCommunityIcons
              name={icon}
              size={20}
              color={COLORS.primary}
              style={styles.icon}
            />
          )}

          <TextInput
            style={[styles.input, style]}
            placeholderTextColor={COLORS.textSecondary}
            secureTextEntry={
              showPasswordToggle ? !isPasswordVisible : secureTextEntry
            }
            {...props}
          />

          {showPasswordToggle && (
            <Pressable
              onPress={() => setIsPasswordVisible(!isPasswordVisible)}
              style={styles.toggleButton}
            >
              <MaterialCommunityIcons
                name={isPasswordVisible ? "eye" : "eye-off"}
                size={20}
                color={COLORS.primary}
              />
            </Pressable>
          )}
        </View>
      </View>

      {error && (
        <View style={styles.errorContainer}>
          <MaterialCommunityIcons
            name="alert-circle"
            size={14}
            color={COLORS.danger}
          />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },

  inputWrapper: {
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(23,105,224,0.2)",
    backgroundColor: "rgba(232,243,255,0.78)",
  },

  inputContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    height: 56,
  },

  icon: {
    marginRight: SPACING.sm,
  },

  input: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
    fontWeight: "500",
  },

  toggleButton: {
    padding: SPACING.sm,
    marginLeft: SPACING.sm,
  },

  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: SPACING.sm,
  },

  errorText: {
    fontSize: 12,
    color: COLORS.danger,
    marginLeft: SPACING.sm,
    fontWeight: "500",
  },
});
