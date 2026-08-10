import React, { useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Switch,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import GlassInput from "../../src/components/ui/GlassInput";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import SectionTitle from "../../src/components/ui/SectionTitle";

import { SPACING, COLORS } from "../../src/theme";
import { getUserRole, registerUser } from "../../src/services/auth";

type UserRole = "passenger" | "driver";

export default function RegisterScreen() {
  const params = useLocalSearchParams<{ role?: string }>();
  const userRole: UserRole = params.role === "driver" ? "driver" : "passenger";

  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [driverLicenseNumber, setDriverLicenseNumber] = useState("");
  const [vehicleRegistrationNumber, setVehicleRegistrationNumber] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleSeatingCapacity, setVehicleSeatingCapacity] = useState("");
  const [preferredRoute, setPreferredRoute] = useState("");
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!fullName.trim()) {
      alert("Please enter your full name");
      return;
    }

    if (!phoneNumber.trim()) {
      alert("Please enter your phone number");
      return;
    }

    if (!email.trim()) {
      alert("Please enter your email address");
      return;
    }

    if (!password) {
      alert("Please enter a password");
      return;
    }

    if (password !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }

    if (userRole === "driver") {
      if (
        !driverLicenseNumber.trim() ||
        !vehicleRegistrationNumber.trim() ||
        !vehicleColor.trim() ||
        !vehicleSeatingCapacity.trim() ||
        !preferredRoute.trim()
      ) {
        alert("Please complete all driver details");
        return;
      }
    }

    if (!agreeToTerms) {
      alert("Please accept the terms to continue");
      return;
    }

    setLoading(true);
    try {
      const registeredUser = await registerUser(email.trim().toLowerCase(), password, {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phoneNumber: phoneNumber.trim(),
        role: userRole,
        driverLicenseNumber: driverLicenseNumber.trim(),
        vehicleRegistrationNumber: vehicleRegistrationNumber.trim(),
        vehicleColor: vehicleColor.trim(),
        vehicleSeatingCapacity: vehicleSeatingCapacity.trim(),
        preferredRoute: preferredRoute.trim(),
      });

      const role = await getUserRole(registeredUser);
      router.replace(role === "driver" ? "/driver-dashboard" : "/passenger-dashboard");
    } catch (error) {
      console.error("Register error:", error);
      alert("Registration failed. Please try again.");
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
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={24}
            color={COLORS.primary}
          />
        </Pressable>

        <View style={styles.headerSection}>
          <View style={styles.iconContainer}>
            <MaterialCommunityIcons
              name="account-plus"
              size={64}
              color={COLORS.primary}
            />
          </View>

          <SectionTitle>
            {userRole === "driver" ? "Driver Registration" : "Passenger Registration"}
          </SectionTitle>

          <AppText
            variant="body"
            style={styles.subtitle}
          >
            {userRole === "driver"
              ? "Create your driver account to start offering rides"
              : "Create your passenger account to book rides"}
          </AppText>
        </View>

        <View style={styles.formContent}>

          <GlassInput
            placeholder="Full name"
            icon="account"
            value={fullName}
            onChangeText={setFullName}
          />

          <GlassInput
            placeholder="Phone number"
            icon="phone"
            keyboardType="phone-pad"
            value={phoneNumber}
            onChangeText={setPhoneNumber}
          />

          <GlassInput
            placeholder="Email address"
            icon="email"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <GlassInput
            placeholder="Password"
            icon="lock"
            secureTextEntry
            showPasswordToggle
            value={password}
            onChangeText={setPassword}
          />

          <GlassInput
            placeholder="Confirm password"
            icon="lock-check"
            secureTextEntry
            showPasswordToggle
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          {userRole === "driver" && (
            <View style={styles.driverFields}>
              <GlassInput
                placeholder="Driver licence number"
                icon="card-account-details"
                value={driverLicenseNumber}
                onChangeText={setDriverLicenseNumber}
              />

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
                placeholder="Preferred route"
                icon="map-marker-path"
                value={preferredRoute}
                onChangeText={setPreferredRoute}
              />
            </View>
          )}

          <View style={styles.termsContainer}>
            <Switch
              value={agreeToTerms}
              onValueChange={setAgreeToTerms}
              trackColor={{
                false: COLORS.textSecondary + "40",
                true: COLORS.primary + "60",
              }}
              thumbColor={agreeToTerms ? COLORS.primary : COLORS.textSecondary}
            />
            <AppText
              variant="caption"
              style={styles.termsText}
            >
              I agree to Terms of Service and Privacy Policy
            </AppText>
          </View>

          <PrimaryButton
            title="Create Account"
            onPress={handleRegister}
            disabled={
              loading ||
              !fullName.trim() ||
              !phoneNumber.trim() ||
              !email.trim() ||
              !password ||
              !confirmPassword ||
              !agreeToTerms ||
              (userRole === "driver" &&
                (!driverLicenseNumber.trim() ||
                  !vehicleRegistrationNumber.trim() ||
                  !vehicleColor.trim() ||
                  !vehicleSeatingCapacity.trim() ||
                  !preferredRoute.trim()))
            }
            variant="primary"
          />
        </View>

        <View style={styles.loginSection}>
          <AppText
            variant="body"
            style={styles.loginText}
          >
            Already have an account?{" "}
            <AppText
              variant="body"
              style={styles.loginLink}
              onPress={() => router.push("/auth/login")}
            >
              Sign in
            </AppText>
          </AppText>
        </View>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },

  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: SPACING.lg,
  },

  headerSection: {
    alignItems: "center",
    marginBottom: SPACING.lg,
  },

  iconContainer: {
    marginBottom: SPACING.lg,
  },

  subtitle: {
    marginTop: SPACING.sm,
    opacity: 0.8,
    textAlign: "center",
  },

  formContent: {
    marginBottom: SPACING.xxl,
  },

  sectionLabel: {
    textAlign: "center",
    opacity: 0.7,
    marginBottom: SPACING.md,
  },

  driverFields: {
    marginBottom: SPACING.sm,
  },

  termsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    marginBottom: SPACING.lg,
    paddingVertical: SPACING.sm,
  },

  termsText: {
    flex: 1,
    opacity: 0.8,
  },

  loginSection: {
    alignItems: "center",
  },

  loginText: {
    textAlign: "center",
    opacity: 0.8,
  },

  loginLink: {
    color: COLORS.primary,
    fontWeight: "600",
  },
});