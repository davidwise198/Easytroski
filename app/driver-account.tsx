import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../src/components/ui/AppBackground";
import AppText from "../src/components/ui/AppText";
import AccountRow from "../src/components/ui/AccountRow";
import StatCard from "../src/components/ui/StatCard";
import AuthGate from "../src/components/AuthGate";
import { useAuth } from "../src/contexts/AuthContext";
import { getDriverTrips, getDriverProfile } from "../src/services/transport";
import { COLORS, SPACING } from "../src/theme";
import { Trip, TripStatus } from "../src/types/models";

// ── Helpers ──

function tripStatusLabel(status: TripStatus): string {
  switch (status) {
    case "online":
      return "Online";
    case "boarding":
      return "Boarding";
    case "in_progress":
      return "On the way";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "scheduled":
      return "Scheduled";
    case "offline":
      return "Offline";
    default:
      return status;
  }
}

function tripStatusColor(status: TripStatus): string {
  switch (status) {
    case "online":
    case "boarding":
      return COLORS.success;
    case "in_progress":
      return COLORS.primary;
    case "scheduled":
      return COLORS.warning;
    case "completed":
      return "#8B5CF6";
    case "cancelled":
      return COLORS.danger;
    default:
      return COLORS.textSecondary;
  }
}

function tripStatusIcon(status: TripStatus): string {
  switch (status) {
    case "online":
      return "wifi";
    case "boarding":
      return "account-multiple-check";
    case "in_progress":
      return "bus";
    case "completed":
      return "check-circle";
    case "cancelled":
      return "close-circle";
    case "scheduled":
      return "calendar-clock";
    case "offline":
      return "wifi-off";
    default:
      return "help-circle-outline";
  }
}

