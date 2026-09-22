import React, { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../src/components/ui/AppBackground";
import AppText from "../src/components/ui/AppText";
import AuthGate from "../src/components/AuthGate";
import EmptyState from "../src/components/ui/EmptyState";
import GlassInput from "../src/components/ui/GlassInput";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import { useThemeColors } from "../src/contexts/ThemeContext";
import {
  previewDriver,
  requestToJoinDriver,
  type DriverPreview,
} from "../src/services/mates";
import { PaymentsApiError, friendlyPaymentError } from "../src/services/payments";
import { COLORS, SPACING } from "../src/theme";
import { showToast } from "../src/utils/toast";

/**
 * Plain words for the things that actually go wrong here. The backend decides
 * everything; this only translates its answer.
 */
function joinErrorText(error: unknown): string {
  if (error instanceof PaymentsApiError) {
    switch (error.code) {
      case "invalid_driver_code":
        return "That doesn't look like a Driver ID. It should look like ET-DV-48291.";
      case "driver_not_found":
        return "Driver not found. Check the ID and try again.";
      case "already_connected":
        return "You are already connected to this driver.";
      case "too_many_requests":
        return error.message;
      default:
        return friendlyPaymentError(error);
    }
  }
  return friendlyPaymentError(error);
}

export default function MateJoinScreen() {
  const { colors } = useThemeColors();
  const [driverCode, setDriverCode] = useState("");
  const [preview, setPreview] = useState<DriverPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleLookup = useCallback(async () => {
    const value = driverCode.trim();
    if (!value) {
      setFormError("Enter the Driver ID you were given.");
      return;
    }
    setChecking(true);
    setFormError(null);
    try {
      const result = await previewDriver(value);
      setPreview(result);
      if (result.requestPending) setSent(true);
    } catch (error) {
      setFormError(joinErrorText(error));
    } finally {
      setChecking(false);
    }
  }, [driverCode]);

  const handleSend = useCallback(async () => {
    if (sending) return;
    setSending(true);
    setFormError(null);
    try {
      const result = await requestToJoinDriver(driverCode.trim());
      setSent(true);
      showToast(
        "success",
        result.alreadySent ? "Already sent" : "Request sent",
        `Waiting for ${result.driverName} to approve it.`
      );
    } catch (error) {
      setFormError(joinErrorText(error));
    } finally {
      setSending(false);
    }
  }, [driverCode, sending]);

  return (
    <AuthGate allowedRoles={["mate"]}>
      <AppBackground>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Pressable
              style={({ pressed }) => [styles.backBtn, { backgroundColor: colors.blueWash }, pressed && { opacity: 0.75 }]}
              onPress={() => router.back()}
            >
              <MaterialCommunityIcons name="arrow-left" size={22} color={colors.primary} />
            </Pressable>

            <AppText variant="caption" style={[styles.eyebrow, { color: colors.textSecondary }]}>
              MATE
            </AppText>
            <AppText variant="heading" style={[styles.title, { color: colors.text }]}>
              Join a Driver
            </AppText>
            <AppText variant="caption" style={[styles.subtitle, { color: colors.textSecondary }]}>
              Ask the driver for their Driver ID — it looks like ET-DV-48291.
            </AppText>

            {!sent && !preview ? (
              <>
                <GlassInput
                  placeholder="ET-DV-48291"
                  icon="badge-account-horizontal-outline"
                  value={driverCode}
                  onChangeText={(text) => {
                    setDriverCode(text.toUpperCase());
                    if (formError) setFormError(null);
                  }}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={14}
                  error={formError || undefined}
                />
                <PrimaryButton
                  title={checking ? "Checking..." : "Continue"}
                  onPress={() => void handleLookup()}
                  disabled={checking || !driverCode.trim()}
                />
              </>
            ) : null}

            {preview && !sent ? (
              <>
                <View
                  style={[
                    styles.previewCard,
                    { backgroundColor: colors.glass, borderColor: colors.glassBorder },
                  ]}
                >
                  <View style={styles.previewTop}>
                    <View style={[styles.avatar, { backgroundColor: colors.veryLightBlue }]}>
                      <MaterialCommunityIcons name="account" size={24} color={colors.primary} />
                    </View>
                    <View style={styles.previewCopy}>
                      <AppText variant="heading" style={[styles.previewName, { color: colors.text }]}>
                        {preview.driverName}
                      </AppText>
                      <AppText variant="caption" style={{ color: colors.textSecondary }}>
                        Driver
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="bus" size={15} color={colors.textSecondary} />
                    <AppText variant="caption" style={[styles.detailText, { color: colors.textSecondary }]}>
                      Vehicle: {preview.vehiclePlate || "Not provided"}
                    </AppText>
                  </View>
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="map-marker-path" size={15} color={colors.textSecondary} />
                    <AppText variant="caption" style={[styles.detailText, { color: colors.textSecondary }]}>
                      Route: {preview.routeLabel || "Not set yet"}
                    </AppText>
                  </View>
                </View>

                {preview.alreadyConnected ? (
                  <>
                    <AppText variant="caption" style={[styles.note, { color: colors.textSecondary }]}>
                      You are already connected to this driver.
                    </AppText>
                    <PrimaryButton
                      title="Go to My Driver"
                      onPress={() => router.replace("/mate-driver")}
                    />
                  </>
                ) : (
                  <>
                    <AppText variant="caption" style={[styles.note, { color: colors.textSecondary }]}>
                      Is this the right driver? They will need to approve your request.
                    </AppText>
                    <PrimaryButton
                      title={sending ? "Sending..." : "Send Join Request"}
                      onPress={() => void handleSend()}
                      disabled={sending}
                    />
                  </>
                )}

                {formError ? (
                  <AppText variant="caption" style={styles.errorText}>
                    {formError}
                  </AppText>
                ) : null}

                <PrimaryButton
                  title="Use a different ID"
                  variant="outline"
                  onPress={() => {
                    setPreview(null);
                    setFormError(null);
                  }}
                  style={styles.secondaryBtn}
                />
              </>
            ) : null}

            {sent ? (
              <>
                <EmptyState
                  icon="check-circle-outline"
                  title="Request Sent"
                  message="Your request is waiting for the driver to approve it. You'll see it here the moment they answer."
                />
                <PrimaryButton
                  title="Done"
                  onPress={() => router.replace("/mate-driver")}
                  style={styles.secondaryBtn}
                />
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </AppBackground>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xxl,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.lg,
  },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  title: { fontSize: 24, lineHeight: 30, marginTop: 2 },
  subtitle: { marginTop: SPACING.xs, marginBottom: SPACING.lg, lineHeight: 18 },

  previewCard: {
    padding: SPACING.lg,
    borderRadius: 20,
    borderWidth: 1,
  },
  previewTop: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  previewCopy: { flex: 1 },
  previewName: { fontSize: 19, lineHeight: 25 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginTop: SPACING.md },
  detailText: { flex: 1, fontSize: 12 },
  note: { marginTop: SPACING.md, marginBottom: SPACING.sm, lineHeight: 17 },
  errorText: { color: COLORS.danger, marginTop: SPACING.md, lineHeight: 17 },
  secondaryBtn: { marginTop: SPACING.md },
});
