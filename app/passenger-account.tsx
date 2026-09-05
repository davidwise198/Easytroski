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
import { useThemeColors } from "../src/contexts/ThemeContext";
import { useMemo } from "react";
import { getPassengerBookings } from "../src/services/transport";
import { COLORS, SPACING } from "../src/theme";
import { Booking, BookingStatus } from "../src/types/models";

// ── Helpers ──

function bookingStatusLabel(status: BookingStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Confirmed";
    case "picked_up":
      return "Picked up";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function bookingStatusColor(status: BookingStatus): string {
  switch (status) {
    case "pending":
      return COLORS.warning;
    case "confirmed":
      return COLORS.primary;
    case "picked_up":
      return "#8B5CF6";
    case "completed":
      return COLORS.success;
    case "cancelled":
      return COLORS.danger;
    default:
      return COLORS.textSecondary;
  }
}

function bookingStatusIcon(status: BookingStatus): string {
  switch (status) {
    case "pending":
      return "clock-outline";
    case "confirmed":
      return "check-circle-outline";
    case "picked_up":
      return "car";
    case "completed":
      return "check-circle";
    case "cancelled":
      return "close-circle";
    default:
      return "help-circle-outline";
  }
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Screen ──

export default function PassengerAccountScreen() {
  const { user, signOut } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(() => ({
    profileName: { color: colors.text },
    bookingRoute: { color: colors.text },
    bookingSeats: { color: colors.textSecondary },
    sectionLabel: { color: colors.textSecondary },
    emptyText: { color: colors.textSecondary },
    detailCard: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
    divider: { backgroundColor: colors.veryLightBlue },
    bookingCard: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
    emptyState: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
    backBtn: { backgroundColor: colors.blueWash },
    avatarLarge: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.glassBorder },
  }), [colors]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Entrance animation
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
      const data = await getPassengerBookings(user.uid);
      setBookings(data);
    } catch (error) {
      console.error("Failed to load bookings:", error);
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
  const totalBookings = bookings.length;
  const completedBookings = bookings.filter(
    (b) => b.status === "completed"
  ).length;
  const totalSeats = bookings.reduce((sum, b) => sum + (b.seats || 1), 0);

  const displayName = user?.displayName || "Passenger";
  const email = user?.email || "—";
  const phone = user?.phoneNumber || "—";
  const memberSince = user?.metadata?.creationTime
    ? formatDate(user.metadata.creationTime)
    : "—";

  return (
    <AuthGate allowedRoles={["passenger"]}>
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
          <Pressable style={[styles.backBtn, ds.backBtn]} onPress={() => router.back()}>
            <MaterialCommunityIcons
              name="arrow-left"
              size={22}
              color={colors.primary}
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
            <View style={[styles.avatarLarge, ds.avatarLarge]}>
              <MaterialCommunityIcons
                name="account"
                size={40}
                color={colors.primary}
              />
            </View>
            <AppText variant="heading" style={[styles.profileName, ds.profileName]}>
              {displayName}
            </AppText>
            <View style={styles.roleBadge}>
              <MaterialCommunityIcons
                name="account-group"
                size={13}
                color={COLORS.white}
              />
              <AppText variant="caption" style={styles.roleText}>
                Passenger
              </AppText>
            </View>
          </Animated.View>

          {/* ── Stats ── */}
          <View style={styles.statsRow}>
            <StatCard
              icon="book-check-outline"
              value={totalBookings}
              label="Bookings"
              delay={100}
            />
            <StatCard
              icon="check-decagram"
              value={completedBookings}
              label="Completed"
              delay={200}
              color={COLORS.success}
            />
            <StatCard
              icon="seat-passenger"
              value={totalSeats}
              label="Seats"
              delay={300}
              color={COLORS.accent}
            />
          </View>

          {/* ── Profile details ── */}
          <View style={styles.section}>
            <AppText variant="caption" style={[styles.sectionLabel, ds.sectionLabel]}>
              ACCOUNT DETAILS
            </AppText>
            <View style={[styles.detailCard, ds.detailCard]}>
              <AccountRow icon="email-outline" label="Email" value={email} />
              <View style={styles.divider} />
              <AccountRow
                icon="phone-outline"
                label="Phone"
                value={phone}
              />
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

          {/* ── Booking history ── */}
          <View style={styles.section}>
            <AppText variant="caption" style={[styles.sectionLabel, ds.sectionLabel]}>
              BOOKING HISTORY
            </AppText>

            {loading ? (
              <ActivityIndicator
                color={COLORS.primary}
                style={styles.loader}
              />
            ) : bookings.length === 0 ? (
              <View style={[styles.emptyState, ds.emptyState]}>
                <MaterialCommunityIcons
                  name="book-outline"
                  size={36}
                  color={COLORS.textSecondary}
                />
                <AppText variant="body" style={[styles.emptyText, ds.emptyText]}>
                  No bookings yet. Your trip history will appear here.
                </AppText>
              </View>
            ) : (
              <View style={styles.bookingList}>
                {bookings.map((booking) => (
                  <View key={booking.id} style={[styles.bookingCard, ds.bookingCard]}>
                    <View style={styles.bookingLeft}>
                      <View
                        style={[
                          styles.bookingStatusDot,
                          {
                            backgroundColor: bookingStatusColor(booking.status),
                          },
                        ]}
                      />
                      <View style={styles.bookingCopy}>
                        <AppText
                          variant="heading"
                          style={[styles.bookingRoute, ds.bookingRoute]}
                        >
                          {booking.pickupLocation?.address || "Pickup"} →{" "}
                          {booking.dropOffLocation?.address || "Drop-off"}
                        </AppText>
                        <AppText variant="caption" style={styles.bookingDate}>
                          {formatDate(booking.createdAt)}
                          {formatTime(booking.createdAt)
                            ? ` at ${formatTime(booking.createdAt)}`
                            : ""}
                        </AppText>
                      </View>
                    </View>
                    <View style={styles.bookingRight}>
                      <View
                        style={[
                          styles.bookingBadge,
                          {
                            backgroundColor:
                              bookingStatusColor(booking.status) + "20",
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={bookingStatusIcon(booking.status) as any}
                          size={12}
                          color={bookingStatusColor(booking.status)}
                        />
                        <AppText
                          variant="caption"
                          style={[
                            styles.bookingBadgeText,
                            { color: bookingStatusColor(booking.status) },
                          ]}
                        >
                          {bookingStatusLabel(booking.status)}
                        </AppText>
                      </View>
                      <AppText
                        variant="caption"
                        style={[styles.bookingSeats, ds.bookingSeats]}
                      >
                        {booking.seats || 1} seat{(booking.seats || 1) > 1 ? "s" : ""}
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

  // Booking list
  bookingList: {
    gap: SPACING.sm,
  },
  bookingCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.md,
    borderRadius: 16,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
  },
  bookingLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: SPACING.sm,
  },
  bookingStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: SPACING.sm,
  },
  bookingCopy: {
    flex: 1,
  },
  bookingRoute: {
    color: COLORS.navy,
    fontSize: 14,
    lineHeight: 19,
  },
  bookingDate: {
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  bookingRight: {
    alignItems: "flex-end",
  },
  bookingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginBottom: 4,
  },
  bookingBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  bookingSeats: {
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
