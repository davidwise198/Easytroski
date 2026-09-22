import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

// Same floating-pill tab bar as the passenger and driver tabs — the mate
// experience is part of EasyTroski, not a separate app.
function pillIcon(name: IconName, activeColor: string) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <View style={[styles.capsule, focused && { backgroundColor: activeColor }]}>
      <MaterialCommunityIcons name={name} size={22} color={focused ? "#FFFFFF" : color} />
    </View>
  );
}

export default function MateTabsLayout() {
  const { user, userRole, loading } = useAuth();
  const { colors, isDark } = useThemeColors();
  const insets = useSafeAreaInsets();

  // Only mates may use these tabs. Everyone else goes back to their own home.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/auth/login");
    } else if (userRole !== "mate") {
      router.replace(
        userRole === "admin"
          ? "/admin-routes"
          : userRole === "driver"
            ? "/driver-home"
            : "/home"
      );
    }
  }, [loading, user, userRole]);

  if (loading || !user || userRole !== "mate") {
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
        name="mate-home"
        options={{ title: "Home", tabBarIcon: pillIcon("home-variant", colors.primary) }}
      />
      <Tabs.Screen
        name="mate-passengers"
        options={{ title: "Passengers", tabBarIcon: pillIcon("account-group", colors.primary) }}
      />
      <Tabs.Screen
        name="mate-driver"
        options={{ title: "My Driver", tabBarIcon: pillIcon("steering", colors.primary) }}
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
