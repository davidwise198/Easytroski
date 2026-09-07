import React, { useEffect } from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function tabIcon(name: IconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <MaterialCommunityIcons name={name} size={size} color={color} />
  );
}

export default function DriverTabsLayout() {
  const { user, userRole, loading } = useAuth();
  const { colors, isDark } = useThemeColors();
  const insets = useSafeAreaInsets();

  // Only drivers may use these tabs.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/auth/login");
    } else if (userRole !== "driver") {
      router.replace(userRole === "admin" ? "/admin-routes" : "/home");
    }
  }, [loading, user, userRole]);

  if (loading || !user || userRole !== "driver") {
    return null;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: isDark ? "#0E1E33" : "#FFFFFF",
          borderTopColor: colors.glassBorder,
          borderTopWidth: 1,
          height: 58 + insets.bottom,
          paddingTop: 6,
          paddingBottom: Math.max(insets.bottom, 8),
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen
        name="driver-home"
        options={{ title: "Home", tabBarIcon: tabIcon("home-variant") }}
      />
      <Tabs.Screen
        name="driver-map"
        options={{ title: "Map", tabBarIcon: tabIcon("map-outline") }}
      />
      <Tabs.Screen
        name="driver-trips"
        options={{ title: "Trips", tabBarIcon: tabIcon("history") }}
      />
    </Tabs>
  );
}