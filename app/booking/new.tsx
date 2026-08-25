import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import AuthGate from "../../src/components/AuthGate";
import { auth } from "../../src/services/firebase";
import { createBooking, createLocation, getAvailableTrips, getRoute } from "../../src/services/transport";
import { COLORS, SPACING } from "../../src/theme";
import { Route, Trip } from "../../src/types/models";

export default function NewBookingScreen() {
  const { routeId } = useLocalSearchParams<{ routeId?: string }>();
  const [route, setRoute] = useState<Route | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [pickupIndex, setPickupIndex] = useState(0);
  const [dropOffIndex, setDropOffIndex] = useState(1);
  const [seats, setSeats] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBookingData = useCallback(async () => {
    if (!routeId) {
      setError("This route could not be found.");
      setLoading(false);
      return;
    }

    try {
      const [loadedRoute, availableTrips] = await Promise.all([
        getRoute(routeId),
        getAvailableTrips(routeId),
      ]);
      setRoute(loadedRoute);
      setTrips(availableTrips);
      if (loadedRoute && loadedRoute.stops.length < 2) {
        setDropOffIndex(0);
      }
    } catch (loadError) {
      console.error("Booking data error:", loadError);
      setError("We could not load this route. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [routeId]);

  useEffect(() => {
    void loadBookingData();
  }, [loadBookingData]);

  const handleCreateBooking = async () => {
    const passengerId = auth.currentUser?.uid;
    const selectedTrip = trips[0];
    if (!passengerId || !route || !selectedTrip) {
      return;
    }

    setSubmitting(true);
    try {
      const stops = [route.origin, ...route.stops, route.destination];
      await createBooking({
        passengerId,
        driverId: selectedTrip.driverId,
        routeId: route.id,
        pickupLocation: createLocation(stops[pickupIndex]),
        dropOffLocation: createLocation(stops[dropOffIndex]),
        seats,
      });
      alert("Booking request sent. Your driver will confirm the ride shortly.");
      router.replace("/passenger-dashboard");
    } catch (bookingError) {
      console.error("Booking creation error:", bookingError);
      alert("We could not create your booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <AuthGate>
      <AppBackground>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <AppText variant="body" style={styles.stateText}>Loading route details...</AppText>
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
          <AppText variant="heading" style={styles.stateTitle}>Route unavailable</AppText>
          <AppText variant="body" style={styles.stateText}>{error || "This route no longer exists."}</AppText>
          <PrimaryButton title="Back to routes" onPress={() => router.back()} style={styles.stateButton} />
        </View>
      </AppBackground>
      </AuthGate>
    );
  }

  const stops = [route.origin, ...route.stops, route.destination];
  const hasAvailableTrip = trips.length > 0;

  return (
    <AuthGate>
    <AppBackground>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.primary} />
        </Pressable>
        <AppText variant="caption" style={styles.eyebrow}>BOOK YOUR RIDE</AppText>
        <AppText variant="title" style={styles.title}>{route.origin} to {route.destination}</AppText>
        <AppText variant="body" style={styles.subtitle}>Choose your stops and reserve your seats.</AppText>

        {!hasAvailableTrip ? (
          <View style={styles.emptyPanel}>
            <MaterialCommunityIcons name="bus-alert" size={42} color={COLORS.primary} />
            <AppText variant="heading" style={styles.panelTitle}>No vehicles available</AppText>
            <AppText variant="body" style={styles.panelText}>There are no active trotros on this route right now.</AppText>
          </View>
        ) : (
          <View style={styles.form}>
            <AppText variant="heading" style={styles.sectionTitle}>Pickup point</AppText>
            <View style={styles.stopList}>
              {stops.map((stop, index) => (
                <Pressable
                  key={`pickup-${stop}`}
                  style={[styles.stopOption, pickupIndex === index && styles.selectedStop]}
                  onPress={() => {
                    setPickupIndex(index);
                    if (dropOffIndex <= index) setDropOffIndex(Math.min(index + 1, stops.length - 1));
                  }}
                >
                  <MaterialCommunityIcons name={pickupIndex === index ? "radiobox-marked" : "radiobox-blank"} size={20} color={COLORS.primary} />
                  <AppText variant="body" style={styles.stopText}>{stop}</AppText>
                </Pressable>
              ))}
            </View>

            <AppText variant="heading" style={styles.sectionTitle}>Drop-off point</AppText>
            <View style={styles.stopList}>
              {stops.map((stop, index) => (
                <Pressable
                  key={`dropoff-${stop}`}
                  disabled={index <= pickupIndex}
                  style={[styles.stopOption, dropOffIndex === index && styles.selectedStop, index <= pickupIndex && styles.disabledStop]}
                  onPress={() => setDropOffIndex(index)}
                >
                  <MaterialCommunityIcons name={dropOffIndex === index ? "radiobox-marked" : "radiobox-blank"} size={20} color={index <= pickupIndex ? COLORS.textSecondary : COLORS.primary} />
                  <AppText variant="body" style={styles.stopText}>{stop}</AppText>
                </Pressable>
              ))}
            </View>

            <View style={styles.seatRow}>
              <View>
                <AppText variant="heading" style={styles.sectionTitle}>Seats</AppText>
                <AppText variant="caption" style={styles.seatHint}>How many seats do you need?</AppText>
              </View>
              <View style={styles.stepper}>
                <Pressable style={styles.stepButton} onPress={() => setSeats(Math.max(1, seats - 1))}>
                  <MaterialCommunityIcons name="minus" size={18} color={COLORS.primary} />
                </Pressable>
                <AppText variant="heading" style={styles.seatCount}>{seats}</AppText>
                <Pressable style={styles.stepButton} onPress={() => setSeats(Math.min(4, seats + 1))}>
                  <MaterialCommunityIcons name="plus" size={18} color={COLORS.primary} />
                </Pressable>
              </View>
            </View>

            <PrimaryButton title={submitting ? "Sending request..." : "Request booking"} onPress={() => void handleCreateBooking()} disabled={submitting || pickupIndex >= dropOffIndex} />
          </View>
        )}
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
  subtitle: { color: COLORS.textSecondary, marginTop: SPACING.sm, marginBottom: SPACING.xl },
  form: { gap: SPACING.md },
  sectionTitle: { color: COLORS.navy, fontSize: 17, lineHeight: 23 },
  stopList: { gap: SPACING.sm },
  stopOption: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.md, borderRadius: 16, backgroundColor: "rgba(232,243,255,0.7)", borderWidth: 1, borderColor: "transparent" },
  selectedStop: { borderColor: COLORS.primary, backgroundColor: COLORS.blueWash },
  disabledStop: { opacity: 0.42 },
  stopText: { color: COLORS.navy, marginLeft: SPACING.sm },
  seatRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: SPACING.sm },
  seatHint: { color: COLORS.textSecondary, marginTop: 2 },
  stepper: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  stepButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.blueWash },
  seatCount: { color: COLORS.navy, minWidth: 20, textAlign: "center" },
  emptyPanel: { alignItems: "center", justifyContent: "center", minHeight: 260, padding: SPACING.xl },
  panelTitle: { color: COLORS.navy, textAlign: "center", marginTop: SPACING.md },
  panelText: { color: COLORS.textSecondary, textAlign: "center", marginTop: SPACING.sm },
  centerState: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl },
  stateTitle: { color: COLORS.navy, textAlign: "center", marginTop: SPACING.md },
  stateText: { color: COLORS.textSecondary, textAlign: "center", marginTop: SPACING.sm },
  stateButton: { marginTop: SPACING.lg },
});
