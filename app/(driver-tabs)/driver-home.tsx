import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import AuthGate from "../../src/components/AuthGate";
import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import {
  getActiveRoutes,
  getDriverActiveTrip,
  getDriverDefaultRoute,
  setDriverAvailability,
  startTrip,
  endTrip,
  updateDriverSeats,
  updateDriverLocation,
} from "../../src/services/transport";
import { getUserProfile, getPhotoURL } from "../../src/services/profile";
import { COLORS, SPACING } from "../../src/theme";
import { Route, Trip } from "../../src/types/models";
import { showToast } from "../../src/utils/toast";

// ---------------------------------------------------------------------------
// Pulse dot for online status
// ---------------------------------------------------------------------------

function PulseDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.8,
            duration: 1000,
            easing: Easing.out(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 1000,
            easing: Easing.in(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [scale, opacity]);

  return (
    <View style={styles.pulseWrap}>
      <Animated.View
        style={[
          styles.pulseRing,
          {
            backgroundColor: color,
            transform: [{ scale }],
            opacity,
          },
        ]}
      />
      <View style={[styles.pulseDot, { backgroundColor: color }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main driver dashboard — cockpit mode
// ---------------------------------------------------------------------------

export default function DriverDashboardScreen() {
  const { user } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(
    () => ({
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      statusTitle: { color: "#FFFFFF" },
      statusPanel: { backgroundColor: "#102A43" },
      statusPanelOnline: { backgroundColor: "#0D3320" },
      routeRow: { backgroundColor: colors.veryLightBlue + "BC" },
      selectedRoute: { borderColor: COLORS.primary, backgroundColor: colors.blueWash },
      seatCounterCard: { backgroundColor: colors.blueWash, borderColor: colors.veryLightBlue },
      seatBtn: { backgroundColor: colors.white, borderColor: colors.veryLightBlue },
      driverIcon: { backgroundColor: colors.blueWash },
    }),
    [colors]
  );

  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [lockedRouteId, setLockedRouteId] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [ending, setEnding] = useState(false);
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [seatCount, setSeatCount] = useState(12);

  // Fetch user profile
  useEffect(() => {
    if (user?.uid) {
      getUserProfile(user.uid).then(setProfile).catch(() => {});
    }
  }, [user?.uid]);

  // Check for active trip on mount
  useEffect(() => {
    const driverId = user?.uid;
    if (!driverId) return;

    getDriverActiveTrip(driverId)
      .then((trip) => {
        if (trip) {
          setActiveTrip(trip);
          setOnline(true);
          setSelectedRouteId(trip.routeId);
        }
      })
      .catch((error) => console.error("Active trip check error:", error));
  }, [user?.uid]);

  useEffect(() => {
    const driverId = user?.uid;
    Promise.all([
      getActiveRoutes(),
      driverId ? getDriverDefaultRoute(driverId) : Promise.resolve(null),
    ])
      .then(([activeRoutes, defaultRouteId]) => {
        setRoutes(activeRoutes);
        if (defaultRouteId && activeRoutes.some((r) => r.id === defaultRouteId)) {
          // Saved default wins — it's locked until changed in Profile settings.
          setLockedRouteId(defaultRouteId);
          setSelectedRouteId(defaultRouteId);
        } else if (!selectedRouteId && activeRoutes.length > 0) {
          setSelectedRouteId(activeRoutes[0].id);
        }
      })
      .catch((error) => console.error("Driver route loading error:", error))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Keep the screen awake while online — a driver mid-trip must never miss a booking.
  useEffect(() => {
    if (online) {
      activateKeepAwakeAsync().catch(() => {});
    } else {
      deactivateKeepAwake();
    }
  }, [online]);

  // Location tracking when online
  useEffect(() => {
    const driverId = user?.uid;
    if (!online || !driverId) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    const startLocationTracking = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setOnline(false);
        showToast(
          "warning",
          "Location needed",
          "Location permission is required while you are online."
        );
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
        // expo-location cleanup — safe to ignore
      }
    };
  }, [online, user?.uid]);

  const handleAvailability = async (nextOnline: boolean) => {
    const driverId = user?.uid;
    if (!driverId) return;

    setOnline(nextOnline);
    try {
      await setDriverAvailability(driverId, nextOnline);
    } catch {
      setOnline(!nextOnline);
      showToast("error", "Update failed", "Could not update your availability.");
    }
  };

  const handleStartTrip = async () => {
    const driverId = user?.uid;
    if (!driverId || !selectedRouteId) {
      showToast("warning", "No route", "Choose a route before starting.");
      return;
    }
    if (activeTrip) {
      showToast("warning", "Trip active", "End your current trip first.");
      return;
    }

    setStarting(true);
    try {
      const tripId = await startTrip(driverId, selectedRouteId, "going", seatCount);
      // Land the driver on the map where live bookings appear
      router.replace("/driver-map");
      setActiveTrip({
        id: tripId,
        driverId,
        routeId: selectedRouteId,
        status: "in_progress",
        direction: "going",
        startTime: new Date() as any,
      });
      setOnline(true);
      showToast("success", "Trip started", "Passengers can now see you.");
    } catch {
      showToast("error", "Failed", "Could not start trip. Try again.");
    } finally {
      setStarting(false);
    }
  };

  const handleEndTrip = async () => {
    const driverId = user?.uid;
    if (!activeTrip || !driverId) return;

    setEnding(true);
    try {
      await endTrip(activeTrip.id, driverId);
      setActiveTrip(null);
      setOnline(false);
      showToast("success", "Trip ended", "You are now offline.");
    } catch {
      showToast("error", "Failed", "Could not end trip. Try again.");
    } finally {
      setEnding(false);
    }
  };

  const handleUpdateSeats = async (newCount: number) => {
    const driverId = user?.uid;
    if (!driverId) return;
    const clamped = Math.max(0, Math.min(30, newCount));
    setSeatCount(clamped);
    try {
      await updateDriverSeats(driverId, clamped);
    } catch {
      showToast("error", "Failed", "Could not update seat count.");
    }
  };

  const displayName =
    profile?.name || user?.displayName || user?.email?.split("@")[0] || "Driver";
  const photoURL = getPhotoURL(user, profile);

  return (
    <AuthGate allowedRoles={["driver"]}>
      <AppBackground>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* ─── Status header ─── */}
          <View style={styles.headerRow}>
            <View style={styles.statusCopy}>
              {online && <PulseDot color={COLORS.success} />}
              <AppText variant="heading" style={[styles.driverName, ds.text]}>
                {displayName}
              </AppText>
            </View>
            <Pressable
              onPress={() => router.push("/profile")}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.driverIcon, ds.driverIcon]}>
                {photoURL ? (
                  <Image source={{ uri: photoURL }} style={styles.driverPhoto} resizeMode="cover" />
                ) : (
                  <MaterialCommunityIcons name="account" size={24} color={colors.primary} />
                )}
              </View>
            </Pressable>
          </View>

          {/* ─── Status panel + online switch ─── */}
          <View style={[styles.statusPanel, ds.statusPanel, online && ds.statusPanelOnline]}>
            <View style={styles.statusCopy}>
              <AppText variant="heading" style={[styles.statusTitle, ds.statusTitle]} numberOfLines={1}>
                {activeTrip ? "Trip active" : online ? "You are online" : "You are offline"}
              </AppText>
              <AppText variant="caption" style={styles.statusText} numberOfLines={2}>
                {activeTrip
                  ? "Passengers can see your trip on the map."
                  : online
                    ? "Passengers can find your active trip."
                    : "Go online when you are ready to drive."}
              </AppText>
            </View>
            {!activeTrip && (
              <Switch
                value={online}
                onValueChange={(v) => void handleAvailability(v)}
                trackColor={{ false: "#4A5568", true: COLORS.success }}
                thumbColor={COLORS.white}
              />
            )}
          </View>

          {/* ─── Active trip quick actions ─── */}
          {activeTrip && (
            <View style={styles.activeTripRow}>
              <Pressable
                style={({ pressed }) => [styles.activeTripBtn, pressed && { opacity: 0.7 }]}
                onPress={() => router.navigate("/driver-map")}
              >
                <MaterialCommunityIcons name="map" size={20} color={COLORS.primary} />
                <AppText variant="body" style={[styles.activeTripBtnText, ds.text]}>
                  Open map
                </AppText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.activeTripBtn, styles.activeTripBtnEnd, pressed && { opacity: 0.7 }]}
                onPress={() => void handleEndTrip()}
                disabled={ending}
              >
                <MaterialCommunityIcons name="stop-circle-outline" size={20} color={COLORS.white} />
                <AppText variant="body" style={styles.activeTripBtnEndText}>
                  {ending ? "Ending..." : "End trip"}
                </AppText>
              </Pressable>
            </View>
          )}

          {/* ─── Routes ─── */}
          <AppText variant="caption" style={[styles.sectionLabel, ds.secondary]}>
            {activeTrip ? "CURRENT ROUTE" : lockedRouteId ? "YOUR DEFAULT ROUTE" : "CHOOSE YOUR ROUTE"}
          </AppText>
          {lockedRouteId && (
            <AppText variant="caption" style={[styles.lockNote, ds.secondary]}>
              Locked as your default — change it in Profile settings.
            </AppText>
          )}
          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: SPACING.lg }} />
          ) : routes.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="map-marker-off-outline"
                size={36}
                color={colors.textSecondary}
              />
              <AppText variant="body" style={[styles.emptyText, ds.secondary]}>
                No routes available yet.
              </AppText>
              <AppText variant="caption" style={[styles.emptyHint, ds.secondary]}>
                Contact an admin to add routes.
              </AppText>
            </View>
          ) : (
            <View style={styles.routeList}>
              {routes.map((route) => (
                <Pressable
                  key={route.id}
                  style={[
                    [styles.routeRow, ds.routeRow],
                    route.id === selectedRouteId && [styles.selectedRoute, ds.selectedRoute],
                    lockedRouteId && route.id !== selectedRouteId && styles.routeRowDim,
                  ]}
                  onPress={() => {
                    if (lockedRouteId) {
                      showToast(
                        "info",
                        "Route locked",
                        "Your default route can be changed in Profile settings."
                      );
                      return;
                    }
                    setSelectedRouteId(route.id);
                  }}
                >
                  <View style={styles.routeRadio}>
                    <View
                      style={[
                        styles.routeRadioInner,
                        route.id === selectedRouteId && styles.routeRadioActive,
                      ]}
                    />
                  </View>
                  <View style={styles.routeCopy}>
                    <AppText variant="heading" style={[styles.routeTitle, ds.text]}>
                      {route.origin}
                    </AppText>
                    <AppText variant="caption" style={[styles.routeDest, ds.secondary]}>
                      → {route.destination}
                      {route.stops?.length ? ` (${route.stops.length} stops)` : ""}
                    </AppText>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* ─── Seat counter ─── */}
          {!activeTrip && (
            <View style={[styles.seatCounterCard, ds.seatCounterCard]}>
              <View style={styles.seatCounterLeft}>
                <MaterialCommunityIcons name="seat" size={20} color={COLORS.primary} />
                <AppText variant="heading" style={[styles.seatCounterLabel, ds.text]}>
                  Available seats
                </AppText>
              </View>
              <View style={styles.seatCounterControls}>
                <Pressable
                  style={[styles.seatBtn, ds.seatBtn]}
                  onPress={() => void handleUpdateSeats(seatCount - 1)}
                >
                  <MaterialCommunityIcons name="minus" size={18} color={COLORS.primary} />
                </Pressable>
                <AppText variant="heading" style={[styles.seatCountText, ds.text]}>
                  {seatCount}
                </AppText>
                <Pressable
                  style={[styles.seatBtn, ds.seatBtn]}
                  onPress={() => void handleUpdateSeats(seatCount + 1)}
                >
                  <MaterialCommunityIcons name="plus" size={18} color={COLORS.primary} />
                </Pressable>
              </View>
            </View>
          )}

          {/* ─── Giant start trip button ─── */}
          {!activeTrip && (
            <PrimaryButton
              title={starting ? "Starting..." : "Start trip"}
              onPress={() => void handleStartTrip()}
              disabled={starting || !selectedRouteId}
              style={styles.startButton}
            />
          )}
        </ScrollView>
      </AppBackground>
    </AuthGate>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: 120,
  },

  /* ── Header ── */
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.lg,
  },
  statusCopy: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    flex: 1,
  },
  driverName: { fontSize: 22, lineHeight: 28 },
  driverIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  driverPhoto: { width: 46, height: 46, borderRadius: 16 },

  /* ── Status panel ── */
  statusPanel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.lg,
    borderRadius: 20,
    backgroundColor: "#102A43",
    marginBottom: SPACING.lg,
  },
  statusTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 24,
    flexShrink: 1,
  },
  statusText: {
    color: "rgba(255,255,255,0.72)",
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },

  /* ── Pulse dot ── */
  pulseWrap: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  /* ── Active trip quick actions ── */
  activeTripRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  activeTripBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    borderRadius: 16,
    backgroundColor: COLORS.blueWash,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  activeTripBtnText: { color: COLORS.primary, fontWeight: "700" },
  activeTripBtnEnd: {
    backgroundColor: COLORS.danger,
    borderColor: COLORS.danger,
  },
  activeTripBtnEndText: { color: COLORS.white, fontWeight: "700" },

  /* ── Routes ── */
  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: SPACING.sm,
  },
  routeList: { gap: SPACING.sm },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.lg,
    borderRadius: 18,
    backgroundColor: "rgba(232,243,255,0.72)",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  selectedRoute: {
    borderColor: COLORS.primary,
  },
  routeRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: SPACING.md,
  },
  routeRadioInner: {
    width: 0,
    height: 0,
    borderRadius: 0,
  },
  routeRadioActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  routeCopy: { flex: 1 },
  routeTitle: { fontSize: 16, lineHeight: 21 },
  routeDest: { marginTop: 2 },
  routeRowDim: {
    opacity: 0.55,
  },
  lockNote: {
    fontSize: 12,
    marginTop: -2,
    marginBottom: SPACING.sm,
  },

  emptyState: { alignItems: "center", padding: SPACING.xl },
  emptyText: {
    textAlign: "center",
    marginTop: SPACING.sm,
  },
  emptyHint: {
    textAlign: "center",
    marginTop: SPACING.xs,
    opacity: 0.6,
    fontSize: 12,
  },

  /* ── Seat counter ── */
  seatCounterCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.lg,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  seatCounterLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  seatCounterLabel: {
    fontSize: 15,
  },
  seatCounterControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  seatBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  seatCountText: {
    fontSize: 24,
    minWidth: 36,
    textAlign: "center",
  },

  /* ── Start button ── */
  startButton: {
    marginTop: SPACING.md,
    height: 60,
    borderRadius: 18,
  },
});
