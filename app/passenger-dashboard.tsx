import React, { useEffect, useRef, useState } from "react";
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

import AppBackground from "../src/components/ui/AppBackground";
import AppText from "../src/components/ui/AppText";
import AuthGate from "../src/components/AuthGate";
import { useAuth } from "../src/contexts/AuthContext";
import { useThemeColors } from "../src/contexts/ThemeContext";
import { getUserProfile, getPhotoURL } from "../src/services/profile";
import { COLORS, SPACING } from "../src/theme";
import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Animated wrapper for staggered entrance
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

// EaseOutBack for a subtle bounce
const OutBack = Easing.out(Easing.bezier(0.34, 1.56, 0.64, 1));

// ---------------------------------------------------------------------------
// Quick action tile
// ---------------------------------------------------------------------------

function ActionTile({
  icon,
  label,
  color,
  onPress,
  delay,
}: {
  icon: string;
  label: string;
  color: string;
  onPress: () => void;
  delay: number;
}) {
  const { colors: c } = useThemeColors();
  const tileBg = useMemo(() => ({ backgroundColor: c.glass, borderColor: c.glassBorder }), [c]);
  const tileText = useMemo(() => ({ color: c.text }), [c]);
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: 1,
      delay,
      friction: 7,
      tension: 60,
      useNativeDriver: true,
    }).start();
  }, [delay, scale]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [[styles.tile, tileBg], pressed && styles.tilePressed]}
    >
      <Animated.View
        style={[
          styles.tileIconWrap,
          { backgroundColor: color + "18" },
          { transform: [{ scale }] },
        ]}
      >
        <MaterialCommunityIcons name={icon as any} size={24} color={color} />
      </Animated.View>
      <AppText variant="caption" style={[styles.tileLabel, tileText]}>
        {label}
      </AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main passenger dashboard
// ---------------------------------------------------------------------------

export default function PassengerDashboardScreen() {
  const { user, signOut } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(() => ({
    name: { color: colors.text },
    greeting: { color: colors.textSecondary },
    tileLabel: { color: colors.text },
    stepsTitle: { color: colors.text },
    stepText: { color: colors.textSecondary },
    tile: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
    stepsCard: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
    avatar: { backgroundColor: colors.blueWash },
  }), [colors]);
  const [refreshing, setRefreshing] = useState(false);
  const [profile, setProfile] = useState<Record<string, any> | null>(null);

  // Pulse animation for avatar
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (user?.uid) {
      getUserProfile(user.uid).then(setProfile).catch(() => {});
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
      await getUserProfile(user.uid).then(setProfile).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 600));
    setRefreshing(false);
  };

  const handleLogout = async () => {
    await signOut();
  };

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const displayName =
    profile?.name || user?.displayName || user?.email?.split("@")[0] || "there";
  const photoURL = getPhotoURL(user, profile);

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

              <Pressable
                onPress={() => router.push("/profile")}
                style={({ pressed }) => [pressed && { transform: [{ scale: 0.9 }] }]}
              >
                <Animated.View style={[[styles.avatar, ds.avatar], { transform: [{ scale: pulse }] }]}>
                  {photoURL ? (
                    <Image source={{ uri: photoURL }} style={styles.avatarImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <MaterialCommunityIcons
                        name="account"
                        size={28}
                        color={COLORS.primary}
                      />
                    </View>
                  )}
                </Animated.View>
              </Pressable>
            </View>
          </FadeSlideIn>

          {/* ─── Quick action grid ─── */}
          <FadeSlideIn delay={100} style={styles.tilesSection}>
            <View style={styles.tilesGrid}>
              <ActionTile
                icon="map-search"
                label="Find route"
                color={COLORS.primary}
                onPress={() => router.push("/routes")}
                delay={150}
              />
              <ActionTile
                icon="map-marker-radius"
                label="Live map"
                color={COLORS.success}
                onPress={() => router.push("/passenger-map")}
                delay={220}
              />
              <ActionTile
                icon="book-check"
                label="My trips"
                color={COLORS.accent}
                onPress={() => router.push("/passenger-account")}
                delay={290}
              />
              <ActionTile
                icon="account-cog"
                label="Profile"
                color={COLORS.navy}
                onPress={() => router.push("/profile")}
                delay={360}
              />
            </View>
          </FadeSlideIn>

          {/* ─── Primary CTA ─── */}
          <FadeSlideIn delay={250}>
            <Pressable
              style={({ pressed }) => [styles.ctaCard, pressed && styles.ctaPressed]}
              onPress={() => router.push("/routes")}
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

          {/* ─── How it works ─── */}
          <FadeSlideIn delay={350}>
            <View style={[styles.stepsCard, ds.stepsCard]}>
              <AppText variant="heading" style={[styles.stepsTitle, ds.stepsTitle]}>
                How it works
              </AppText>
              {[
                { icon: "map-marker-path", text: "Pick a route" },
                { icon: "bus", text: "Find an active driver" },
                { icon: "seat", text: "Book your seat" },
              ].map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={styles.stepIcon}>
                    <MaterialCommunityIcons
                      name={step.icon as any}
                      size={16}
                      color={COLORS.primary}
                    />
                  </View>
                  <AppText variant="caption" style={[styles.stepText, ds.stepText]}>
                    {step.text}
                  </AppText>
                </View>
              ))}
            </View>
          </FadeSlideIn>

          {/* ─── Sign out ─── */}
          <FadeSlideIn delay={460}>
            <Pressable
              style={({ pressed }) => [
                styles.signOutRow,
                pressed && styles.signOutPressed,
              ]}
              onPress={() => void handleLogout()}
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
  scroll: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 60,
    paddingBottom: SPACING.xxl + 40,
  },

  /* ── Header ── */
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: SPACING.xl,
  },
  headerLeft: { flex: 1 },
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
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: COLORS.blueWash,
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 20,
  },
  avatarPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  /* ── Quick action tiles ── */
  tilesSection: {
    marginBottom: SPACING.lg,
  },
  tilesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  tile: {
    width: "48%",
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: 18,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
  },
  tilePressed: {
    transform: [{ scale: 0.95 }],
    opacity: 0.85,
  },
  tileIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm,
  },
  tileLabel: {
    color: COLORS.navy,
    fontWeight: "700",
    fontSize: 13,
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

  /* ── How it works ── */
  stepsCard: {
    padding: SPACING.md,
    borderRadius: 18,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    marginBottom: SPACING.xl,
  },
  stepsTitle: {
    color: COLORS.navy,
    fontSize: 16,
    marginBottom: SPACING.md,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  stepText: {
    color: COLORS.textSecondary,
  },

  /* ── Admin link ── */
  adminLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
  },
  adminLinkText: { color: COLORS.textSecondary },

  /* ── Sign out ── */
  signOutRow: {
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
  signOutPressed: { opacity: 0.5 },
  signOutText: { color: COLORS.danger, fontWeight: "600" },
});
