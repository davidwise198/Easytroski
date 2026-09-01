import React, { useEffect, useRef, useState } from "react";
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

import AppBackground from "../src/components/ui/AppBackground";
import AppText from "../src/components/ui/AppText";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import AuthGate from "../src/components/AuthGate";
import { useAuth } from "../src/contexts/AuthContext";
import {
  getActiveRoutes,
  getDriverActiveTrip,
  setDriverAvailability,
  startTrip,
  endTrip,
  updateDriverSeats,
  updateDriverLocation,
} from "../src/services/transport";
import { getUserProfile, getPhotoURL } from "../src/services/profile";
import { COLORS, SPACING } from "../src/theme";
import { Route, Trip } from "../src/types/models";
import { showToast } from "../src/utils/toast";

// ---------------------------------------------------------------------------
// Animated entrance wrapper
// ---------------------------------------------------------------------------

function FadeSlideIn({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(24)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 400,
        delay,
        easing: Easing.out(Easing.bezier(0.34, 1.56, 0.64, 1)),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, opacity, translateY]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

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
// Main driver dashboard
// ---------------------------------------------------------------------------

export default function DriverDashboardScreen() {
  const { user, signOut } = useAuth();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
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
    getActiveRoutes()
      .then((activeRoutes) => {
        setRoutes(activeRoutes);
        if (!selectedRouteId && activeRoutes.length > 0) {
          setSelectedRouteId(activeRoutes[0].id);
        }
      })
      .catch((error) => console.error("Driver route loading error:", error))
      .finally(() => setLoading(false));
  }, []);

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

  const handleSignOut = async () => {
    await signOut();
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
          {/* ─── Header ─── */}
          <FadeSlideIn delay={0}>
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="caption" style={styles.eyebrow}>
                  DRIVER CONTROL
                </AppText>
                <AppText variant="title" style={styles.title}>
                  Ready to move?
                </AppText>
                <AppText variant="heading" style={styles.driverName}>
                  {displayName} 👋
                </AppText>
              </View>
              <Pressable
                onPress={() => router.push("/profile")}
                style={({ pressed }) => [pressed && { opacity: 0.7 }]}
              >
                <View style={styles.driverIcon}>
                  {photoURL ? (
                    <Image source={{ uri: photoURL }} style={styles.driverPhoto} />
                  ) : (
                    <MaterialCommunityIcons
                      name="account"
                      size={25}
                      color={COLORS.primary}
                    />
                  )}
                </View>
              </Pressable>
            </View>
          </FadeSlideIn>

          {/* ─── Status panel ─── */}
          <FadeSlideIn delay={100}>
            <View
              style={[
                styles.statusPanel,
                online && styles.statusPanelOnline,
              ]}
            >
              <View style={styles.statusCopy}>
                <View style={styles.statusTitleRow}>
                  {online && <PulseDot color={COLORS.success} />}
                  <AppText variant="heading" style={styles.statusTitle}>
                    {activeTrip
                      ? "Trip active"
                      : online
                        ? "You are online"
                        : "You are offline"}
                  </AppText>
                </View>
                <AppText variant="caption" style={styles.statusText}>
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
          </FadeSlideIn>

          {/* ─── Active trip card ─── */}
          {activeTrip && (
            <FadeSlideIn delay={150}>
              <View style={styles.activeTripCard}>
                <View style={styles.activeTripIcon}>
                  <MaterialCommunityIcons
                    name="bus"
                    size={24}
                    color={COLORS.primary}
                  />
                </View>
                <View style={styles.activeTripCopy}>
                  <AppText variant="heading" style={styles.activeTripTitle}>
                    Active trip
                  </AppText>
                  <AppText variant="caption" style={styles.activeTripSubtitle}>
                    Started{" "}
                    {activeTrip.startTime
                      ? new Date(activeTrip.startTime).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "just now"}
                  </AppText>
                </View>
                <PrimaryButton
                  title={ending ? "..." : "End"}
                  onPress={() => void handleEndTrip()}
                  disabled={ending}
                  style={styles.endTripBtn}
                />
              </View>
            </FadeSlideIn>
          )}

          {/* ─── Quick action tiles ─── */}
          <FadeSlideIn delay={200} style={{ marginBottom: SPACING.lg }}>
            <View style={styles.tilesGrid}>
              <Pressable
                style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
                onPress={() => router.push("/driver-map")}
              >
                <View style={[styles.tileIconWrap, { backgroundColor: COLORS.primary + "18" }]}>
                  <MaterialCommunityIcons
                    name="map"
                    size={22}
                    color={COLORS.primary}
                  />
                </View>
                <AppText variant="caption" style={styles.tileLabel}>
                  View map
                </AppText>
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
                onPress={() => router.push("/driver-account")}
              >
                <View style={[styles.tileIconWrap, { backgroundColor: COLORS.accent + "18" }]}>
                  <MaterialCommunityIcons
                    name="history"
                    size={22}
                    color={COLORS.accent}
                  />
                </View>
                <AppText variant="caption" style={styles.tileLabel}>
                  Trip history
                </AppText>
              </Pressable>
            </View>
          </FadeSlideIn>

          {/* ─── Routes ─── */}
          <FadeSlideIn delay={280}>
            <AppText variant="heading" style={styles.sectionTitle}>
              {activeTrip ? "Current route" : "Choose your route"}
            </AppText>
          </FadeSlideIn>

          <FadeSlideIn delay={320}>
            {loading ? (
              <ActivityIndicator
                color={COLORS.primary}
                style={{ marginVertical: SPACING.xl }}
              />
            ) : routes.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons
                  name="map-marker-off-outline"
                  size={38}
                  color={COLORS.textSecondary}
                />
                <AppText variant="body" style={styles.emptyText}>
                  No routes available yet.
                </AppText>
                <AppText variant="caption" style={styles.emptyHint}>
                  Contact an admin to add routes.
                </AppText>
              </View>
            ) : (
              <View style={styles.routeList}>
                {routes.map((route) => (
                  <Pressable
                    key={route.id}
                    style={[
                      styles.routeRow,
                      route.id === selectedRouteId && styles.selectedRoute,
                    ]}
                    onPress={() => setSelectedRouteId(route.id)}
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
                      <AppText variant="heading" style={styles.routeTitle}>
                        {route.origin}
                      </AppText>
                      <AppText variant="caption" style={styles.routeDest}>
                        → {route.destination}
                        {route.stops?.length ? ` (${route.stops.length} stops)` : ""}
                      </AppText>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </FadeSlideIn>

          {/* ─── Seat counter ─── */}
          {!activeTrip && (
            <FadeSlideIn delay={360}>
              <View style={styles.seatCounterCard}>
                <View style={styles.seatCounterLeft}>
                  <MaterialCommunityIcons name="seat" size={20} color={COLORS.primary} />
                  <AppText variant="heading" style={styles.seatCounterLabel}>Available seats</AppText>
                </View>
                <View style={styles.seatCounterControls}>
                  <Pressable
                    style={styles.seatBtn}
                    onPress={() => void handleUpdateSeats(seatCount - 1)}
                  >
                    <MaterialCommunityIcons name="minus" size={18} color={COLORS.primary} />
                  </Pressable>
                  <AppText variant="heading" style={styles.seatCountText}>{seatCount}</AppText>
                  <Pressable
                    style={styles.seatBtn}
                    onPress={() => void handleUpdateSeats(seatCount + 1)}
                  >
                    <MaterialCommunityIcons name="plus" size={18} color={COLORS.primary} />
                  </Pressable>
                </View>
              </View>
            </FadeSlideIn>
          )}

          {/* ─── Start trip button ─── */}
          <FadeSlideIn delay={380}>
            {!activeTrip && (
              <PrimaryButton
                title={starting ? "Starting..." : "Start trip"}
                onPress={() => void handleStartTrip()}
                disabled={starting || !selectedRouteId}
                style={styles.startButton}
              />
            )}
          </FadeSlideIn>

          {/* ─── Footer links ─── */}
          <FadeSlideIn delay={420}>
            <Pressable
              style={styles.footerLink}
              onPress={() => router.push("/admin-routes")}
            >
              <MaterialCommunityIcons
                name="shield-crown-outline"
                size={16}
                color={COLORS.textSecondary}
              />
              <AppText variant="caption" style={styles.footerLinkText}>
                Admin dashboard
              </AppText>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.signOutBtn,
                pressed && { opacity: 0.5 },
              ]}
              onPress={() => void handleSignOut()}
            >
              <MaterialCommunityIcons
                name="logout"
                size={18}
                color={COLORS.danger}
              />
              <AppText variant="caption" style={styles.signOutText}>
                Sign out
              </AppText>
            </Pressable>
          </FadeSlideIn>
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
    paddingBottom: SPACING.xxl + 40,
  },

  /* ── Header ── */
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: SPACING.xl,
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: SPACING.xs,
  },
  title: { color: COLORS.navy, fontSize: 30, lineHeight: 38 },
  driverName: {
    color: COLORS.navy,
    fontSize: 22,
    lineHeight: 28,
    marginTop: SPACING.xs,
  },
  driverIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
    overflow: "hidden",
  },
  driverPhoto: { width: 52, height: 52, borderRadius: 18 },

  /* ── Status panel ── */
  statusPanel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.md,
    borderRadius: 20,
    backgroundColor: COLORS.navy,
    marginBottom: SPACING.xl,
  },
  statusPanelOnline: {
    backgroundColor: "#0D3320",
  },
  statusCopy: { flex: 1, paddingRight: SPACING.md },
  statusTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  statusTitle: { color: COLORS.secondary, fontSize: 18, lineHeight: 24 },
  statusText: {
    color: "rgba(255,255,255,0.72)",
    marginTop: 3,
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

  /* ── Active trip ── */
  activeTripCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: 18,
    backgroundColor: COLORS.blueWash,
    borderWidth: 1,
    borderColor: COLORS.primary,
    marginBottom: SPACING.xl,
  },
  activeTripIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
    marginRight: SPACING.md,
  },
  activeTripCopy: { flex: 1 },
  activeTripTitle: { color: COLORS.navy, fontSize: 16 },
  activeTripSubtitle: { color: COLORS.textSecondary, marginTop: 2 },
  endTripBtn: {
    height: 38,
    borderRadius: 19,
    paddingHorizontal: SPACING.md,
  },

  /* ── Tiles ── */
  tilesGrid: {
    flexDirection: "row",
    gap: SPACING.sm,
  },
  tile: {
    flex: 1,
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: 18,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
  },
  tilePressed: { transform: [{ scale: 0.95 }], opacity: 0.85 },
  tileIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm,
  },
  tileLabel: { color: COLORS.navy, fontWeight: "700", fontSize: 13 },

  /* ── Routes ── */
  sectionTitle: {
    color: COLORS.navy,
    fontSize: 19,
    lineHeight: 25,
    marginBottom: SPACING.md,
  },
  routeList: { gap: SPACING.sm },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: 18,
    backgroundColor: "rgba(232,243,255,0.72)",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  selectedRoute: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.blueWash,
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
  routeTitle: { color: COLORS.navy, fontSize: 16, lineHeight: 21 },
  routeDest: { color: COLORS.textSecondary, marginTop: 2 },

  emptyState: { alignItems: "center", padding: SPACING.xl },
  emptyText: {
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: SPACING.sm,
  },
  emptyHint: {
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: SPACING.xs,
    opacity: 0.6,
    fontSize: 12,
  },

  startButton: { marginTop: SPACING.lg, marginBottom: SPACING.md },

  /* ── Seat counter ── */
  seatCounterCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.md,
    borderRadius: 18,
    backgroundColor: COLORS.blueWash,
    borderWidth: 1,
    borderColor: COLORS.veryLightBlue,
    marginBottom: SPACING.sm,
  },
  seatCounterLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  seatCounterLabel: {
    color: COLORS.navy,
    fontSize: 15,
  },
  seatCounterControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  seatBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.veryLightBlue,
  },
  seatCountText: {
    color: COLORS.navy,
    fontSize: 24,
    minWidth: 36,
    textAlign: "center",
  },

  /* ── Footer ── */
  footerLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
  },
  footerLinkText: { color: COLORS.textSecondary },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginTop: SPACING.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.danger + "30",
  },
  signOutText: { color: COLORS.danger, fontWeight: "600" },
});
