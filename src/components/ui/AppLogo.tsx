import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";

type AppLogoProps = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * EasyTroski app mark: a clean blue gradient tile with a white bus icon.
 * Rendered purely from views + gradients so it scales crisply at any size
 * with no image assets.
 */
export default function AppLogo({ size = 96, style }: AppLogoProps) {
  const radius = size * 0.24;

  return (
    <View style={[{ width: size, height: size }, style]}>
      <LinearGradient
        colors={["#54A6FF", "#1769E0", "#0E54C8"]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={{
          ...StyleSheet.absoluteFillObject,
          borderRadius: radius,
          shadowColor: "#0A3FA8",
          shadowOffset: { width: 0, height: size * 0.05 },
          shadowOpacity: 0.35,
          shadowRadius: size * 0.05,
          elevation: 5,
        }}
      >
        <View style={styles.busWrap}>
          <MaterialCommunityIcons name="bus" size={size * 0.5} color="#FFFFFF" />
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  busWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
});