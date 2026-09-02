import React from "react";
import {
  StyleSheet,
  View,
  ViewProps,
} from "react-native";

import { useThemeColors } from "../../contexts/ThemeContext";

interface GlassSurfaceProps extends ViewProps {
  children: React.ReactNode;
  intensity?: number;
}

export default function GlassSurface({
  children,
  style,
  ...props
}: GlassSurfaceProps) {
  const { colors } = useThemeColors();

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: colors.glassBorder,
          backgroundColor: colors.glass,
          shadowColor: colors.navy,
        },
        style,
      ]}
      {...props}
    >
      <View style={styles.content}>
        {children}
      </View>
    </View>
  );
}


const styles = StyleSheet.create({

  container: {
    overflow: "hidden",
    borderRadius: 20,
    borderWidth: 1,
    shadowOffset: {
      width: 0,
      height: 12,
    },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
  },

  content: {
    padding: 20,
  },

});