import React from "react";
import {
  StyleSheet,
  View,
  ViewProps,
} from "react-native";

import { COLORS } from "../../theme";

interface GlassSurfaceProps extends ViewProps {
  children: React.ReactNode;
  intensity?: number;
}

export default function GlassSurface({
  children,
  style,
  ...props
}: GlassSurfaceProps) {

  return (
    <View
      style={[
        styles.container,
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
    borderColor: COLORS.glassBorder,
    backgroundColor: COLORS.glass,
    shadowColor: COLORS.navy,
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