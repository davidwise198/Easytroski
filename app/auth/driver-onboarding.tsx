import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
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
import { normaliseGhanaPhone } from "../../src/utils/money";
import type { MomoProvider } from "../../src/types/models";

// Paystack's Ghana mobile money provider codes, in the order a Ghanaian
// driver is most likely to use them.
const MOMO_NETWORKS: Array<{ code: MomoProvider; label: string; icon: string }> = [
  { code: "mtn", label: "MTN", icon: "cellphone" },
  { code: "vod", label: "Telecel", icon: "cellphone-arrow-down" },
  { code: "atl", label: "AirtelTigo", icon: "cellphone-cog" },
];

export default function DriverOnboardingScreen() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [driverLicenseNumber, setDriverLicenseNumber] = useState("");
  const [vehicleRegistrationNumber, setVehicleRegistrationNumber] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleSeatingCapacity, setVehicleSeatingCapacity] = useState("");
  const [preferredRoute, setPreferredRoute] = useState("");
  const [momoProvider, setMomoProvider] = useState<MomoProvider>("mtn");
  const [momoNumber, setMomoNumber] = useState("");
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

    const payoutNumber = normaliseGhanaPhone(momoNumber);
    if (!payoutNumber) {
      showToast(
        "warning",
        "Mobile Money number needed",
        "Enter the Mobile Money number that should receive your earnings, e.g. 0244123456."
      );
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
        momoProvider,
        momoNumber: payoutNumber,
      });

      // Update phone if provided
      if (phoneNumber.trim()) {
        const { updateUserProfile } = await import("../../src/services/auth");
        await updateUserProfile(user.uid, { phoneNumber: phoneNumber.trim() });
      }
      router.replace("/driver-home");
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

          {/* ─── Payout details ─── */}
          <AppText variant="caption" style={styles.sectionLabel}>
            PAYOUT DETAILS
          </AppText>

          <AppText variant="body" style={styles.payoutHint}>
            Your fares (minus the EasyTroski commission) are paid into this Mobile
            Money wallet. You can withdraw once a day, from 8:00 PM.
          </AppText>

          <View style={styles.networkRow}>
            {MOMO_NETWORKS.map((network) => {
              const selected = momoProvider === network.code;
              return (
                <Pressable
                  key={network.code}
                  onPress={() => setMomoProvider(network.code)}
                  style={[
                    styles.networkButton,
                    selected && styles.networkButtonSelected,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <MaterialCommunityIcons
                    name={network.icon as any}
                    size={18}
                    color={selected ? "#FFFFFF" : COLORS.textSecondary}
                  />
                  <AppText
                    variant="caption"
                    style={[styles.networkLabel, selected && styles.networkLabelSelected]}
                  >
                    {network.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <GlassInput
            placeholder="Mobile Money number (e.g. 0244123456)"
            icon="wallet"
            keyboardType="phone-pad"
            value={momoNumber}
            onChangeText={setMomoNumber}
          />

          <PrimaryButton
            title={loading ? "Setting up..." : "Complete Setup"}
            onPress={handleComplete}
            disabled={
              loading ||
              !driverLicenseNumber.trim() ||
              !vehicleRegistrationNumber.trim() ||
              !vehicleColor.trim() ||
              !vehicleSeatingCapacity.trim() ||
              !momoNumber.trim()
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

  payoutHint: {
    textAlign: "center",
    opacity: 0.75,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },

  networkRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },

  networkButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
  },

  networkButtonSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },

  networkLabel: {
    fontWeight: "600",
  },

  networkLabelSelected: {
    color: "#FFFFFF",
  },
});
