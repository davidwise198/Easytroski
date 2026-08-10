import React from "react";
import {
  Text,
  TextProps,
  StyleSheet,
} from "react-native";

import { COLORS } from "../../theme";

interface SectionTitleProps extends TextProps {
  children: React.ReactNode;
}

export default function SectionTitle({
  children,
  style,
  ...props
}: SectionTitleProps) {
  return (
    <Text
      style={[styles.title, style]}
      {...props}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 36,
    fontWeight: "700",
    color: COLORS.primary,
    textAlign: "center",
    lineHeight: 44,
  },
});
