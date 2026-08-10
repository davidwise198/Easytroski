import React from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import AppBackground from "../src/components/ui/AppBackground";
import AppCard from "../src/components/ui/AppCard";
import AppText from "../src/components/ui/AppText";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import SectionTitle from "../src/components/ui/SectionTitle";

import { COLORS, SPACING } from "../src/theme";
import { logoutUser } from "../src/services/auth";

export default function DriverDashboardScreen() {
  const handleLogout = async () => {
    await logoutUser();
    router.replace("/auth/login");
  };

  return (
    <AppBackground>
      <View style={styles.container}>
        <SectionTitle>Driver Dashboard</SectionTitle>

        <AppCard style={styles.card}>
          <AppText variant="heading" style={styles.title}>
            Ready to drive
          </AppText>
          <AppText variant="body" style={styles.description}>
            Your driver account is ready. You can manage trips and routes from here.
          </AppText>
        </AppCard>

        <PrimaryButton title="Sign Out" onPress={handleLogout} variant="outline" />
      </View>
    </AppBackground>
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
    marginBottom: SPACING.xl,
    alignItems: "center",
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
