import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";

type AppLogoProps = {
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Modern EasyTroski app mark: a blue gradient "glass" tile with a soft
 * 3D base (extrusion), glossy top sheen, a white bus glyph and a gold
 * seat badge — rendered purely from views + gradients so it scales
 * crisply at any size with no image assets.
 */
export default function AppLogo({ size = 96, style }: AppLogoProps) {
  const radius = size * 0.26;

  return (
    <View
      style={[
        {
          width: size,
          height: size + size * 0.07,
        },
        style,
      ]}
    >
      {/* 3D extrusion base */}
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: size * 0.055,
          height: size * 0.92,
          borderRadius: radius,
          backgroundColor: "#0A3FA8",
        }}
      />
      {/* Glossy gradient tile */}
      <LinearGradient
        colors={["#54A6FF", "#1769E0", "#0E54C8"]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: size,
          borderRadius: radius,
          shadowColor: "#0A3FA8",
          shadowOffset: { width: 0, height: size * 0.06 },
          shadowOpacity: 0.45,
          shadowRadius: size * 0.05,
          elevation: 6,
        }}
      >
        {/* Top gloss sheen */}
        <LinearGradient
          colors={["rgba(255,255,255,0.38)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
        {/* Bottom soft shading for depth */}
        <LinearGradient
          colors={["rgba(255,255,255,0)", "rgba(6,32,84,0.35)"]}
          start={{ x: 0, y: 0.72 }}
          end={{ x: 0, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />

        {/* Bus glyph */}
        <View style={styles.busWrap}>
          <MaterialCommunityIcons
            name="bus"
            size={size * 0.52}
            color="#FFFFFF"
          />
        </View>
      </LinearGradient>

      {/* Gold seat badge */}
      <View
        style={{
          position: "absolute",
          top: size * 0.035,
          right: size * 0.035,
          width: size * 0.34,
          height: size * 0.34,
          borderRadius: size * 0.17,
          backgroundColor: "#F2A93B",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#7A4E00",
          shadowOffset: { width: 0, height: size * 0.02 },
          shadowOpacity: 0.35,
          shadowRadius: size * 0.02,
          elevation: 3,
        }}
      >
        <MaterialCommunityIcons
          name="seat"
          size={size * 0.2}
          color="#FFFFFF"
        />
      </View>
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
