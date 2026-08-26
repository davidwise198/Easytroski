import React, { useEffect, useRef } from "react";
import { Animated, ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import AppBackground from "../src/components/ui/AppBackground";
import AnimatedBrandMark from "../src/components/ui/AnimatedBrandMark";
import AppText from "../src/components/ui/AppText";
import FeatureChip from "../src/components/ui/FeatureChip";
import RoleActionCard from "../src/components/ui/RoleActionCard";
import { COLORS, SPACING } from "../src/theme";
import { useAuth } from "../src/contexts/AuthContext";

export default function Index() {
  const insets = useSafeAreaInsets();
  const { user, userRole, loading } = useAuth();

  // Redirect logged-in users to their dashboard
  useEffect(() => {
    if (!loading && user && userRole) {
      if (userRole === "admin") {
        router.replace("/admin-routes");
      } else if (userRole === "driver") {
        router.replace("/driver-dashboard");
      } else {
        router.replace("/passenger-dashboard");
      }
    }
  }, [loading, user, userRole]);
  const entrance = useRef(new Animated.Value(0)).current;
  const illustrationFloat = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 650,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(illustrationFloat, {
          toValue: 1,
          duration: 2200,
          useNativeDriver: true,
        }),
        Animated.timing(illustrationFloat, {
          toValue: 0,
          duration: 2200,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [entrance, illustrationFloat]);

  const contentTransform = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });

  return (
    <AppBackground>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          { paddingTop: Math.max(insets.top, SPACING.md) + SPACING.sm },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: entrance, transform: [{ translateY: contentTransform }] }}>
          <View style={styles.brandRow}>
            <AnimatedBrandMark size={40} style={styles.logoMark} />
            <AppText variant="heading" style={styles.brandName}>EasyTroski</AppText>
            <View style={styles.statusDot} />
          </View>

          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <AppText variant="caption" style={styles.eyebrow}>MOVE WITH CONFIDENCE</AppText>
              <AppText variant="title" style={styles.heroTitle}>
                Your next ride,
                <AppText variant="title" style={styles.heroAccent}> made easy.</AppText>
              </AppText>
              <AppText variant="body" style={styles.subtitle}>
                Reliable transport for every journey across Ghana.
              </AppText>
            </View>

            <Animated.View
              style={[
                styles.illustration,
                {
                  transform: [
                    {
                      translateY: illustrationFloat.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, -7],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.sun} />
              <View style={styles.roadCurve} />
              <View style={styles.vehicleBody}>
                <View style={styles.window} />
                <View style={styles.window} />
                <View style={styles.wheel} />
                <View style={[styles.wheel, styles.wheelRight]} />
              </View>
              <View style={styles.locationPin}>
                <MaterialCommunityIcons name="map-marker" size={17} color={COLORS.secondary} />
              </View>
            </Animated.View>
          </View>

          <View style={styles.featureRow}>
            <FeatureChip icon="crosshairs-gps" label={"Real-time\nTracking"} delay={220} />
            <FeatureChip icon="seat" label={"Book\nSeats"} delay={300} />
            <FeatureChip icon="shield-check" label={"Trusted\nDrivers"} delay={380} />
          </View>

          <View style={styles.actionsHeader}>
            <View>
              <AppText variant="heading" style={styles.actionsTitle}>How are you riding?</AppText>
              <AppText variant="caption" style={styles.actionsSubtitle}>Choose your EasyTroski experience</AppText>
            </View>
            <MaterialCommunityIcons name="gesture-tap" size={24} color={COLORS.accent} />
          </View>

          <View style={styles.actions}>
            <RoleActionCard
              icon="account-group"
              title="Continue as Passenger"
              description="Book your next ride instantly."
              delay={470}
              onPress={() => router.push("/auth/register?role=passenger")}
            />
            <RoleActionCard
              icon="steering"
              title="Continue as Driver"
              description="Manage trips and accept passengers."
              tone="blue"
              delay={560}
              onPress={() => router.push("/auth/register?role=driver")}
            />
          </View>

          <AppText variant="caption" style={styles.loginLink} onPress={() => router.push("/auth/login")}>
            Already have an account? <AppText variant="caption" style={styles.loginAccent}>Sign in</AppText>
          </AppText>
        </Animated.View>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  brandRow: { flexDirection: "row", alignItems: "center", marginBottom: SPACING.xl },
  logoMark: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.primary, marginRight: SPACING.sm },
  brandName: { color: COLORS.navy, fontSize: 20, lineHeight: 26 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.accent, marginLeft: 6 },
  hero: { minHeight: 270, flexDirection: "row", marginBottom: SPACING.lg },
  heroCopy: { flex: 1, paddingTop: SPACING.lg, zIndex: 1 },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: SPACING.sm },
  heroTitle: { color: COLORS.navy, fontSize: 34, lineHeight: 39, maxWidth: 250 },
  heroAccent: { color: COLORS.primary, fontSize: 34, lineHeight: 39 },
  subtitle: { color: COLORS.textSecondary, maxWidth: 220, marginTop: SPACING.md },
  illustration: { width: 146, height: 220, marginTop: SPACING.md, marginLeft: -12 },
  sun: { position: "absolute", width: 118, height: 118, borderRadius: 59, right: -10, top: 0, backgroundColor: "#CFE5FF" },
  roadCurve: { position: "absolute", width: 210, height: 96, borderRadius: 100, borderTopWidth: 12, borderColor: COLORS.primary, right: -60, bottom: 22, transform: [{ rotate: "-12deg" }] },
  vehicleBody: { position: "absolute", width: 104, height: 58, borderRadius: 20, backgroundColor: COLORS.primary, right: 7, top: 91, transform: [{ rotate: "-9deg" }], shadowColor: COLORS.navy, shadowOpacity: 0.18, shadowRadius: 12, elevation: 5 },
  window: { width: 30, height: 21, borderRadius: 8, backgroundColor: "#BBD9F5", marginTop: 8, marginLeft: 12, borderWidth: 2, borderColor: COLORS.secondary },
  wheel: { position: "absolute", width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.navy, bottom: -8, left: 16, borderWidth: 4, borderColor: COLORS.secondary },
  wheelRight: { left: 69 },
  locationPin: { position: "absolute", top: 35, right: 22, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.accent, borderWidth: 3, borderColor: COLORS.secondary },
  featureRow: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.xl },
  actionsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: SPACING.md },
  actionsTitle: { color: COLORS.navy, fontSize: 20, lineHeight: 26 },
  actionsSubtitle: { color: COLORS.textSecondary, marginTop: 2 },
  actions: { gap: SPACING.md },
  loginLink: { textAlign: "center", color: COLORS.textSecondary, marginTop: SPACING.xl },
  loginAccent: { color: COLORS.primary, fontWeight: "800" },
});