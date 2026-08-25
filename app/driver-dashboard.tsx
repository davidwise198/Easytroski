import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";

import AppBackground from "../src/components/ui/AppBackground";
import AppText from "../src/components/ui/AppText";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import AuthGate from "../src/components/AuthGate";
import { useAuth } from "../src/contexts/AuthContext";
import { getActiveRoutes, setDriverAvailability, startTrip, updateDriverLocation } from "../src/services/transport";
import { COLORS, SPACING } from "../src/theme";
import { Route } from "../src/types/models";

export default function DriverDashboardScreen() {
  const { user, signOut } = useAuth();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getActiveRoutes()
      .then((activeRoutes) => {
        setRoutes(activeRoutes);
        setSelectedRouteId(activeRoutes[0]?.id || null);
      })
      .catch((error) => console.error("Driver route loading error:", error))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const driverId = user?.uid;
    if (!online || !driverId) {
      return;
    }

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    const startLocationTracking = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setOnline(false);
        alert("Location permission is needed while you are online.");
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 50,
        },
        ({ coords }) => {
          if (!cancelled) {
            void updateDriverLocation(driverId, coords.latitude, coords.longitude);
          }
        }
      );
    };

    void startLocationTracking().catch((error) => {
      console.error("Location tracking error:", error);
    });

    return () => {
      cancelled = true;
      try {
        subscription?.remove();
      } catch {
        // expo-location 19.x may throw LocationEventEmitter.removeSubscription error
        // Safe to ignore — the subscription is cleaned up by the native layer
      }
    };
  }, [online, user?.uid]);

  const handleAvailability = async (nextOnline: boolean) => {
    const driverId = user?.uid;
    if (!driverId) return;

    setOnline(nextOnline);
    try {
      await setDriverAvailability(driverId, nextOnline);
    } catch (error) {
      setOnline(!nextOnline);
      console.error("Driver availability error:", error);
      alert("We could not update your availability.");
    }
  };

  const handleStartTrip = async () => {
    const driverId = user?.uid;
    if (!driverId || !selectedRouteId) {
      alert("Choose a route before starting a trip.");
      return;
    }

    setStarting(true);
    try {
      await startTrip(driverId, selectedRouteId, "going");
      setOnline(true);
      alert("Trip started. Passengers can now see your active route.");
    } catch (error) {
      console.error("Trip start error:", error);
      alert("We could not start this trip. Please try again.");
    } finally {
      setStarting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    // AuthGate will redirect to login once auth state clears
  };

  return (
    <AuthGate allowedRoles={["driver"]}>
      <AppBackground>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <View>
              <AppText variant="caption" style={styles.eyebrow}>DRIVER CONTROL</AppText>
              <AppText variant="title" style={styles.title}>Ready to move?</AppText>
              <AppText variant="body" style={styles.subtitle}>Manage your route and keep passengers moving.</AppText>
            </View>
            <View style={styles.driverIcon}>
              <MaterialCommunityIcons name="steering" size={25} color={COLORS.primary} />
            </View>
          </View>

          <View style={styles.statusPanel}>
            <View style={styles.statusCopy}>
              <AppText variant="heading" style={styles.statusTitle}>{online ? "You are online" : "You are offline"}</AppText>
              <AppText variant="caption" style={styles.statusText}>{online ? "Passengers can find your active trip." : "Go online when you are ready to accept passengers."}</AppText>
            </View>
            <Switch value={online} onValueChange={(value) => void handleAvailability(value)} trackColor={{ false: "#B8C5D1", true: COLORS.primary }} thumbColor={COLORS.secondary} />
          </View>

          <AppText variant="heading" style={styles.sectionTitle}>Choose your route</AppText>
          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={styles.loader} />
          ) : routes.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="map-marker-off-outline" size={38} color={COLORS.primary} />
              <AppText variant="body" style={styles.emptyText}>No active routes are available yet.</AppText>
            </View>
          ) : (
            <View style={styles.routeList}>
              {routes.map((route) => (
                <View key={route.id} style={[styles.routeRow, route.id === selectedRouteId && styles.selectedRoute]}>
                  <View style={styles.routeCopy}>
                    <AppText variant="heading" style={styles.routeTitle}>{route.origin}</AppText>
                    <AppText variant="caption" style={styles.routeDestination}>to {route.destination}</AppText>
                  </View>
                  <Switch value={route.id === selectedRouteId} onValueChange={() => setSelectedRouteId(route.id)} trackColor={{ false: "#C9D5DF", true: COLORS.primary }} thumbColor={COLORS.secondary} />
                </View>
              ))}
            </View>
          )}

          <PrimaryButton title={starting ? "Starting trip..." : "Start trip"} onPress={() => void handleStartTrip()} disabled={starting || !selectedRouteId} style={styles.startButton} />
          <PrimaryButton title="Sign Out" onPress={() => void handleSignOut()} variant="outline" />
        </ScrollView>
      </AppBackground>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xxl },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: SPACING.xl },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: SPACING.xs },
  title: { color: COLORS.navy, fontSize: 31, lineHeight: 39 },
  subtitle: { color: COLORS.textSecondary, maxWidth: 250, marginTop: SPACING.xs },
  driverIcon: { width: 48, height: 48, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.blueWash },
  statusPanel: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: SPACING.md, borderRadius: 20, backgroundColor: COLORS.navy, marginBottom: SPACING.xl },
  statusCopy: { flex: 1, paddingRight: SPACING.md },
  statusTitle: { color: COLORS.secondary, fontSize: 18, lineHeight: 24 },
  statusText: { color: "rgba(255,255,255,0.72)", marginTop: 3 },
  sectionTitle: { color: COLORS.navy, fontSize: 19, lineHeight: 25, marginBottom: SPACING.md },
  loader: { marginVertical: SPACING.xl },
  routeList: { gap: SPACING.sm },
  routeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: SPACING.md, borderRadius: 18, backgroundColor: "rgba(232,243,255,0.72)", borderWidth: 1, borderColor: "transparent" },
  selectedRoute: { borderColor: COLORS.primary, backgroundColor: COLORS.blueWash },
  routeCopy: { flex: 1 },
  routeTitle: { color: COLORS.navy, fontSize: 16, lineHeight: 21 },
  routeDestination: { color: COLORS.textSecondary, marginTop: 2 },
  emptyState: { alignItems: "center", padding: SPACING.xl },
  emptyText: { color: COLORS.textSecondary, textAlign: "center", marginTop: SPACING.sm },
  startButton: { marginTop: SPACING.xl, marginBottom: SPACING.md },
});
