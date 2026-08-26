import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import RoleActionCard from "../../src/components/ui/RoleActionCard";
import SectionTitle from "../../src/components/ui/SectionTitle";
import { auth } from "../../src/services/firebase";
import { updateUserProfile } from "../../src/services/auth";
import { SPACING } from "../../src/theme";
import { getFriendlyError } from "../../src/utils/firebaseErrors";
import { showToast } from "../../src/utils/toast";

export default function RoleSelectionScreen() {
  const [loading, setLoading] = useState(false);

  const handleRoleSelection = async (role: "passenger" | "driver") => {
    const user = auth.currentUser;

    if (!user) {
      showToast("error", "Not signed in", "No user is currently signed in.");
      router.replace("/auth/login");
      return;
    }

    setLoading(true);
    try {
      await updateUserProfile(user.uid, { role });
      // Navigate directly — this screen isn't wrapped with AuthGate.
      if (role === "driver") {
        router.replace("/auth/driver-onboarding");
      } else {
        router.replace("/passenger-dashboard");
      }
    } catch (error) {
      console.error("Role selection error:", error);
      showToast("error", "Role update failed", getFriendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppBackground>
      <View style={styles.container}>
        <View style={styles.header}>
          <SectionTitle>Choose Your Role</SectionTitle>
          <AppText variant="body" style={styles.subtitle}>
            How will you be using EasyTroski?
          </AppText>
        </View>

        <View style={styles.actions}>
          <RoleActionCard
            icon="account-group"
            title="I'm a Passenger"
            description="Book rides and travel with ease"
            delay={150}
            onPress={() => !loading && void handleRoleSelection("passenger")}
          />
          <RoleActionCard
            icon="steering"
            title="I'm a Driver"
            description="Manage trips and accept passengers"
            tone="blue"
            delay={250}
            onPress={() => !loading && void handleRoleSelection("driver")}
          />
        </View>
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
  header: {
    alignItems: "center",
    marginBottom: SPACING.xxl,
  },
  subtitle: {
    marginTop: SPACING.md,
    textAlign: "center",
    opacity: 0.8,
  },
  actions: {
    gap: SPACING.md,
  },
});
