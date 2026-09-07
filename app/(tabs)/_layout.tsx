import React from "react";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function tabIcon(name: IconName) {
  return ({ color, size }: { color: string; size: number }) => (
    <MaterialCommunityIcons name={name} size={size} color={color} />
  );
}

export default function TabsLayout() {
  const { userRole } = useAuth();
  const { colors, isDark } = useThemeColors();
  const insets = useSafeAreaInsets();
  const isDriver = userRole === "driver";

  const passengerHidden = isDriver ? {} : { href: null as null };
  const driverHidden = isDriver ? { href: null as null } : {};

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
      {isDriver ? (
        <>
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
          <Tabs.Screen name="home" options={passengerHidden} />
          <Tabs.Screen name="routes" options={passengerHidden} />
          <Tabs.Screen name="map" options={passengerHidden} />
          <Tabs.Screen name="trips" options={passengerHidden} />
        </>
      ) : (
        <>
          <Tabs.Screen
            name="home"
            options={{ title: "Home", tabBarIcon: tabIcon("home-variant") }}
          />
          <Tabs.Screen
            name="routes"
            options={{ title: "Routes", tabBarIcon: tabIcon("map-search") }}
          />
          <Tabs.Screen
            name="map"
            options={{ title: "Map", tabBarIcon: tabIcon("map-outline") }}
          />
          <Tabs.Screen
            name="trips"
            options={{ title: "Trips", tabBarIcon: tabIcon("history") }}
          />
          <Tabs.Screen name="driver-home" options={driverHidden} />
          <Tabs.Screen name="driver-map" options={driverHidden} />
          <Tabs.Screen name="driver-trips" options={driverHidden} />
        </>
      )}
    </Tabs>
  );
}