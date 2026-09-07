import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

// Modern floating-pill tab bar: the active icon sits inside a filled
// capsule, the bar itself floats as a rounded pill above the bottom edge.
function pillIcon(name: IconName, activeColor: string) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <View style={[styles.capsule, focused && { backgroundColor: activeColor }]}>
      <MaterialCommunityIcons
        name={name}
        size={22}
        color={focused ? "#FFFFFF" : color}
      />
    </View>
  );
}

export default function PassengerTabsLayout() {
  const { user, userRole, loading } = useAuth();
  const { colors, isDark } = useThemeColors();
  const insets = useSafeAreaInsets();

  // Only passengers may use these tabs.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/auth/login");
    } else if (userRole === "driver") {
      router.replace("/driver-home");
    } else if (userRole === "admin") {
      router.replace("/admin-routes");
    }
  }, [loading, user, userRole]);

  if (loading || !user || userRole === "driver" || userRole === "admin") {
    return null;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          position: "absolute",
          left: 14,
          right: 14,
          bottom: Math.max(insets.bottom, 10),
          height: 64,
          borderRadius: 26,
          backgroundColor: isDark ? "#141D2E" : "#FFFFFF",
          borderTopWidth: 0,
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: isDark ? 0.45 : 0.12,
          shadowRadius: 16,
          elevation: 10,
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarItemStyle: {
          borderRadius: 20,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", tabBarIcon: pillIcon("home-variant", colors.primary) }}
      />
      <Tabs.Screen
        name="routes"
        options={{ title: "Routes", tabBarIcon: pillIcon("map-search", colors.primary) }}
      />
      <Tabs.Screen
        name="map"
        options={{ title: "Map", tabBarIcon: pillIcon("map-outline", colors.primary) }}
      />
      <Tabs.Screen
        name="trips"
        options={{ title: "Trips", tabBarIcon: pillIcon("history", colors.primary) }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  capsule: {
    width: 44,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});