import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import SectionTitle from "../../src/components/ui/SectionTitle";
import { useAuth } from "../../src/contexts/AuthContext";
import { COLORS, SPACING } from "../../src/theme";
import { reloadUser, resendEmailVerification } from "../../src/services/auth";
import { showToast } from "../../src/utils/toast";

// ---------------------------------------------------------------------------
// Verify email — shown to password-registered users who haven't confirmed
// their mailbox. A dummy address can never receive this mail, so it can
// never get past this screen. Google accounts skip it (Google verifies).
// ---------------------------------------------------------------------------

export default function VerifyEmailScreen() {
  const { user, userRole } = useAuth();
  const [resending, setResending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // 60-second resend cooldown ticker
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      if (mounted.current) setCooldown((s) => s - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleResend = async () => {
    setResending(true);
    try {
      await resendEmailVerification();
      showToast(
        "success",
        "Email sent",
        "We sent a new verification link to your inbox."
      );
      setCooldown(60);
    } catch {
      showToast(
        "warning",
        "Couldn't send",
        "Please wait a minute before requesting another email."
      );
    } finally {
      if (mounted.current) setResending(false);
    }
  };

  const handleCheckVerified = async () => {
    setChecking(true);
    try {
      const refreshed = await reloadUser();
      if (refreshed?.emailVerified) {
        showToast("success", "Email verified", "Welcome aboard!");
        const role = userRole;
        router.replace(
          role === "driver"
            ? "/driver-home"
            : role === "admin"
              ? "/admin-routes"
              : "/home"
        );
      } else {
        showToast(
          "info",
          "Not verified yet",
          "Tap the link in your inbox first, then press continue."
        );
      }
    } catch {
      showToast("error", "Check failed", "Please try again.");
    } finally {
      if (mounted.current) setChecking(false);
    }
  };

  const handleSignOutNote = () => {
    router.replace("/auth/login");
  };

  return (
    <AppBackground>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons
            name="email-check-outline"
            size={64}
            color={COLORS.primary}
          />
        </View>

        <SectionTitle>Verify your email</SectionTitle>

        <AppText variant="body" style={styles.subtitle}>
          We sent a verification link to
        </AppText>
        <AppText variant="body" style={styles.emailText} numberOfLines={1}>
          {user?.email || "your inbox"}
        </AppText>
        <AppText variant="body" style={[styles.subtitle, styles.gap]}>
          Open it and tap the link to activate your account. Check your spam
          folder if it hasn't arrived in a few minutes.
        </AppText>

        <View style={styles.actions}>
          <PrimaryButton
            title={checking ? "Checking..." : "I've verified — continue"}
            onPress={() => void handleCheckVerified()}
            disabled={checking}
            variant="primary"
          />

          <Pressable
            style={({ pressed }) => [
              styles.resendRow,
              pressed && styles.pressed,
              cooldown > 0 && styles.resendDisabled,
            ]}
            onPress={() => void handleResend()}
            disabled={resending || cooldown > 0}
          >
            {resending ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <MaterialCommunityIcons
                name="send-outline"
                size={18}
                color={COLORS.primary}
              />
            )}
            <AppText variant="body" style={styles.resendText}>
              {cooldown > 0
                ? `Resend email in ${cooldown}s`
                : "Resend verification email"}
            </AppText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.pressed, styles.signOutRow]}
            onPress={handleSignOutNote}
          >
            <AppText variant="caption" style={styles.signOutText}>
              Use a different account
            </AppText>
          </Pressable>
        </View>
      </View>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    justifyContent: "center",
    paddingBottom: SPACING.xxl,
  },
  iconWrap: {
    alignItems: "center",
    marginBottom: SPACING.lg,
  },
  subtitle: {
    textAlign: "center",
    opacity: 0.8,
    marginTop: SPACING.xs,
  },
  gap: {
    marginTop: SPACING.md,
  },
  emailText: {
    textAlign: "center",
    color: COLORS.primary,
    fontWeight: "700",
    marginTop: SPACING.xs,
  },
  actions: {
    marginTop: SPACING.xl,
  },
  resendRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginTop: SPACING.sm,
  },
  resendDisabled: {
    opacity: 0.5,
  },
  resendText: {
    color: COLORS.primary,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.6,
  },
  signOutRow: {
    alignItems: "center",
    paddingVertical: SPACING.sm,
    marginTop: SPACING.md,
  },
  signOutText: {
    color: COLORS.textSecondary,
    textDecorationLine: "underline",
  },
});
