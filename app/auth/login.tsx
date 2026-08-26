import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Platform,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import GlassInput from "../../src/components/ui/GlassInput";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import SectionTitle from "../../src/components/ui/SectionTitle";

import { SPACING, COLORS } from "../../src/theme";
import { loginUser, loginWithGoogle } from "../../src/services/auth";
import { getFriendlyError } from "../../src/utils/firebaseErrors";
import { showToast } from "../../src/utils/toast";

WebBrowser.maybeCompleteAuthSession();

type GoogleLoginButtonProps = {
  disabled: boolean;
  onComplete: (idToken: string, accessToken?: string) => void;
  onStart: () => void;
};

function GoogleLoginButton({
  disabled,
  onComplete,
  onStart,
}: GoogleLoginButtonProps) {
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
      let message = "Google sign-in failed. Please try again.";

      if (code === "auth/invalid-credential" || code === "auth/api-key-not-valid") {
        message =
          "Google sign-in failed. Please verify:\n\n" +
          "1. Add your Android/iOS OAuth client ID to the .env file\n" +
          "2. Register your app's SHA-1 fingerprint in Firebase Console > Project Settings > Android app\n" +
          "3. Make sure the OAuth client belongs to this Firebase project";
      } else if (code === "auth/operation-not-allowed") {
        message = "Google sign-in is not enabled. Enable it in Firebase Console > Authentication > Sign-in method.";
      }

      showToast("error", "Google sign-in failed", message);
    }
  }, [onComplete, response]);

  const handlePress = async () => {
    if (!isConfigured) {
      const platformName = Platform.OS === "android" ? "Android" : "iOS";
      showToast(
        "warning",
        `Google sign-in not configured for ${platformName}`,
        `Add EXPO_PUBLIC_GOOGLE_${platformName.toUpperCase()}_CLIENT_ID to your .env file.`
      );
      return;
    }

    if (!request) {
      return;
    }

    try {
      onStart();
      await promptAsync();
    } catch (error) {
      console.error("Google prompt error:", error);
      showToast("error", "Google sign-in failed", "Please try again.");
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
        {isConfigured ? "Continue with Google" : "Google sign-in needs setup"}
      </AppText>
    </Pressable>
  );
}

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const loggedInUser = await loginUser(email.trim().toLowerCase(), password);
      // The login screen isn't wrapped with AuthGate, so navigate based on role.
      const { getUserRole } = await import("../../src/services/auth");
      const role = await getUserRole(loggedInUser);
      if (!role) {
        router.replace("/auth/role-selection");
      } else if (role === "admin") {
        router.replace("/admin-routes");
      } else {
        router.replace(role === "driver" ? "/driver-dashboard" : "/passenger-dashboard");
      }
    } catch (error) {
      console.error("Login error:", error);
      showToast("error", "Login failed", getFriendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async (idToken: string, accessToken?: string) => {
    try {
      const loggedInUser = await loginWithGoogle(idToken, accessToken);
      // The login screen isn't wrapped with AuthGate, so navigate based on role.
      const { getUserRole } = await import("../../src/services/auth");
      const role = await getUserRole(loggedInUser);
      if (!role) {
        router.replace("/auth/role-selection");
      } else if (role === "admin") {
        router.replace("/admin-routes");
      } else {
        router.replace(role === "driver" ? "/driver-dashboard" : "/passenger-dashboard");
      }
    } catch (error) {
      console.error("Google login error:", error);
      showToast("error", "Login failed", getFriendlyError(error));
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
              name="account-circle"
              size={64}
              color={COLORS.primary}
            />
          </View>

          <SectionTitle>Welcome Back</SectionTitle>

          <AppText
            variant="body"
            style={styles.subtitle}
          >
            Sign in to your account to continue
          </AppText>
        </View>

        <View style={styles.formContent}>
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

          <Pressable style={styles.forgotPassword} onPress={() => router.push("/auth/forgot-password")}>
            <AppText
              variant="caption"
              style={styles.forgotPasswordText}
            >
              Forgot password?
            </AppText>
          </Pressable>

          <PrimaryButton
            title="Sign In"
            onPress={handleLogin}
            disabled={loading || !email || !password}
            variant="primary"
          />

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <AppText variant="caption" style={styles.dividerLabel}>OR</AppText>
            <View style={styles.divider} />
          </View>

          <GoogleLoginButton
            disabled={loading}
            onComplete={handleGoogleLogin}
            onStart={() => setLoading(true)}
          />
        </View>

        <View style={styles.signupSection}>
          <AppText
            variant="body"
            style={styles.signupText}
          >
            Don't have an account?{" "}
            <AppText
              variant="body"
              style={styles.signupLink}
              onPress={() => router.push("/auth/register?role=passenger")}
            >
              Sign up
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
    marginBottom: SPACING.xxl,
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

  forgotPassword: {
    alignItems: "flex-end",
    marginBottom: SPACING.lg,
  },

  forgotPasswordText: {
    color: COLORS.primary,
    opacity: 0.9,
  },

  signupSection: {
    alignItems: "center",
  },

  signupText: {
    textAlign: "center",
    opacity: 0.8,
  },

  signupLink: {
    color: COLORS.primary,
    fontWeight: "600",
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
});