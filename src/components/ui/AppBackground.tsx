import React from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { COLORS } from "../../theme";

type AppBackgroundProps = {
  children: React.ReactNode;
};

export default function AppBackground({ children }: AppBackgroundProps) {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[COLORS.gradientStart, COLORS.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.decorativeCircle, styles.topCircle]} />
      <View style={[styles.decorativeCircle, styles.bottomCircle]} />
      <View style={[styles.routeLine, styles.routeLineOne]} />
      <View style={[styles.routeLine, styles.routeLineTwo]} />

      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  content: {
    flex: 1,
  },
  decorativeCircle: {
    position: "absolute",
    borderRadius: 200,
    opacity: 0.1,
  },
  topCircle: {
    width: 400,
    height: 400,
    top: -150,
    right: -100,
    backgroundColor: COLORS.primary,
  },
  bottomCircle: {
    width: 300,
    height: 300,
    bottom: -100,
    left: -50,
    backgroundColor: COLORS.secondary,
  },
  routeLine: {
    position: "absolute",
    height: 1,
    backgroundColor: COLORS.primary,
    opacity: 0.08,
  },
  routeLineOne: {
    width: 250,
    top: "36%",
    right: -60,
    transform: [{ rotate: "-26deg" }],
  },
  routeLineTwo: {
    width: 180,
    top: "43%",
    left: -45,
    transform: [{ rotate: "24deg" }],
  },
});
