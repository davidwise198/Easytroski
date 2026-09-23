import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router, useLocalSearchParams } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import AuthGate from "../../src/components/AuthGate";
import { auth } from "../../src/services/firebase";
import { createBooking, getAvailableTrips, getRoute, NoSeatsError } from "../../src/services/transport";
import { COLORS, SPACING } from "../../src/theme";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import { useMemo } from "react";
import { Route } from "../../src/types/models";
import { showToast } from "../../src/utils/toast";
import { getFriendlyError } from "../../src/utils/firebaseErrors";

/**
 * Simplified booking screen — auto-books 1 seat from origin → destination.
 * No stop/pickup selection. The passenger just confirms the booking.
 */
export default function NewBookingScreen() {
  const { routeId } = useLocalSearchParams<{ routeId?: string }>();
  const [route, setRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookedId, setBookedId] = useState<string | null>(null);
  const { colors } = useThemeColors();
  const ds = useMemo(() => ({
    title: { color: colors.text },
    subtitle: { color: colors.textSecondary },
    routeTitle: { color: colors.text },
    routeStops: { color: colors.textSecondary },
    stateTitle: { color: colors.text },
    stateText: { color: colors.textSecondary },
    eyebrow: { color: colors.primary },
    routeCard: { backgroundColor: colors.veryLightBlue, borderColor: colors.veryLightBlue },
  }), [colors]);

  useEffect(() => {
    if (!routeId) {
      setError("This route could not be found.");
      setLoading(false);
      return;
    }

    getRoute(routeId)
      .then((r) => {
        setRoute(r);
        if (!r) setError("This route no longer exists.");
      })
      .catch(() => setError("We could not load this route. Please try again."))
      .finally(() => setLoading(false));
  }, [routeId]);

  const handleBook = useCallback(async () => {
    const passengerId = auth.currentUser?.uid;
    if (!passengerId || !route) return;

    setSubmitting(true);
    try {
      // A booking must target a live trip — the driver dashboard only lists
      // bookings by driverId, so bookings without a real driver are invisible
      // to drivers and get auto-cancelled as stale.
      const availableTrips = await getAvailableTrips(route.id);
      if (availableTrips.length === 0) {
        showToast(
          "error",
          "No driver available",
          "No driver is currently running this route. Please try again shortly."
        );
        setSubmitting(false);
        return;
      }

      // Book 1 seat on the first live trip for this route
      const trip = availableTrips[0];

      // The driver navigates to the pickup COORDINATES — a booking placed
      // with (0, 0) sends them into the Gulf of Guinea.
      let pickupLat = 0;
      let pickupLng = 0;
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          pickupLat = pos.coords.latitude;
          pickupLng = pos.coords.longitude;
        }
      } catch {
        // Fall through with (0, 0) — same as before rather than blocking the booking
      }

      const bookingId = await createBooking({
        passengerId,
        driverId: trip.driverId,
        routeId: route.id,
        pickupLocation: {
          latitude: pickupLat,
          longitude: pickupLng,
          address: route.origin,
        },
        dropOffLocation: {
          latitude: 0,
          longitude: 0,
          address: route.destination,
        },
        seats: 1,
      });
      setBookedId(bookingId);
      showToast("success", "Booking sent", `Your driver will confirm the ${route.origin} → ${route.destination} trip shortly.`);
    } catch (error) {
      showToast(
        "error",
        "Booking failed",
        error instanceof NoSeatsError ? error.message : getFriendlyError(error)
      );
    } finally {
      setSubmitting(false);
    }
  }, [route]);

  if (loading) {
    return (
      <AuthGate>
        <AppBackground>
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <AppText variant="body" style={[styles.stateText, ds.stateText]}>Loading route...</AppText>
          </View>
        </AppBackground>
      </AuthGate>
    );
  }

  if (error || !route) {
    return (
      <AuthGate>
        <AppBackground>
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="map-marker-off-outline" size={46} color={COLORS.accent} />
            <AppText variant="heading" style={[styles.stateTitle, ds.stateTitle]}>Route unavailable</AppText>
            <AppText variant="body" style={[styles.stateText, ds.stateText]}>{error || "This route no longer exists."}</AppText>
            <PrimaryButton title="Back" onPress={() => router.back()} style={styles.stateButton} />
          </View>
        </AppBackground>
      </AuthGate>
    );
  }

  if (bookedId) {
    return (
      <AuthGate>
        <AppBackground>
          <View style={styles.centerState}>
            <View style={styles.successIcon}>
              <MaterialCommunityIcons name="check-circle" size={56} color={COLORS.primary} />
            </View>
            <AppText variant="heading" style={[styles.stateTitle, ds.stateTitle]}>Booking sent!</AppText>
            <AppText variant="body" style={[styles.stateText, ds.stateText]}>
              {route.origin} → {route.destination}{"\n"}
              Waiting for your Mate to accept. You'll pay once they accept.
            </AppText>
            <PrimaryButton
              title="Track this booking"
              onPress={() => router.replace(`/booking/pay?bookingId=${bookedId}`)}
              style={styles.stateButton}
            />
            <PrimaryButton
              title="Back to dashboard"
              variant="outline"
              onPress={() => router.replace("/home")}
              style={styles.stateButton}
            />
          </View>
        </AppBackground>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <AppBackground>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.primary} />
          </Pressable>

          <AppText variant="caption" style={styles.eyebrow}>BOOK YOUR RIDE</AppText>
          <AppText variant="title" style={[styles.title, ds.title]}>{route.origin} → {route.destination}</AppText>
          <AppText variant="body" style={[styles.subtitle, ds.subtitle]}>
            Book 1 seat on this route. Your driver confirms first — you only pay after they accept.
          </AppText>

          <View style={styles.routeCard}>
            <View style={styles.routeIcon}>
              <MaterialCommunityIcons name="bus" size={28} color={COLORS.primary} />
            </View>
            <View style={styles.routeInfo}>
              <AppText variant="heading" style={[styles.routeTitle, ds.routeTitle]}>{route.origin} → {route.destination}</AppText>
              <AppText variant="caption" style={[styles.routeStops, ds.routeStops]}>
                {route.stops.length} {route.stops.length === 1 ? "stop" : "stops"} along the way
              </AppText>
            </View>
          </View>

          <PrimaryButton
            title={submitting ? "Booking..." : "Confirm booking"}
            onPress={() => void handleBook()}
            disabled={submitting}
          />

          <PrimaryButton
            title="Cancel"
            onPress={() => router.back()}
            variant="outline"
            style={styles.cancelButton}
          />
        </ScrollView>
      </AppBackground>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xxl },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginBottom: SPACING.lg },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: SPACING.xs },
  title: { color: COLORS.navy, fontSize: 30, lineHeight: 37 },
  subtitle: { color: COLORS.textSecondary, marginTop: SPACING.sm, marginBottom: SPACING.xl, lineHeight: 22 },
  routeCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.lg,
    borderRadius: 20,
    backgroundColor: COLORS.blueWash,
    borderWidth: 1,
    borderColor: COLORS.veryLightBlue,
    marginBottom: SPACING.xl,
  },
  routeIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
    marginRight: SPACING.md,
  },
  routeInfo: { flex: 1 },
  routeTitle: { color: COLORS.navy, fontSize: 17, lineHeight: 22 },
  routeStops: { color: COLORS.textSecondary, marginTop: SPACING.xs },
  cancelButton: { marginTop: SPACING.md },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl },
  stateTitle: { color: COLORS.navy, textAlign: "center", marginTop: SPACING.md },
  stateText: { color: COLORS.textSecondary, textAlign: "center", marginTop: SPACING.sm, lineHeight: 22 },
  stateButton: { marginTop: SPACING.lg },
  successIcon: { marginBottom: SPACING.md },
});
