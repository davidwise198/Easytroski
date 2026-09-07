import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import AuthGate from "../../src/components/AuthGate";
import ThemeToggle from "../../src/components/ui/ThemeToggle";
import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import { getPhotoURL, getUserProfile } from "../../src/services/profile";
import { getPassengerBookings } from "../../src/services/transport";
import { COLORS, SPACING } from "../../src/theme";
import { Booking, BookingStatus } from "../../src/types/models";

// ---------------------------------------------------------------------------
// Animated wrapper for entrance
// ---------------------------------------------------------------------------

const OutBack = Easing.out(Easing.bezier(0.34, 1.56, 0.64, 1));

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
        easing: OutBack,
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

const ACTIVE_STATUSES: BookingStatus[] = ["pending", "confirmed", "picked_up"];

function bookingStatusLabel(status: BookingStatus): string {
  switch (status) {
    case "pending":
      return "Booking pending";
    case "confirmed":
      return "Driver confirmed — en route";
    case "picked_up":
      return "You're on board!";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

// ---------------------------------------------------------------------------
// Passenger home tab
// ---------------------------------------------------------------------------

export default function HomeScreen() {
  const { user } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(
    () => ({
      name: { color: colors.text },
      greeting: { color: colors.textSecondary },
      avatar: {
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.glassBorder,
      },
      contextCard: {
        backgroundColor: colors.glass,
        borderColor: colors.glassBorder,
      },
      contextTitle: { color: colors.text },
      contextText: { color: colors.textSecondary },
    }),
    [colors]
  );
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);

  // Pulse animation for avatar
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (user?.uid) {
      getUserProfile(user.uid).then(setProfile).catch(() => {});
      getPassengerBookings(user.uid).then(setBookings).catch(() => {});
    }

    // Subtle pulse loop on avatar
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.06,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnim.start();
    return () => pulseAnim.stop();
  }, [user?.uid, pulse]);

  const handleRefresh = async () => {
    setRefreshing(true);
    if (user?.uid) {
      await Promise.all([
        getUserProfile(user.uid).then(setProfile).catch(() => {}),
        getPassengerBookings(user.uid).then(setBookings).catch(() => {}),
      ]);
    }
    await new Promise((r) => setTimeout(r, 600));
    setRefreshing(false);
  };

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const displayName =
    profile?.name || user?.displayName || user?.email?.split("@")[0] || "there";
  const photoURL = getPhotoURL(user, profile);

  // Latest booking (newest first) drives the context card.
  const latestBooking = useMemo(() => {
    const sorted = [...bookings].sort((a, b) => {
      const ta = (a.createdAt as any)?.toMillis?.() ?? 0;
      const tb = (b.createdAt as any)?.toMillis?.() ?? 0;
      return tb - ta;
    });
    return sorted[0] ?? null;
  }, [bookings]);
  const activeBooking =
    latestBooking && ACTIVE_STATUSES.includes(latestBooking.status)
      ? latestBooking
      : null;

  const contextTitle = activeBooking
    ? bookingStatusLabel(activeBooking.status)
    : bookings.length > 0
      ? "No active ride right now"
      : "Ready for your first ride?";
  const contextText = activeBooking
    ? `You have ${activeBooking.seats} seat${activeBooking.seats > 1 ? "s" : ""} on this trip.`
    : bookings.length > 0
      ? "View your trip history anytime."
      : "Find a route and book your seat in minutes.";
  const contextAction = activeBooking
    ? "Track"
    : bookings.length > 0
      ? "View trips"
      : "Book now";
  const contextIcon = activeBooking
    ? "map-marker-path"
    : bookings.length > 0
      ? "history"
      : "seat";
  const contextRoute = activeBooking
    ? "/map"
    : bookings.length > 0
      ? "/trips"
      : "/routes";

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
          {/* ─── Header with pulse avatar ─── */}
          <FadeSlideIn delay={0}>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <AppText variant="caption" style={styles.eyebrow}>
                  PASSENGER
                </AppText>
                <AppText variant="title" style={[styles.greeting, ds.greeting]}>
                  {greeting},
                </AppText>
                <AppText variant="heading" style={[styles.name, ds.name]}>
                  {displayName} 👋
                </AppText>
              </View>

              <View style={styles.headerRight}>
                <ThemeToggle />
                <Pressable
                  onPress={() => router.push("/profile")}
                  style={({ pressed }) => [pressed && { transform: [{ scale: 0.9 }] }]}
                >
                  <Animated.View
                    style={[[styles.avatar, ds.avatar], { transform: [{ scale: pulse }] }]}
                  >
                    {photoURL ? (
                      <Image
                        source={{ uri: photoURL }}
                        style={styles.avatarImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.avatarPlaceholder}>
                        <MaterialCommunityIcons
                          name="account"
                          size={28}
                          color={colors.primary}
                        />
                      </View>
                    )}
                  </Animated.View>
                </Pressable>
              </View>
            </View>
          </FadeSlideIn>

          {/* ─── Primary CTA ─── */}
          <FadeSlideIn delay={120}>
            <Pressable
              style={({ pressed }) => [styles.ctaCard, pressed && styles.ctaPressed]}
              onPress={() => router.navigate("/routes")}
            >
              <View style={styles.ctaIconWrap}>
                <MaterialCommunityIcons name="bus" size={28} color={COLORS.white} />
              </View>
              <View style={styles.ctaCopy}>
                <AppText variant="heading" style={styles.ctaTitle}>
                  Find your ride
                </AppText>
                <AppText variant="caption" style={styles.ctaSubtitle}>
                  Browse available trotro routes and book a seat
                </AppText>
              </View>
              <MaterialCommunityIcons
                name="arrow-right"
                size={22}
                color={COLORS.white}
              />
            </Pressable>
          </FadeSlideIn>

          {/* ─── Context card: reflects where the user is in their journey ─── */}
          <FadeSlideIn delay={220}>
            <View style={[styles.contextCard, ds.contextCard]}>
              <View style={styles.contextIconWrap}>
                <MaterialCommunityIcons
                  name={contextIcon as any}
                  size={22}
                  color={activeBooking ? COLORS.accent : COLORS.primary}
                />
              </View>
              <View style={styles.contextCopy}>
                <AppText variant="caption" style={[styles.contextTitle, ds.contextTitle]}>
                  {contextTitle}
                </AppText>
                <AppText variant="caption" style={[styles.contextText, ds.contextText]}>
                  {contextText}
                </AppText>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.contextBtn,
                  activeBooking && styles.contextBtnAccent,
                  pressed && styles.contextBtnPressed,
                ]}
                onPress={() => router.navigate(contextRoute)}
              >
                <AppText variant="caption" style={styles.contextBtnText}>
                  {contextAction}
                </AppText>
              </Pressable>
            </View>
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
  scroll: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 60,
    paddingBottom: SPACING.xxl,
  },

  /* ── Header ── */
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: SPACING.xl,
  },
  headerLeft: { flex: 1 },
  headerRight: {
    alignItems: "flex-end",
    gap: 8,
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: SPACING.xs,
  },
  greeting: {
    color: COLORS.textSecondary,
    fontSize: 18,
    lineHeight: 24,
    marginBottom: 2,
  },
  name: {
    color: COLORS.navy,
    fontSize: 28,
    lineHeight: 34,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: COLORS.blueWash,
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  /* ── CTA card ── */
  ctaCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.lg,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    marginBottom: SPACING.lg,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  ctaPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
  ctaIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    marginRight: SPACING.md,
  },
  ctaCopy: { flex: 1 },
  ctaTitle: {
    color: COLORS.white,
    fontSize: 17,
    marginBottom: 2,
  },
  ctaSubtitle: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 12,
    lineHeight: 17,
  },

  /* ── Context card ── */
  contextCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: 18,
    borderWidth: 1,
  },
  contextIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
    marginRight: SPACING.md,
  },
  contextCopy: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  contextTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  contextText: {
    fontSize: 12,
    marginTop: 1,
  },
  contextBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: COLORS.primary,
  },
  contextBtnAccent: {
    backgroundColor: COLORS.accent,
  },
  contextBtnPressed: {
    opacity: 0.8,
  },
  contextBtnText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 12,
  },
});