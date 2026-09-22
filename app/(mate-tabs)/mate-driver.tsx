import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import AuthGate from "../../src/components/AuthGate";
import EmptyState from "../../src/components/ui/EmptyState";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import {
  ensureMyIds,
  fetchRoute,
  leaveDriver,
  subscribeDriver,
  subscribeMateActiveTrip,
  subscribeMateConnections,
  subscribeMateJoinRequests,
} from "../../src/services/mates";
import { PaymentsApiError, friendlyPaymentError } from "../../src/services/payments";
import { COLORS, SPACING } from "../../src/theme";
import type { Driver, MateConnection, MateJoinRequest, Route, Trip } from "../../src/types/models";
import { showToast } from "../../src/utils/toast";

/**
 * "My Driver" — the connection, not the trip.
 *
 * A connection outlives every trip: it says this mate may work with that
 * driver. Leaving is therefore a real decision, which is why it asks first and
 * why the backend refuses while a trip is still running.
 */
export default function MateDriverScreen() {
  const { user } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(
    () => ({
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      card: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      heroCard: { backgroundColor: colors.blueWash, borderColor: colors.veryLightBlue },
      iconWrap: { backgroundColor: colors.veryLightBlue },
    }),
    [colors]
  );

  const [connections, setConnections] = useState<MateConnection[]>([]);
  const [requests, setRequests] = useState<MateJoinRequest[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [mateCode, setMateCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let cancelled = false;
    ensureMyIds()
      .then((ids) => {
        if (!cancelled) setMateCode(ids.mateCode ?? null);
      })
      .catch(() => {});

    const fail = () => {
      setError("We couldn't reach EasyTroski. Check your connection and try again.");
      setLoading(false);
    };
    const unsubConnections = subscribeMateConnections(
      uid,
      (rows) => {
        setConnections(rows);
        setLoading(false);
      },
      fail
    );
    const unsubRequests = subscribeMateJoinRequests(uid, setRequests, () => {});
    const unsubTrip = subscribeMateActiveTrip(uid, (active) => setTrip(active), () => {});
    return () => {
      cancelled = true;
      unsubConnections();
      unsubRequests();
      unsubTrip();
    };
  }, [user?.uid, reloadKey]);

  const activeConnection = connections.find((c) => c.status === "active") ?? null;
  const pendingRequests = requests.filter((r) => r.status === "pending");

  useEffect(() => {
    const driverId = activeConnection?.driverId;
    if (!driverId) {
      setDriver(null);
      setRoute(null);
      return;
    }
    const unsubDriver = subscribeDriver(driverId, setDriver, () => {});
    return () => unsubDriver();
  }, [activeConnection?.driverId]);

  // The driver's own route, so the mate knows what they normally run.
  useEffect(() => {
    const routeId = driver?.defaultRouteId || driver?.routeId;
    if (!routeId) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    fetchRoute(routeId)
      .then((r) => {
        if (!cancelled) setRoute(r);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [driver?.defaultRouteId, driver?.routeId]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  const doLeave = useCallback(async (driverId: string) => {
    setLeaving(true);
    try {
      await leaveDriver(driverId);
      showToast("success", "You left this driver", "You can join another driver any time.");
    } catch (err) {
      // The backend refuses to strand a running trip; say why in plain words.
      if (err instanceof PaymentsApiError && err.code === "mate_assigned_to_trip") {
        showToast(
          "warning",
          "Still on a trip",
          "You cannot leave this driver while you are assigned to an active trip."
        );
      } else {
        showToast("error", "Couldn't leave", friendlyPaymentError(err));
      }
    } finally {
      setLeaving(false);
    }
  }, []);

  const confirmLeave = useCallback(
    (driverId: string, driverName: string) => {
      Alert.alert(
        "Leave this driver?",
        `You will stop working with ${driverName}. Your history stays, and you can join another driver later.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Leave", style: "destructive", onPress: () => void doLeave(driverId) },
        ]
      );
    },
    [doLeave]
  );

  const workingTrip = trip && trip.driverId === activeConnection?.driverId ? trip : null;
  const routeLabel = route ? `${route.origin} → ${route.destination}` : null;

  return (
    <AuthGate allowedRoles={["mate"]}>
      <AppBackground>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <AppText variant="caption" style={[styles.eyebrow, ds.secondary]}>
            MY DRIVER
          </AppText>
          <AppText variant="heading" style={[styles.title, ds.text]}>
            Who you work with
          </AppText>
          <AppText variant="caption" style={[styles.subtitle, ds.secondary]}>
            A driver stays connected until you leave or they remove you.
          </AppText>

          {loading ? (
            <EmptyState busy icon="steering" title="Loading your driver..." />
          ) : error ? (
            <EmptyState
              tone="error"
              icon="wifi-off"
              title="Something went wrong"
              message={error}
              actionLabel="Try again"
              onAction={retry}
            />
          ) : activeConnection ? (
            <>
              {/* ─── Connected driver ─── */}
              <View style={[styles.heroCard, ds.heroCard]}>
                <View style={styles.heroTop}>
                  <View style={[styles.avatar, ds.iconWrap]}>
                    <MaterialCommunityIcons name="account" size={24} color={colors.primary} />
                  </View>
                  <View style={styles.heroCopy}>
                    <AppText variant="heading" style={[styles.driverName, ds.text]} numberOfLines={1}>
                      {activeConnection.driverName || driver?.name || "Your driver"}
                    </AppText>
                    <View style={styles.connectedRow}>
                      <View style={styles.connectedDot} />
                      <AppText variant="caption" style={styles.connectedText}>
                        Connected
                      </AppText>
                    </View>
                  </View>
                </View>

                {activeConnection.driverCode ? (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="badge-account-horizontal" size={15} color={colors.textSecondary} />
                    <AppText variant="caption" style={[styles.detailText, ds.secondary]}>
                      Driver ID: {activeConnection.driverCode}
                    </AppText>
                  </View>
                ) : null}

                <View style={styles.detailRow}>
                  <MaterialCommunityIcons name="bus" size={15} color={colors.textSecondary} />
                  <AppText variant="caption" style={[styles.detailText, ds.secondary]} numberOfLines={1}>
                    {driver?.vehicleRegistration || "Vehicle"}
                    {driver?.vehicleColor ? ` · ${driver.vehicleColor}` : ""}
                  </AppText>
                </View>

                {routeLabel ? (
                  <View style={styles.detailRow}>
                    <MaterialCommunityIcons name="map-marker-path" size={15} color={colors.textSecondary} />
                    <AppText variant="caption" style={[styles.detailText, ds.secondary]} numberOfLines={1}>
                      {routeLabel}
                    </AppText>
                  </View>
                ) : null}
              </View>

              {/* ─── Working now? ─── */}
              {workingTrip ? (
                <View style={[styles.card, ds.card]}>
                  <View style={styles.cardRow}>
                    <MaterialCommunityIcons name="bus-clock" size={20} color={COLORS.primary} />
                    <View style={styles.cardCopy}>
                      <AppText variant="heading" style={[styles.cardTitle, ds.text]}>
                        You are on this trip now
                      </AppText>
                      <AppText variant="caption" style={[styles.cardSub, ds.secondary]}>
                        Booking requests for it are yours to handle.
                      </AppText>
                    </View>
                  </View>
                  <PrimaryButton
                    title="View passengers"
                    onPress={() => router.navigate("/mate-passengers")}
                    style={styles.cardButton}
                  />
                </View>
              ) : (
                <AppText variant="caption" style={[styles.calmNote, ds.secondary]}>
                  You are not assigned to a trip right now. The driver assigns you when they start one.
                </AppText>
              )}

              <PrimaryButton
                title={leaving ? "Leaving..." : "Leave Driver"}
                variant="outline"
                onPress={() =>
                  confirmLeave(
                    activeConnection.driverId,
                    activeConnection.driverName || driver?.name || "this driver"
                  )
                }
                disabled={leaving}
                style={styles.leaveButton}
              />
            </>
          ) : (
            <>
              {/* ─── Not connected ─── */}
              <EmptyState
                icon="account-plus-outline"
                title="You are not connected to a driver"
                message="Ask the driver for their Driver ID (it looks like ET-DV-48291) and send them a request to join."
              />

              {pendingRequests.length > 0 ? (
                <View style={[styles.card, ds.card]}>
                  <View style={styles.cardRow}>
                    <MaterialCommunityIcons name="clock-outline" size={20} color={COLORS.accent} />
                    <View style={styles.cardCopy}>
                      <AppText variant="heading" style={[styles.cardTitle, ds.text]}>
                        Join request pending
                      </AppText>
                      <AppText variant="caption" style={[styles.cardSub, ds.secondary]}>
                        Waiting for{" "}
                        {pendingRequests.map((r) => r.driverName || "a driver").join(", ")} to approve
                        your request.
                      </AppText>
                    </View>
                  </View>
                </View>
              ) : null}

              <PrimaryButton
                title="Join a Driver"
                onPress={() => router.push("/mate-join")}
                style={styles.joinButton}
              />
            </>
          )}

          {mateCode ? (
            <View style={[styles.card, ds.card]}>
              <View style={styles.cardRow}>
                <MaterialCommunityIcons name="badge-account" size={20} color={colors.primary} />
                <View style={styles.cardCopy}>
                  <AppText variant="heading" style={[styles.cardTitle, ds.text]}>
                    Your Mate ID
                  </AppText>
                  <AppText variant="caption" style={[styles.cardSub, ds.secondary]}>
                    {mateCode} — this identifies you in EasyTroski records.
                  </AppText>
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </AppBackground>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: 120,
  },
  eyebrow: { fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  title: { fontSize: 21, lineHeight: 27, marginTop: 2 },
  subtitle: { marginTop: 2, marginBottom: SPACING.md },

  heroCard: {
    padding: SPACING.lg,
    borderRadius: 20,
    borderWidth: 1,
  },
  heroTop: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1 },
  driverName: { fontSize: 19, lineHeight: 25 },
  connectedRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  connectedDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  connectedText: { color: COLORS.success, fontWeight: "700", fontSize: 11 },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  detailText: { flex: 1, fontSize: 12 },

  card: {
    padding: SPACING.lg,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: SPACING.md,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  cardCopy: { flex: 1 },
  cardTitle: { fontSize: 16, lineHeight: 21 },
  cardSub: { marginTop: 2, lineHeight: 17 },
  cardButton: { marginTop: SPACING.md },
  leaveButton: { marginTop: SPACING.lg },
  joinButton: { marginTop: SPACING.lg },
  calmNote: { marginTop: SPACING.md, fontSize: 12, lineHeight: 17 },
});
