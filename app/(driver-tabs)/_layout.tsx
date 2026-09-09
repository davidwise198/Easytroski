import React, { useEffect, useState, useCallback } from "react";
import { StyleSheet, View, Text } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, Tabs, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import { getDriverActiveTrip, getDriverTrips } from "../../src/services/transport";
import { COLORS } from "../../src/theme";
import { auth } from "../../src/services/firebase";

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

// Badge component for unviewed bookings count
function DriverBookingBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View style={styles.badgeOuter}>
      <View style={[styles.badgeInner, { backgroundColor: COLORS.accent }]}>
        <MaterialCommunityIcons name="bell-circle" size={10} color={COLORS.white} />
        {count > 9 ? (
          <Text style={styles.badgeText}>9+</Text>
        ) : (
          <Text style={styles.badgeText}>{count}</Text>
        )}
      </View>
    </View>
  );
}

export default function DriverTabsLayout() {
  const { user, userRole, loading } = useAuth();
  const { colors, isDark } = useThemeColors();
  const insets = useSafeAreaInsets();
  const [unviewedBookingsCount, setUnviewedBookingsCount] = useState(0);

  // Only drivers may use these tabs.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/auth/login");
    } else if (userRole !== "driver") {
      router.replace(userRole === "admin" ? "/admin-routes" : "/home");
    }
  }, [loading, user, userRole]);

  // Refresh unviewed bookings count when the tab comes into focus
  useFocusEffect(
    useCallback(() => {
      const driverId = auth.currentUser?.uid;
      if (!driverId) {
        setUnviewedBookingsCount(0);
        return;
      }
      // Check for pending bookings (unviewed = pending status)
      getDriverTrips(driverId).then((trips) => {
        // Count pending bookings from active trips
        const activeTrips = trips.filter(
          (t) =>
            t.status === "online" ||
            t.status === "boarding" ||
            t.status === "in_progress"
        );
        if (activeTrips.length > 0) {
          // If there's an active trip, we consider there might be bookings
          // The actual count will be updated by the driver-map screen
          setUnviewedBookingsCount(1);
        } else {
          setUnviewedBookingsCount(0);
        }
      }).catch(() => setUnviewedBookingsCount(0));
    }, [])
  );

  if (loading || !user || userRole !== "driver") {
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
        name="driver-home"
        options={{ title: "Home", tabBarIcon: pillIcon("home-variant", colors.primary) }}
      />
      <Tabs.Screen
        name="driver-map"
        options={{
          title: "Map",
          tabBarIcon: ({ focused, color }) => (
            <View style={styles.tabIconContainer}>
              <View style={[styles.tabIconInner, focused && { backgroundColor: colors.primary }]}>
                <MaterialCommunityIcons
                  name="map-outline"
                  size={22}
                  color={focused ? "#FFFFFF" : color}
                />
              </View>
              <DriverBookingBadge count={unviewedBookingsCount} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="driver-trips"
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
  tabIconContainer: {
    position: "relative",
  },
  tabIconInner: {
    width: 44,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeOuter: {
    position: "absolute",
    top: -4,
    right: -4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeInner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 0,
  },
  badgeText: {
    color: COLORS.white,
    fontSize: 9,
    fontWeight: "700",
  },
});
