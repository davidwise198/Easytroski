import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Switch,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import GlassInput from "../../src/components/ui/GlassInput";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import SectionTitle from "../../src/components/ui/SectionTitle";
import PasswordStrength from "../../src/components/ui/PasswordStrength";

import { SPACING, COLORS } from "../../src/theme";
import { registerUser, registerWithGoogle } from "../../src/services/auth";
import { getFriendlyError } from "../../src/utils/firebaseErrors";
import { showToast } from "../../src/utils/toast";

WebBrowser.maybeCompleteAuthSession();

type UserRole = "passenger" | "driver";

const getErrorCode = (error: unknown) => {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }

  return "unknown-error";
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }

  return "Unknown Google registration error";
};

const getFriendlyGoogleError = (errorCode: string) => {
  if (errorCode === "auth/operation-not-allowed") {
    return "Enable Google under Firebase Authentication sign-in providers.";
  }

  if (errorCode === "auth/invalid-credential") {
    return "Check that the Google OAuth client ID belongs to this Firebase project.";
  }

  if (errorCode === "permission-denied") {
    return "Check your Firestore rules allow signed-in users to create their profile.";
  }

  return "Please try again.";
};

type GoogleRegisterButtonProps = {
  disabled: boolean;
  onValidate: () => boolean;
  onComplete: (idToken: string, accessToken?: string) => void;
  onStart: () => void;
};

function GoogleRegisterButton({
  disabled,
  onValidate,
  onComplete,
  onStart,
}: GoogleRegisterButtonProps) {
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const nativeClientId = Platform.OS === "android" ? androidClientId : iosClientId;
  const isConfigured = Platform.OS === "web" ? Boolean(webClientId) : Boolean(nativeClientId);

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    androidClientId: androidClientId || undefined,
    iosClientId: iosClientId || undefined,
    webClientId: webClientId || undefined,
  });

  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.params?.id_token;
      if (idToken) {
        onComplete(idToken, response.params?.access_token);
      } else {
        showToast("error", "Google sign-in", "Google did not return an identity token. Please try again.");
      }
    } else if (response?.type === "error") {
      const code = response.errorCode || "oauth-error";
      let message = "Google sign-up failed. Please try again.";

      if (code === "auth/invalid-credential" || code === "auth/api-key-not-valid") {
        message =
          "Google sign-up failed. Please verify:\n\n" +
          "1. Add your Android/iOS OAuth client ID to the .env file\n" +
          "2. Register your app's SHA-1 fingerprint in Firebase Console > Project Settings > Android app\n" +
          "3. Make sure the OAuth client belongs to this Firebase project";
      } else if (code === "auth/operation-not-allowed") {
        message = "Google sign-up is not enabled. Enable it in Firebase Console > Authentication > Sign-in method.";
      }

      showToast("error", "Google sign-up failed", message);
    }
  }, [onComplete, response]);

  const handlePress = async () => {
    if (!isConfigured) {
      const platformName = Platform.OS === "android" ? "Android" : "iOS";
      showToast(
        "warning",
        `Google sign-up not configured for ${platformName}`,
        `Add EXPO_PUBLIC_GOOGLE_${platformName.toUpperCase()}_CLIENT_ID to your .env file.`
      );
      return;
    }

    if (!onValidate() || !request) {
      return;
    }

    try {
      onStart();
      await promptAsync();
    } catch (error) {
      console.error("Google prompt error:", error);
      showToast("error", "Google registration failed", "Please try again.");
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.googleButton, pressed && styles.googleButtonPressed, !isConfigured && styles.googleButtonDisabled]}
      onPress={handlePress}
      disabled={disabled}
    >
      <MaterialCommunityIcons name="google" size={20} color={COLORS.primary} />
      <AppText variant="body" style={styles.googleButtonText}>
        {isConfigured ? "Continue with Google" : "Google sign-up needs setup"}
      </AppText>
    </Pressable>
  );
}

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
      showToast("warning", "Missing name", "Please enter your full name.");
      return;
    }

    if (!phoneNumber.trim()) {
      showToast("warning", "Missing phone", "Please enter your phone number.");
      return;
    }

    if (!email.trim()) {
      showToast("warning", "Missing email", "Please enter your email address.");
      return;
    }

    if (!password) {
      showToast("warning", "Missing password", "Please enter a password.");
      return;
    }

    if (password !== confirmPassword) {
      showToast("error", "Passwords don't match", "Please make sure both passwords are the same.");
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
        showToast("warning", "Incomplete details", "Please complete all driver details.");
        return;
      }
    }

    if (!agreeToTerms) {
      showToast("warning", "Terms required", "Please accept the terms to continue.");
      return;
    }

    setLoading(true);
    try {
      await registerUser(email.trim().toLowerCase(), password, {
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
      // Manual driver signup already collected all vehicle details —
      // skip onboarding and go straight to the dashboard.
      if (userRole === "driver") {
        router.replace("/driver-dashboard");
      } else {
        router.replace("/passenger-dashboard");
      }
    } catch (error) {
      console.error("Register error:", error);
      showToast("error", "Registration failed", getFriendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const validateGoogleProfile = () => {
    if (!agreeToTerms) {
      showToast("warning", "Terms required", "Please accept the terms to continue.");
      return false;
    }

    return true;
  };

  const completeGoogleRegister = async (idToken: string, accessToken?: string) => {
    try {
      await registerWithGoogle(idToken, accessToken, {
        role: userRole,
      });
      // The register screen isn't wrapped with AuthGate, so we need to
      // navigate directly after Google sign-in completes.
      if (userRole === "driver") {
        router.replace("/auth/driver-onboarding");
      } else {
        router.replace("/passenger-dashboard");
      }
    } catch (error) {
      const errorCode = getErrorCode(error);
      const errorMessage = getErrorMessage(error);
      console.error("Google registration error:", { errorCode, errorMessage, error });
      showToast("error", "Registration failed", getFriendlyError(error));
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

          <AppText variant="caption" style={styles.infoText}>
            Fill in the details below or continue with Google for a faster sign-up
          </AppText>

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

          <GoogleRegisterButton
            disabled={loading}
            onValidate={validateGoogleProfile}
            onComplete={completeGoogleRegister}
            onStart={() => setLoading(true)}
          />

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <AppText variant="caption" style={styles.dividerLabel}>OR REGISTER WITH EMAIL</AppText>
            <View style={styles.divider} />
          </View>

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

          <PasswordStrength password={password} />

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
                  !vehicleSeatingCapacity.trim()))
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

  infoText: {
    textAlign: "center",
    opacity: 0.7,
    marginBottom: SPACING.lg,
    paddingHorizontal: SPACING.md,
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

  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },

  divider: {
    flex: 1,
    height: 1,
    backgroundColor: "rgba(16,42,67,0.14)",
  },

  dividerLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "800",
  },

  googleButton: {
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(23,105,224,0.28)",
    backgroundColor: "rgba(232,243,255,0.5)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },

  googleButtonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.85,
  },

  googleButtonDisabled: {
    opacity: 0.65,
  },

  googleButtonText: {
    color: COLORS.navy,
    fontSize: 15,
    fontWeight: "700",
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