function formatDate(date: Date | string | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(date: Date | string | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Screen ──

export default function DriverAccountScreen() {
  const { user, signOut } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [driverProfile, setDriverProfile] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const headerEntrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(headerEntrance, {
      toValue: 1,
      friction: 8,
      tension: 55,
      useNativeDriver: true,
    }).start();
  }, [headerEntrance]);

  const loadData = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const [tripsData, profileData] = await Promise.all([
        getDriverTrips(user.uid),
        getDriverProfile(user.uid),
      ]);
      setTrips(tripsData);
      if (profileData) {
        setDriverProfile(profileData.driver);
        setVehicle(profileData.vehicle);
      }
    } catch (error) {
      console.error("Failed to load driver data:", error);
    }
  }, [user?.uid]);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const handleSignOut = async () => {
    await signOut();
  };

  // Stats
  const totalTrips = trips.length;
  const completedTrips = trips.filter((t) => t.status === "completed").length;
  const activeTrips = trips.filter(
    (t) =>
      t.status === "online" || t.status === "boarding" || t.status === "in_progress"
  ).length;

  const displayName = user?.displayName || "Driver";
  const email = user?.email || "—";
  const phone = user?.phoneNumber || "—";
  const memberSince = user?.metadata?.creationTime
    ? formatDate(user.metadata.creationTime)
    : "—";

  return (
    <AuthGate allowedRoles={["driver"]}>
      <AppBackground>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* ── Back ── */}
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <MaterialCommunityIcons
              name="arrow-left"
              size={22}
              color={COLORS.primary}
            />
          </Pressable>

          {/* ── Profile header ── */}
          <Animated.View
            style={[
              styles.profileHeader,
              {
                opacity: headerEntrance,
                transform: [
                  {
                    translateY: headerEntrance.interpolate({
                      inputRange: [0, 1],
                      outputRange: [14, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.avatarLarge}>
              <MaterialCommunityIcons
                name="steering"
                size={40}
                color={COLORS.primary}
              />
            </View>
            <AppText variant="heading" style={styles.profileName}>
              {displayName}
            </AppText>
            <View style={styles.roleBadge}>
              <MaterialCommunityIcons
                name="steering"
                size={13}
                color={COLORS.white}
              />
              <AppText variant="caption" style={styles.roleText}>
                Driver
              </AppText>
            </View>
          </Animated.View>

          {/* ── Stats ── */}
          <View style={styles.statsRow}>
            <StatCard
              icon="map-clock-outline"
              value={totalTrips}
              label="Total trips"
              delay={100}
            />
            <StatCard
              icon="check-decagram"
              value={completedTrips}
              label="Completed"
              delay={200}
              color={COLORS.success}
            />
            <StatCard
              icon="bus"
              value={activeTrips}
              label="Active"
              delay={300}
              color={COLORS.accent}
            />
          </View>

          {/* ── Account details ── */}
          <View style={styles.section}>
            <AppText variant="caption" style={styles.sectionLabel}>
              ACCOUNT DETAILS
            </AppText>
            <View style={styles.detailCard}>
              <AccountRow icon="email-outline" label="Email" value={email} />
              <View style={styles.divider} />
              <AccountRow icon="phone-outline" label="Phone" value={phone} />
              <View style={styles.divider} />
              <AccountRow
                icon="calendar-clock"
                label="Member since"
                value={memberSince}
              />
              <View style={styles.divider} />
              <AccountRow
                icon="identifier"
                label="User ID"
                value={user?.uid?.slice(0, 12) + "..." || "—"}
              />
            </View>
          </View>

          {/* ── Vehicle details ── */}
          {vehicle && (
            <View style={styles.section}>
              <AppText variant="caption" style={styles.sectionLabel}>
                VEHICLE INFORMATION
              </AppText>
              <View style={styles.detailCard}>
                <AccountRow
                  icon="car"
                  label="Registration"
                  value={vehicle.numberPlate || "—"}
                />
                <View style={styles.divider} />
                <AccountRow
                  icon="palette"
                  label="Color"
                  value={vehicle.color || "—"}
                />
                <View style={styles.divider} />
                <AccountRow
                  icon="seat-passenger"
                  label="Seating capacity"
                  value={vehicle.capacity ? String(vehicle.capacity) : "—"}
                />
                <View style={styles.divider} />
                <AccountRow
                  icon="check-circle-outline"
                  label="Status"
                  value={vehicle.active ? "Active" : "Inactive"}
                />
              </View>
            </View>
          )}

          {/* ── Driver status ── */}
          {driverProfile && (
            <View style={styles.section}>
              <AppText variant="caption" style={styles.sectionLabel}>
                DRIVER STATUS
              </AppText>
              <View style={styles.detailCard}>
                <AccountRow
                  icon="wifi"
                  label="Availability"
                  value={driverProfile.online ? "Online" : "Offline"}
                />
                <View style={styles.divider} />
                <AccountRow
                  icon="seat-passenger"
                  label="Available seats"
                  value={
                    driverProfile.availableSeats != null
                      ? String(driverProfile.availableSeats)
                      : "—"
                  }
                />
                {driverProfile.rating != null && (
                  <>
                    <View style={styles.divider} />
                    <AccountRow
                      icon="star"
                      label="Rating"
                      value={`${driverProfile.rating} / 5`}
                    />
                  </>
                )}
              </View>
            </View>
          )}

          {/* ── Trip history ── */}
          <View style={styles.section}>
            <AppText variant="caption" style={styles.sectionLabel}>
              TRIP HISTORY
            </AppText>

            {loading ? (
              <ActivityIndicator
                color={COLORS.primary}
                style={styles.loader}
              />
            ) : trips.length === 0 ? (
              <View style={styles.emptyState}>
                <MaterialCommunityIcons
                  name="map-clock-outline"
                  size={36}
                  color={COLORS.textSecondary}
                />
                <AppText variant="body" style={styles.emptyText}>
                  No trips yet. Start a trip from the dashboard to see your history.
                </AppText>
              </View>
            ) : (
              <View style={styles.tripList}>
                {trips.map((trip) => (
                  <View key={trip.id} style={styles.tripCard}>
                    <View style={styles.tripLeft}>
                      <View
                        style={[
                          styles.tripStatusDot,
                          { backgroundColor: tripStatusColor(trip.status) },
                        ]}
                      />
                      <View style={styles.tripCopy}>
                        <AppText variant="heading" style={styles.tripRoute}>
                          {trip.origin || "Origin"} →{" "}
                          {trip.destination || "Destination"}
                        </AppText>
                        <AppText variant="caption" style={styles.tripDate}>
                          {formatDate(trip.startTime)}
                          {formatTime(trip.startTime)
                            ? ` at ${formatTime(trip.startTime)}`
                            : ""}
                        </AppText>
                      </View>
                    </View>
                    <View style={styles.tripRight}>
                      <View
                        style={[
                          styles.tripBadge,
                          {
                            backgroundColor:
                              tripStatusColor(trip.status) + "20",
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={tripStatusIcon(trip.status) as any}
                          size={12}
                          color={tripStatusColor(trip.status)}
                        />
                        <AppText
                          variant="caption"
                          style={[
                            styles.tripBadgeText,
                            { color: tripStatusColor(trip.status) },
                          ]}
                        >
                          {tripStatusLabel(trip.status)}
                        </AppText>
                      </View>
                      <AppText
                        variant="caption"
                        style={styles.tripDirection}
                      >
                        {trip.direction === "going" ? "Outbound" : "Return"}
                      </AppText>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* ── Sign out ── */}
          <Pressable
            style={({ pressed }) => [
              styles.signOutRow,
              pressed && styles.signOutPressed,
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
        </ScrollView>
      </AppBackground>
    </AuthGate>
  );
}

// ── Styles ──

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 56,
    paddingBottom: SPACING.xxl + 20,
  },

  // Back
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
    marginBottom: SPACING.lg,
  },

  // Profile header
  profileHeader: {
    alignItems: "center",
    marginBottom: SPACING.xl,
  },
  avatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
    marginBottom: SPACING.md,
  },
  profileName: {
    color: COLORS.navy,
    fontSize: 24,
    lineHeight: 30,
    marginBottom: SPACING.xs,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
  },
  roleText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 11,
  },

  // Stats
  statsRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },

  // Section
  section: {
    marginBottom: SPACING.xl,
  },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: SPACING.sm,
  },

  // Detail card
  detailCard: {
    borderRadius: 18,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    paddingHorizontal: SPACING.md,
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.veryLightBlue,
  },

  // Loader
  loader: {
    paddingVertical: SPACING.xl,
  },

  // Empty state
  emptyState: {
    alignItems: "center",
    paddingVertical: SPACING.xl,
    borderRadius: 18,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
  },
  emptyText: {
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },

  // Trip list
  tripList: {
    gap: SPACING.sm,
  },
  tripCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.md,
    borderRadius: 16,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
  },
  tripLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: SPACING.sm,
  },
  tripStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: SPACING.sm,
  },
  tripCopy: {
    flex: 1,
  },
  tripRoute: {
    color: COLORS.navy,
    fontSize: 14,
    lineHeight: 19,
  },
  tripDate: {
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  tripRight: {
    alignItems: "flex-end",
  },
  tripBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 4,
  },
  tripBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  tripDirection: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },

  // Sign out
  signOutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginTop: SPACING.sm,
  },
  signOutPressed: {
    opacity: 0.5,
  },
  signOutText: {
    color: COLORS.danger,
    fontWeight: "600",
  },
});
