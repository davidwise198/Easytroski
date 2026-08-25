import React from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import AppBackground from "../src/components/ui/AppBackground";
import AppCard from "../src/components/ui/AppCard";
import AppText from "../src/components/ui/AppText";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import SectionTitle from "../src/components/ui/SectionTitle";
import AuthGate from "../src/components/AuthGate";
import { useAuth } from "../src/contexts/AuthContext";

import { COLORS, SPACING } from "../src/theme";

export default function PassengerDashboardScreen() {
  const { signOut } = useAuth();

  const handleLogout = async () => {
    await signOut();
    // AuthGate will redirect to login once auth state clears
  };

  return (
    <AuthGate allowedRoles={["passenger"]}>
      <AppBackground>
        <View style={styles.container}>
          <SectionTitle>Passenger Dashboard</SectionTitle>

          <AppCard style={styles.card}>
            <AppText variant="heading" style={styles.title}>
              Welcome back
            </AppText>
            <AppText variant="body" style={styles.description}>
              Your passenger account is ready. You can browse routes and book rides here.
            </AppText>
          </AppCard>

          <PrimaryButton
            title="Browse active routes"
            onPress={() => router.push("/routes")}
            variant="primary"
            style={styles.browseButton}
          />

          <PrimaryButton title="Sign Out" onPress={handleLogout} variant="outline" />
        </View>
      </AppBackground>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xxl,
  },
  card: {
    marginBottom: SPACING.md,
    alignItems: "center",
  },
  browseButton: {
    marginBottom: SPACING.md,
  },
  title: {
    marginBottom: SPACING.sm,
    color: COLORS.primary,
  },
  description: {
    textAlign: "center",
    lineHeight: 24,
    opacity: 0.85,
  },
});
