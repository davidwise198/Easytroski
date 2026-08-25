import React, { useState } from "react";
import { StyleSheet, View, ScrollView, Pressable } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import GlassInput from "../../src/components/ui/GlassInput";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import SectionTitle from "../../src/components/ui/SectionTitle";

import { SPACING, COLORS } from "../../src/theme";
import { resetPassword } from "../../src/services/auth";
import { getFriendlyError } from "../../src/utils/firebaseErrors";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleReset = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) return;

    setLoading(true);
    try {
      await resetPassword(trimmedEmail);
      setSent(true);
    } catch (error) {
      alert(getFriendlyError(error));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AppBackground>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.primary} />
          </Pressable>

          <View style={styles.centerContent}>
            <View style={styles.successIcon}>
              <MaterialCommunityIcons name="email-check-outline" size={52} color={COLORS.primary} />
            </View>

            <SectionTitle style={styles.successTitle}>Check your email</SectionTitle>

            <AppText variant="body" style={styles.successText}>
              We sent a password reset link to{"\n"}
              <AppText variant="body" style={styles.emailHighlight}>{email.trim().toLowerCase()}</AppText>
            </AppText>

            <AppText variant="caption" style={styles.hint}>
              Didn't receive the email? Check your spam folder or try again.
            </AppText>

            <PrimaryButton
              title="Back to Sign In"
              onPress={() => router.replace("/auth/login")}
              style={styles.signInButton}
            />

            <Pressable onPress={() => { setSent(false); setEmail(""); }}>
              <AppText variant="body" style={styles.retryLink}>
                Try a different email
              </AppText>
            </Pressable>
          </View>
        </ScrollView>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.primary} />
        </Pressable>

        <View style={styles.centerContent}>
          <View style={styles.iconContainer}>
            <MaterialCommunityIcons name="lock-reset" size={64} color={COLORS.primary} />
          </View>

          <SectionTitle>Reset Password</SectionTitle>

          <AppText variant="body" style={styles.subtitle}>
            Enter your email address and we'll send you a link to reset your password.
          </AppText>

          <View style={styles.form}>
            <GlassInput
              placeholder="Email address"
              icon="email"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
            />

            <PrimaryButton
              title={loading ? "Sending..." : "Send Reset Link"}
              onPress={handleReset}
              disabled={loading || !email.trim()}
              variant="primary"
            />
          </View>
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
  centerContent: {
    alignItems: "center",
  },
  iconContainer: {
    marginBottom: SPACING.lg,
  },
  subtitle: {
    marginTop: SPACING.sm,
    opacity: 0.8,
    textAlign: "center",
    maxWidth: 280,
    marginBottom: SPACING.xl,
  },
  form: {
    width: "100%",
    marginTop: SPACING.md,
  },
  // Success state
  successTitle: {
    marginTop: SPACING.lg,
  },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.veryLightBlue,
    marginBottom: SPACING.md,
  },
  successText: {
    marginTop: SPACING.md,
    textAlign: "center",
    opacity: 0.85,
    lineHeight: 24,
  },
  emailHighlight: {
    color: COLORS.primary,
    fontWeight: "600",
  },
  hint: {
    marginTop: SPACING.sm,
    opacity: 0.6,
    textAlign: "center",
  },
  signInButton: {
    marginTop: SPACING.xl,
    minWidth: 200,
  },
  retryLink: {
    color: COLORS.primary,
    fontWeight: "600",
    marginTop: SPACING.lg,
  },
});
