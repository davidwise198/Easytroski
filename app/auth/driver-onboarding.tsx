import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import GlassInput from "../../src/components/ui/GlassInput";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import SectionTitle from "../../src/components/ui/SectionTitle";
import { auth } from "../../src/services/firebase";
import { completeDriverProfile } from "../../src/services/auth";
import { SPACING, COLORS } from "../../src/theme";
import { getFriendlyError } from "../../src/utils/firebaseErrors";
import { showToast } from "../../src/utils/toast";

export default function DriverOnboardingScreen() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [driverLicenseNumber, setDriverLicenseNumber] = useState("");
  const [vehicleRegistrationNumber, setVehicleRegistrationNumber] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleSeatingCapacity, setVehicleSeatingCapacity] = useState("");
  const [preferredRoute, setPreferredRoute] = useState("");
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    const user = auth.currentUser;

    if (!user) {
      showToast("error", "Not signed in", "No user is currently signed in.");
      router.replace("/auth/login");
      return;
    }

    if (!driverLicenseNumber.trim()) {
      showToast("warning", "Licence required", "Please enter your driver's licence number.");
      return;
    }

    if (!vehicleRegistrationNumber.trim()) {
      showToast("warning", "Registration required", "Please enter your vehicle registration number.");
      return;
    }

    if (!vehicleColor.trim()) {
      showToast("warning", "Colour required", "Please enter your vehicle colour.");
      return;
    }

    if (!vehicleSeatingCapacity.trim() || isNaN(parseInt(vehicleSeatingCapacity, 10))) {
      showToast("warning", "Invalid capacity", "Please enter a valid seating capacity.");
      return;
    }

    setLoading(true);
    try {
      await completeDriverProfile(user.uid, {
        driverLicenseNumber: driverLicenseNumber.trim(),
        vehicleRegistrationNumber: vehicleRegistrationNumber.trim(),
        vehicleColor: vehicleColor.trim(),
        vehicleSeatingCapacity: parseInt(vehicleSeatingCapacity.trim(), 10),
        preferredRoute: preferredRoute.trim(),
      });

      // Update phone if provided
      if (phoneNumber.trim()) {
        const { updateUserProfile } = await import("../../src/services/auth");
        await updateUserProfile(user.uid, { phoneNumber: phoneNumber.trim() });
      }
      router.replace("/driver-dashboard");
    } catch (error) {
      console.error("Driver onboarding error:", error);
      showToast("error", "Setup failed", getFriendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppBackground>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerSection}>
          <View style={styles.iconContainer}>
            <MaterialCommunityIcons
              name="steering"
              size={64}
              color={COLORS.primary}
            />
          </View>

          <SectionTitle>Complete Driver Profile</SectionTitle>

          <AppText variant="body" style={styles.subtitle}>
            We need a few more details to set up your driver account
          </AppText>
        </View>

        <View style={styles.formContent}>
          <AppText variant="caption" style={styles.sectionLabel}>
            CONTACT INFORMATION (Optional)
          </AppText>

          <GlassInput
            placeholder="Phone number (optional)"
            icon="phone"
            keyboardType="phone-pad"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
          />

          <AppText variant="caption" style={styles.sectionLabel}>
            DRIVER DETAILS
          </AppText>

          <GlassInput
            placeholder="Driver licence number"
            icon="card-account-details"
            value={driverLicenseNumber}
            onChangeText={setDriverLicenseNumber}
          />

          <AppText variant="caption" style={styles.sectionLabel}>
            VEHICLE INFORMATION
          </AppText>

          <GlassInput
            placeholder="Vehicle registration number"
            icon="car"
            value={vehicleRegistrationNumber}
            onChangeText={setVehicleRegistrationNumber}
          />

          <GlassInput
            placeholder="Vehicle colour"
            icon="palette"
            value={vehicleColor}
            onChangeText={setVehicleColor}
          />

          <GlassInput
            placeholder="Vehicle seating capacity"
            icon="seat-passenger"
            keyboardType="numeric"
            value={vehicleSeatingCapacity}
            onChangeText={setVehicleSeatingCapacity}
          />

          <GlassInput
            placeholder="Preferred route (optional)"
            icon="map-marker-path"
            value={preferredRoute}
            onChangeText={setPreferredRoute}
          />

          <PrimaryButton
            title={loading ? "Setting up..." : "Complete Setup"}
            onPress={handleComplete}
            disabled={
              loading ||
              !driverLicenseNumber.trim() ||
              !vehicleRegistrationNumber.trim() ||
              !vehicleColor.trim() ||
              !vehicleSeatingCapacity.trim()
            }
            variant="primary"
          />
        </View>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xxl,
  },

  headerSection: {
    alignItems: "center",
    marginBottom: SPACING.xl,
  },

  iconContainer: {
    marginBottom: SPACING.lg,
  },

  subtitle: {
    marginTop: SPACING.sm,
    opacity: 0.8,
    textAlign: "center",
    maxWidth: 280,
  },

  formContent: {
    marginBottom: SPACING.lg,
  },

  sectionLabel: {
    textAlign: "center",
    opacity: 0.7,
    marginTop: SPACING.lg,
    marginBottom: SPACING.md,
  },
});
