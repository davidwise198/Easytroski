import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { MapView, MapViewType, Marker, PROVIDER_DEFAULT } from "../src/components/map/MapExports";
import * as Location from "expo-location";
import { router } from "expo-router";

import AuthGate from "../src/components/AuthGate";
import AppText from "../src/components/ui/AppText";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import { useLocation } from "../src/contexts/LocationContext";
import { useAuth } from "../src/contexts/AuthContext";
import {
  subscribeDriverActiveTrip,
  subscribeDriverBookings,
  getDriverPickupLocations,
} from "../src/services/map";
import { getActiveRoutes, startTrip, endTrip, confirmBooking, cancelBooking, updateBookingStatus, updateDriverSeats, incrementDriverSeats, updateDriverLocation } from "../src/services/transport";
import { COLORS, SPACING } from "../src/theme";
import { useThemeColors } from "../src/contexts/ThemeContext";
import { useMemo } from "react";
import { Route, Trip, TripStatus } from "../src/types/models";
import { showToast } from "../src/utils/toast";

// Ghana/Omanjor default center
const DEFAULT_REGION = {
  latitude: 5.6037,
  longitude: -0.187,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

function tripStatusLabel(status: TripStatus): string {
  switch (status) {
    case "online":
    case "boarding":
      return "Boarding";
    case "in_progress":
      return "On the way";
    case "scheduled":
      return "Scheduled";
    default:
      return status;
  }
}

function tripStatusColor(status: TripStatus): string {
  switch (status) {
    case "online":
    case "boarding":
      return COLORS.success;
    case "in_progress":
      return COLORS.primary;
    case "scheduled":
      return COLORS.warning;
    default:
      return COLORS.textSecondary;
  }
}

export default function DriverMapScreen() {
  const { user, signOut } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(() => ({
    topBarText: { color: colors.text },
    panelTitle: { color: colors.text },
    pickupSheetName: { color: colors.text },
    seatCountText: { color: colors.text },
    bookingTitle: { color: colors.text },
    topBar: { backgroundColor: 'rgba(255,255,255,0.92)' },
    permissionBanner: { backgroundColor: colors.surface },
    chip: { backgroundColor: colors.surface, borderColor: colors.veryLightBlue },
    bottomPanel: { backgroundColor: colors.surface },
    pickupSheet: { backgroundColor: colors.surface },
    iconButton: { backgroundColor: colors.blueWash },
    seatBtn: { backgroundColor: colors.white, borderColor: colors.veryLightBlue },
    seatCounterRow: { backgroundColor: colors.veryLightBlue },
    bookingCard: { backgroundColor: colors.veryLightBlue },
    bookingIcon: { backgroundColor: colors.white },
    trackingBadge: { backgroundColor: colors.veryLightBlue },
    permissionText: { color: colors.textSecondary },
    sectionLabel: { color: colors.textSecondary },
    pickupLabelText: { color: colors.white },
    panelSubtitle: { color: colors.textSecondary },
    trackingText: { color: colors.textSecondary },
    tripStatusText: { color: colors.textSecondary },
    tripTime: { color: colors.textSecondary },
    bookingCardItem: { backgroundColor: colors.veryLightBlue },
    emptyBookings: { color: colors.textSecondary },
    bookingPassenger: { color: colors.text },
    bookingSeats: { color: colors.textSecondary },
    bookingRoute: { color: colors.textSecondary },
    emptyText: { color: colors.textSecondary },
    bookingSubtitle: { color: colors.textSecondary },
    bookingStatusText: { color: colors.white },
    bookingSeatsInline: { color: colors.textSecondary },
  }), [colors]);
  const {
    status: permissionStatus,
    location,
    loading: locationLoading,
    deniedMessage,
    requestPermission,
  } = useLocation();

  const mapRef = useRef<MapViewType>(null);

  // Data
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [seatCount, setSeatCount] = useState(12);
  const [editingSeats, setEditingSeats] = useState(false);
  const [pickupLocations, setPickupLocations] = useState<Array<{ id: string; latitude: number; longitude: number; passengerName: string; seats: number; status: string }>>([]);
  const [selectedPickup, setSelectedPickup] = useState<{ id: string; latitude: number; longitude: number; passengerName: string; seats: number; status: string } | null>(null);

  // Real-time location tracking for active trips
  const locationSubscriptionRef =
    useRef<Location.LocationSubscription | null>(null);

  // Load routes
  useEffect(() => {
    getActiveRoutes()
      .then(setRoutes)
      .catch((error) => console.error("Failed to load routes:", error));
  }, []);

  // Subscribe to driver's active trip
  useEffect(() => {
    if (!user?.uid) return;

    const unsubscribe = subscribeDriverActiveTrip(user.uid, (trip) => {
      setActiveTrip(trip);
      if (trip?.routeId) {
        setSelectedRouteId(trip.routeId);
      }
    });

    return unsubscribe;
  }, [user?.uid]);

  // Real-time bookings subscription when trip is active
  useEffect(() => {
    if (!activeTrip || !user?.uid) {
      setBookings([]);
      return;
    }

    const unsubscribe = subscribeDriverBookings(user.uid, (updatedBookings) => {
      setBookings(updatedBookings);
      // Also refresh pickup locations when bookings change
      getDriverPickupLocations(user.uid).then(setPickupLocations).catch(() => {});
    });

    return unsubscribe;
  }, [activeTrip, user?.uid]);

  // Location tracking when trip is active
  useEffect(() => {
    const driverId = user?.uid;
    if (!activeTrip || !driverId) {
      return;
    }

    let cancelled = false;

    const startTracking = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        console.warn("Location permission denied — tracking disabled");
        return;
      }

      locationSubscriptionRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 50,
        },
        ({ coords }) => {
          if (!cancelled) {
            void updateDriverLocation(
              driverId,
              coords.latitude,
              coords.longitude
            );
          }
        }
      );
    };

    void startTracking();

    return () => {
      cancelled = true;
      try {
        locationSubscriptionRef.current?.remove();
      } catch {
        // expo-location cleanup — safe to ignore
      }
      locationSubscriptionRef.current = null;
    };
  }, [activeTrip, user?.uid]);

  // Re-center map on user location
  useEffect(() => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        },
        400
      );
    }
  }, [location]);

  const handleStartTrip = useCallback(async () => {
    const driverId = user?.uid;
    if (!driverId || !selectedRouteId) return;

    setStarting(true);
    try {
      await startTrip(driverId, selectedRouteId, "going", seatCount);
    } catch (error) {
      console.error("Trip start error:", error);
      showToast("error", "Trip start failed", "Could not start trip. Please try again.");
    } finally {
      setStarting(false);
    }
  }, [user?.uid, selectedRouteId]);

  const handleEndTrip = useCallback(async () => {
    if (!activeTrip || !user?.uid) return;

    setEnding(true);
    try {
      await endTrip(activeTrip.id, user.uid);
      showToast("success", "Trip ended", "You are now offline. Passengers can no longer see this trip.");
    } catch (error) {
      console.error("Trip end error:", error);
      showToast("error", "Failed to end trip", "Please try again.");
    } finally {
      setEnding(false);
    }
  }, [activeTrip, user?.uid]);

  const handleConfirmBooking = useCallback(
    async (bookingId: string) => {
      const booking = bookings.find((b: any) => b.id === bookingId);
      try {
        await confirmBooking(
          bookingId,
          booking?.passengerId,
          activeTrip ? `${activeTrip.origin || "Origin"} → ${activeTrip.destination || "Destination"}` : undefined
        );
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: "confirmed" } : b))
        );
        showToast("success", "Booking confirmed", "Passenger has been notified.");
      } catch (error) {
        console.error("Confirm booking error:", error);
        showToast("error", "Failed to confirm", "Please try again.");
      }
    },
    []
  );

  const handleRejectBooking = useCallback(
    async (bookingId: string) => {
      const booking = bookings.find((b: any) => b.id === bookingId);
      try {
        await cancelBooking(
          bookingId,
          user?.uid ?? "driver",
          user?.uid,
          booking?.passengerId,
          activeTrip ? `${activeTrip.origin || "Origin"} → ${activeTrip.destination || "Destination"}` : undefined
        );
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: "cancelled" } : b))
        );
        showToast("info", "Booking rejected", "Passenger has been notified.");
      } catch (error) {
        console.error("Reject booking error:", error);
        showToast("error", "Failed to reject", "Please try again.");
      }
    },
    [user?.uid]
  );

  const handleCompleteBooking = useCallback(
    async (bookingId: string) => {
      try {
        await updateBookingStatus(bookingId, "completed");
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: "completed" } : b))
        );
        showToast("success", "Passenger dropped off", "Booking marked as completed.");
      } catch (error) {
        console.error("Complete booking error:", error);
        showToast("error", "Failed", "Please try again.");
      }
    },
    []
  );

  const handleUpdateSeats = useCallback(
    async (newCount: number) => {
      const driverId = user?.uid;
      if (!driverId) return;
      const clamped = Math.max(0, Math.min(30, newCount));
      setSeatCount(clamped);
      try {
        await updateDriverSeats(driverId, clamped);
        showToast("success", "Seats updated", `${clamped} seats available.`);
      } catch {
        showToast("error", "Failed", "Could not update seat count.");
      }
    },
    [user?.uid]
  );

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const hasActiveTrip = activeTrip !== null;
  const isTripActive =
    activeTrip?.status === "in_progress" ||
    activeTrip?.status === "online" ||
    activeTrip?.status === "boarding";

  const userRegion = location
    ? {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
      }
    : DEFAULT_REGION;

  return (
    <AuthGate allowedRoles={["driver"]}>
      <View style={styles.container}>
        {/* ---- Map ---- */}
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          showsUserLocation={permissionStatus === "granted"}
          showsMyLocationButton={false}
          initialRegion={userRegion}
        >
          {/* Driver's own location marker when tracking */}
          {location && (
            <Marker
              coordinate={{
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.driverDot}>
                <View style={styles.driverDotInner} />
              </View>
            </Marker>
          )}

          {/* Passenger pickup markers */}
          {pickupLocations.map((pickup) => (
            <Marker
              key={pickup.id}
              coordinate={{ latitude: pickup.latitude, longitude: pickup.longitude }}
              anchor={{ x: 0.5, y: 1 }}
              onPress={() => setSelectedPickup(pickup)}
            >
              <View style={styles.pickupMarker}>
                <MaterialCommunityIcons name="account-circle" size={20} color={COLORS.white} />
              </View>
              <View style={styles.pickupLabel}>
                <AppText variant="caption" style={[styles.pickupLabelText, ds.pickupLabelText]} numberOfLines={1}>
                  {pickup.passengerName}
                </AppText>
              </View>
            </Marker>
          ))}
        </MapView>

        {/* ---- Top bar ---- */}
        <View style={[styles.topBar, ds.topBar]}>
          <Pressable style={[styles.iconButton, ds.iconButton]} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.primary} />
          </Pressable>
          <View style={styles.topBarTitle}>
            <AppText variant="caption" style={styles.topBarEyebrow}>DRIVER MAP</AppText>
            <AppText variant="heading" style={[styles.topBarText, ds.topBarText]}>
              {hasActiveTrip
                ? `${activeTrip.origin || "Origin"} → ${activeTrip.destination || "Dest"}`
                : "Select a route to start"}
            </AppText>
          </View>
          <Pressable style={[styles.iconButton, ds.iconButton]} onPress={() => requestPermission()}>
            <MaterialCommunityIcons name="crosshairs-gps" size={20} color={COLORS.primary} />
          </Pressable>
        </View>

        {/* ---- Location permission banner ---- */}
        {permissionStatus === "denied" && (
          <Pressable style={[styles.permissionBanner, ds.permissionBanner]} onPress={() => requestPermission()}>
            <MaterialCommunityIcons name="map-marker-alert-outline" size={18} color={COLORS.warning} />
            <AppText variant="caption" style={[styles.permissionText, ds.permissionText]}>
              {deniedMessage || "Location needed for trip tracking"}
            </AppText>
          </Pressable>
        )}

        {/* ---- Route selector (only when no active trip) ---- */}
        {!hasActiveTrip && (
          <View style={styles.routeSelector}>
            <AppText variant="caption" style={[styles.sectionLabel, ds.sectionLabel]}>SELECT YOUR ROUTE</AppText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.routeChips}
            >
              {routes.map((route) => (
                <Pressable
                  key={route.id}
                  style={[
                    styles.chip,
                    selectedRouteId === route.id && styles.chipSelected,
                  ]}
                  onPress={() => setSelectedRouteId(route.id)}
                >
                  <AppText
                    variant="caption"
                    style={[
                      styles.chipText,
                      selectedRouteId === route.id && styles.chipTextSelected,
                    ]}
                  >
                    {route.origin} → {route.destination}
                  </AppText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ---- Bottom panel: trip controls ---- */}
        <View style={[styles.bottomPanel, ds.bottomPanel]}>
          <View style={styles.handle} />

          {!hasActiveTrip ? (
            /* No active trip — show start button */
            <View style={styles.panelContent}>
              <View style={styles.panelHeader}>
                <View style={styles.panelIcon}>
                  <MaterialCommunityIcons name="steering" size={22} color={COLORS.primary} />
                </View>
                <View style={styles.panelCopy}>
                  <AppText variant="heading" style={[styles.panelTitle, ds.panelTitle]}>Ready to go?</AppText>
                  <AppText variant="caption" style={[styles.panelSubtitle, ds.panelSubtitle]}>
                    {selectedRouteId
                      ? "Start your trip to become visible to passengers"
                      : "Choose a route above to start your trip"}
                  </AppText>
                </View>
              </View>

              {isTripActive && location && (
                <View style={[styles.trackingBadge, ds.trackingBadge]}>
                  <View style={styles.trackingDot} />
                  <AppText variant="caption" style={[styles.trackingText, ds.trackingText]}>
                    Live tracking active — updating every 15s
                  </AppText>
                </View>
              )}

              <PrimaryButton
                title={starting ? "Starting trip..." : "Start trip"}
                onPress={() => void handleStartTrip()}
                disabled={starting || !selectedRouteId}
              />
            </View>
          ) : (
            /* Active trip — show trip info and bookings */
            <ScrollView style={styles.panelContent} showsVerticalScrollIndicator={false}>
              {/* Trip status */}
              <View style={styles.tripStatusRow}>
                <View
                  style={[
                    styles.tripStatusBadge,
                    { backgroundColor: tripStatusColor(activeTrip.status) },
                  ]}
                >
                  <View style={styles.trackingDotSmall} />
                  <AppText variant="caption" style={[styles.tripStatusText, ds.tripStatusText]}>
                    {tripStatusLabel(activeTrip.status)}
                  </AppText>
                </View>
                <AppText variant="caption" style={[styles.tripTime, ds.tripTime]}>
                  {activeTrip.startTime
                    ? `Started ${new Date(activeTrip.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : "Just started"}
                </AppText>
              </View>

              {/* Seat counter */}
              <View style={[styles.seatCounterRow, ds.seatCounterRow]}>
                <AppText variant="caption" style={[styles.sectionLabel, ds.sectionLabel]}>AVAILABLE SEATS</AppText>
                <View style={styles.seatCounterControls}>
                  <Pressable
                    style={[styles.seatBtn, ds.seatBtn]}
                    onPress={() => handleUpdateSeats(seatCount - 1)}
                  >
                    <MaterialCommunityIcons name="minus" size={18} color={COLORS.primary} />
                  </Pressable>
                  <AppText variant="heading" style={[styles.seatCountText, ds.seatCountText]}>{seatCount}</AppText>
                  <Pressable
                    style={[styles.seatBtn, ds.seatBtn]}
                    onPress={() => handleUpdateSeats(seatCount + 1)}
                  >
                    <MaterialCommunityIcons name="plus" size={18} color={COLORS.primary} />
                  </Pressable>
                </View>
              </View>

              {/* Bookings list */}
              <View style={styles.bookingsSection}>
                <AppText variant="caption" style={[styles.sectionLabel, ds.sectionLabel]}>
                  PASSENGER BOOKINGS ({bookings.length})
                </AppText>
                {bookings.length === 0 ? (
                  <View style={styles.emptyBookings}>
                    <MaterialCommunityIcons name="account-clock-outline" size={28} color={COLORS.textSecondary} />
                    <AppText variant="body" style={[styles.emptyText, ds.emptyText]}>
                      No bookings yet. Passengers will appear here as they book.
                    </AppText>
                  </View>
                ) : (
                  bookings.map((booking: any, index: number) => (
                    <View key={booking.id || index} style={[styles.bookingCard, ds.bookingCard]}>
                      <View style={[styles.bookingIcon, ds.bookingIcon]}>
                        <MaterialCommunityIcons name="account" size={16} color={COLORS.primary} />
                      </View>
                      <View style={styles.bookingCopy}>
                        <AppText variant="heading" style={[styles.bookingTitle, ds.bookingTitle]}>
                          {booking.passengerName || "Passenger"}
                        </AppText>
                        <AppText variant="caption" style={[styles.bookingSubtitle, ds.bookingSubtitle]}>
                          {booking.pickupLocation?.address || "Pickup"} → {booking.dropOffLocation?.address || "Drop-off"}
                        </AppText>
                        <View style={styles.bookingStatusRow}>
                          <View style={[styles.bookingStatusBadge, { backgroundColor: booking.status === "confirmed" ? COLORS.success : booking.status === "cancelled" ? COLORS.danger : booking.status === "completed" ? COLORS.primary : COLORS.warning }]}>
                            <AppText variant="caption" style={styles.bookingStatusText}>
                              {booking.status === "confirmed" ? "Confirmed" : booking.status === "cancelled" ? "Rejected" : booking.status === "completed" ? "Dropped off" : "Pending"}
                            </AppText>
                          </View>
                          <AppText variant="caption" style={styles.bookingSeatsInline}>
                            {booking.seats || 1} seat{(booking.seats || 1) > 1 ? "s" : ""}
                          </AppText>
                        </View>
                      </View>
                      {booking.status === "pending" && (
                        <View style={styles.bookingActions}>
                          <Pressable
                            style={styles.confirmButton}
                            onPress={() => void handleConfirmBooking(booking.id)}
                          >
                            <MaterialCommunityIcons name="check" size={18} color={COLORS.white} />
                          </Pressable>
                          <Pressable
                            style={styles.rejectButton}
                            onPress={() => void handleRejectBooking(booking.id)}
                          >
                            <MaterialCommunityIcons name="close" size={18} color={COLORS.white} />
                          </Pressable>
                        </View>
                      )}
                      {booking.status === "confirmed" && (
                        <View style={styles.bookingActions}>
                          <Pressable
                            style={styles.dropoffButton}
                            onPress={() => void handleCompleteBooking(booking.id)}
                          >
                            <MaterialCommunityIcons name="account-check" size={18} color={COLORS.white} />
                          </Pressable>
                        </View>
                      )}
                    </View>
                  ))
                )}
              </View>

              <PrimaryButton
                title={ending ? "Ending trip..." : "End trip"}
                onPress={() => void handleEndTrip()}
                disabled={ending}
                style={styles.endTripButton}
              />
              <PrimaryButton
                title="Sign out"
                onPress={() => void handleSignOut()}
                variant="outline"
                style={styles.signOutButton}
              />
            </ScrollView>
          )}
        </View>
        {/* ---- Pickup detail bottom sheet ---- */}
        {selectedPickup && (
          <View style={[styles.pickupSheet, ds.pickupSheet]}>
            <View style={styles.handle} />
            <View style={styles.pickupSheetContent}>
              <View style={styles.pickupSheetHeader}>
                <View style={styles.pickupSheetIcon}>
                  <MaterialCommunityIcons name="account-circle" size={22} color={COLORS.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="heading" style={[styles.pickupSheetName, ds.pickupSheetName]}>
                    {selectedPickup.passengerName}
                  </AppText>
                  <View style={styles.pickupSheetMeta}>
                    <View style={[styles.pickupStatusBadge, { backgroundColor: selectedPickup.status === "confirmed" ? COLORS.success : COLORS.warning }]}>
                      <AppText variant="caption" style={styles.pickupStatusText}>
                        {selectedPickup.status === "confirmed" ? "Confirmed" : "Pending"}
                      </AppText>
                    </View>
                    <AppText variant="caption" style={styles.pickupSeats}>
                      {selectedPickup.seats} seat{selectedPickup.seats > 1 ? "s" : ""}
                    </AppText>
                  </View>
                </View>
              </View>
              <PrimaryButton title="Close" onPress={() => setSelectedPickup(null)} variant="outline" />
            </View>
          </View>
        )}
      </View>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },

  // Pickup marker
  pickupMarker: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.white,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  pickupLabel: {
    backgroundColor: COLORS.white,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: "center",
    marginTop: -4,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  pickupLabelText: {
    color: COLORS.navy,
    fontSize: 10,
    fontWeight: "600",
  },

  // Driver location dot
  driverDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(23, 105, 224, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  driverDotInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.primary,
    borderWidth: 2,
    borderColor: COLORS.white,
  },

  // Top bar
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.sm,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  topBarTitle: {
    flex: 1,
    marginLeft: SPACING.sm,
  },
  topBarEyebrow: {
    color: COLORS.primary,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  topBarText: {
    color: COLORS.navy,
    fontSize: 18,
    lineHeight: 24,
  },

  // Permission banner
  permissionBanner: {
    position: "absolute",
    top: 130,
    left: SPACING.md,
    right: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 14,
    backgroundColor: COLORS.white,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  permissionText: {
    color: COLORS.textSecondary,
    flex: 1,
  },

  // Route selector
  routeSelector: {
    position: "absolute",
    top: 140,
    left: 0,
    right: 0,
  },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
  routeChips: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.veryLightBlue,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    color: COLORS.navy,
    fontSize: 12,
  },
  chipTextSelected: {
    color: COLORS.white,
  },

  // Bottom panel
  bottomPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    maxHeight: "55%",
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.veryLightBlue,
    alignSelf: "center",
    marginTop: SPACING.sm,
    marginBottom: SPACING.md,
  },
  panelContent: {
    paddingHorizontal: SPACING.lg,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  panelIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  panelCopy: {
    flex: 1,
  },
  panelTitle: {
    color: COLORS.navy,
    fontSize: 20,
    lineHeight: 26,
  },
  panelSubtitle: {
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // Trip active state
  tripStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  tripStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: 14,
  },
  trackingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.white,
  },
  trackingDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.white,
  },
  tripStatusText: {
    color: COLORS.white,
    fontSize: 12,
    fontWeight: "600",
  },
  tripTime: {
    color: COLORS.textSecondary,
  },

  // Tracking badge
  trackingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.sm,
    marginBottom: SPACING.md,
    borderRadius: 10,
    backgroundColor: COLORS.veryLightBlue,
  },
  trackingText: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },

  // Seat counter
  seatCounterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 14,
    backgroundColor: COLORS.veryLightBlue,
  },
  seatCounterControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  seatBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.veryLightBlue,
  },
  seatCountText: {
    color: COLORS.navy,
    fontSize: 22,
    minWidth: 30,
    textAlign: "center",
  },

  // Bookings
  bookingsSection: {
    marginTop: SPACING.sm,
  },
  emptyBookings: {
    alignItems: "center",
    paddingVertical: SPACING.xl,
  },
  emptyText: {
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: SPACING.sm,
  },
  bookingCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
    borderRadius: 14,
    backgroundColor: COLORS.veryLightBlue,
    marginBottom: SPACING.sm,
  },
  bookingIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.white,
    marginRight: SPACING.sm,
  },
  bookingCopy: {
    flex: 1,
  },
  bookingTitle: {
    color: COLORS.navy,
    fontSize: 14,
    lineHeight: 18,
  },
  bookingSubtitle: {
    color: COLORS.textSecondary,
    marginTop: 1,
  },
  bookingStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  bookingStatusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  bookingStatusText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: "600",
  },
  bookingSeatsInline: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },
  bookingActions: {
    flexDirection: "row",
    gap: SPACING.xs,
  },
  confirmButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.success,
  },
  rejectButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.danger,
  },
  dropoffButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
  },

  // Pickup detail sheet
  pickupSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  pickupSheetContent: {
    paddingHorizontal: SPACING.lg,
  },
  pickupSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  pickupSheetIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  pickupSheetName: {
    color: COLORS.navy,
    fontSize: 18,
  },
  pickupSheetMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  pickupStatusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  pickupStatusText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: "600",
  },
  pickupSeats: {
    color: COLORS.textSecondary,
    fontSize: 11,
  },

  endTripButton: {
    marginTop: SPACING.md,
  },
  signOutButton: {
    marginTop: SPACING.sm,
  },
});
