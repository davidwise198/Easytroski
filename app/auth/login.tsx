import React, { useState } from "react";
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import GlassInput from "../../src/components/ui/GlassInput";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import SectionTitle from "../../src/components/ui/SectionTitle";

import { SPACING, COLORS } from "../../src/theme";
import { loginUser } from "../../src/services/auth";
import { getFriendlyError } from "../../src/utils/firebaseErrors";
import { showToast } from "../../src/utils/toast";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      const loggedInUser = await loginUser(email.trim().toLowerCase(), password);
      // The login screen isn't wrapped with AuthGate, so navigate based on role.
      // Unverified password accounts are gated exactly like on registration.
      const isPasswordAccount = loggedInUser.providerData.some(
        (p) => p?.providerId === "password"
      );
      if (isPasswordAccount && loggedInUser.emailVerified === false) {
        router.replace("/auth/verify-email");
        return;
      }
      const { getUserRole } = await import("../../src/services/auth");
      const role = await getUserRole(loggedInUser);
      if (!role) {
        router.replace("/auth/role-selection");
      } else if (role === "admin") {
        router.replace("/admin-routes");
      } else if (role === "driver") {
        router.replace("/driver-home");
      } else if (role === "mate") {
        router.replace("/mate-home");
      } else {
        router.replace("/home");
      }
    } catch (error) {
      console.error("Login error:", error);
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
});
