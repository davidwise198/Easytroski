import React from "react";
import {
  Text,
  TextProps,
  StyleSheet,
} from "react-native";

import { TYPOGRAPHY } from "../../theme";
import { useThemeColors } from "../../contexts/ThemeContext";


interface AppTextProps extends TextProps {

  variant?:
    | "title"
    | "heading"
    | "body"
    | "caption";

}


export default function AppText({
  variant = "body",
  style,
  children,
  ...props
}: AppTextProps) {
  const { colors } = useThemeColors();

  return (
    <Text
      style={[
        styles.base,
        TYPOGRAPHY[variant],
        { color: colors.text },
        style,
      ]}
      {...props}
    >
      {children}
    </Text>
  );
}


const styles = StyleSheet.create({

  base: {
    color: "#102A43",
  },

});