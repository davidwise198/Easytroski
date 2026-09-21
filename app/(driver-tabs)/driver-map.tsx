import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Vibration,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { MapView, MapViewType, Marker, PROVIDER_DEFAULT } from "../../src/components/map/MapExports";
import * as Location from "expo-location";
import { router } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import AuthGate from "../../src/components/AuthGate";
import AppText from "../../src/components/ui/AppText";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import { useLocation } from "../../src/contexts/LocationContext";
import { useAuth } from "../../src/contexts/AuthContext";
import {
  subscribeDriverActiveTrip,
  subscribeDriverBookings,
  getDriverPickupLocations,
} from "../../src/services/map";
import { getActiveRoutes, startTrip, endTrip, confirmBooking, rejectBooking, cancelBooking, updateBookingStatus, updateDriverSeats, updateDriverLocation, getDriverDefaultRoute } from "../../src/services/transport";
import { fetchRoutePath, RoutePath } from "../../src/services/directions";
import { haversineMeters, formatDistance, formatEta, etaFromDistance } from "../../src/utils/geo";
import { formatPesewas } from "../../src/utils/money";
import { COLORS, SPACING } from "../../src/theme";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import { useMemo } from "react";
import { Route, Trip, TripStatus } from "../../src/types/models";
import { showToast } from "../../src/utils/toast";

// Ghana/Omanjor default center
const ALERT_SECONDS = 45;

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
  const { user } = useAuth();
  const { colors, isDark } = useThemeColors();
  const ds = useMemo(() => ({
    topBarText: { color: colors.text },
    topBarEyebrow: { color: colors.primary },
    panelTitle: { color: colors.text },
    pickupSheetName: { color: colors.text },
    seatCountText: { color: colors.text },
    bookingTitle: { color: colors.text },
    topBar: { backgroundColor: isDark ? 'rgba(30,41,59,0.95)' : 'rgba(255,255,255,0.92)' },
    permissionBanner: { backgroundColor: colors.surface },
    chip: { backgroundColor: colors.surface, borderColor: colors.veryLightBlue },
    chipText: { color: colors.text },
    bottomPanel: { backgroundColor: colors.surface },
    pickupSheet: { backgroundColor: colors.surface },
    iconButton: { backgroundColor: colors.blueWash },
    seatBtn: { backgroundColor: colors.white, borderColor: colors.veryLightBlue },
    seatCounterRow: { backgroundColor: colors.veryLightBlue },
    bookingCard: { backgroundColor: colors.veryLightBlue },
    bookingIcon: { backgroundColor: colors.white },
    pickupLabel: { backgroundColor: colors.surface },
    permissionText: { color: colors.textSecondary },
    sectionLabel: { color: colors.textSecondary },
    pickupLabelText: { color: colors.text },
    tripStatusText: { color: colors.white },
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
  }), [colors, isDark]);
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
  const [lockedRouteId, setLockedRouteId] = useState<string | null>(null);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [seatCount, setSeatCount] = useState(12);
  const [panelExpanded, setPanelExpanded] = useState(true);
  const [pickupLocations, setPickupLocations] = useState<Array<{ id: string; latitude: number; longitude: number; passengerName: string; seats: number; status: string }>>([]);
  const [selectedPickup, setSelectedPickup] = useState<{ id: string; latitude: number; longitude: number; passengerName: string; seats: number; status: string } | null>(null);
  const [nextPickupRoute, setNextPickupRoute] = useState<RoutePath | null>(null);
  const [routedFrom, setRoutedFrom] = useState<{ latitude: number; longitude: number } | null>(null);
  const routeFetchRef = useRef(0);

  // Booking alarm state
  const [alertBooking, setAlertBooking] = useState<any | null>(null);
  const [alertSecondsLeft, setAlertSecondsLeft] = useState(ALERT_SECONDS);

  // Takeover-card entrance + attention pulse. The card fades/scales in and
  // the bell icon pulses continuously so a driver mid-drive cannot miss it.
  const alertAnim = useRef(new Animated.Value(0)).current;
  const alertPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!alertBooking) {
      alertAnim.setValue(0);
      alertPulse.setValue(0);
      return;
    }
    Animated.timing(alertAnim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(alertPulse, {
          toValue: 1,
          duration: 550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(alertPulse, {
          toValue: 0,
          duration: 550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [alertBooking, alertAnim, alertPulse]);
  const seenBookingIdsRef = useRef<Set<string>>(new Set());
  const alertDismissedIdsRef = useRef<Set<string>>(new Set());
  const firstLocationFixRef = useRef(false);
  // Previous bookings snapshot — lets us detect a passenger cancelling on their side
  const prevBookingsRef = useRef<Map<string, any>>(new Map());

  // Derived: confirmed bookings drive GPS cadence + the next-pickup nav card
  const confirmedBookings = bookings.filter((b: any) => b.status === "confirmed");
  const nextPickup = confirmedBookings.length > 0 ? confirmedBookings[0] : null;
  const hasConfirmedBooking = confirmedBookings.length > 0;

  // Real-time location tracking for active trips
  const locationSubscriptionRef =
    useRef<Location.LocationSubscription | null>(null);

  // Booking alarm: vibrate + takeover card when a booking we haven't alerted arrives
  const detectNewBookings = useCallback((updatedBookings: any[]) => {
    const fresh = updatedBookings.filter(
      (b: any) =>
        b.status === "pending" &&
        b.id &&
        !seenBookingIdsRef.current.has(b.id) &&
        !alertDismissedIdsRef.current.has(b.id)
    );
    updatedBookings.forEach((b: any) => {
      if (b.id) seenBookingIdsRef.current.add(b.id);
    });
    if (fresh.length === 0) return;
    const toMillis = (t: any) =>
      typeof t?.toMillis === "function" ? t.toMillis() : typeof t === "number" ? t : 0;
    const newest = [...fresh].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))[0];
    setAlertBooking(newest);
    setAlertSecondsLeft(ALERT_SECONDS);
    Vibration.vibrate([0, 450, 250, 450], true);
  }, []);

  // A booking that vanishes from the live list without the driver acting on it
  // was cancelled by the passenger (or the system) — never let it vanish silently.
  const detectPassengerCancellations = useCallback((updatedBookings: any[]) => {
    const current = new Map<string, any>();
    updatedBookings.forEach((b: any) => {
      if (b.id) current.set(b.id, b);
    });
    for (const [id, prev] of prevBookingsRef.current) {
      if (current.has(id)) continue;
      if (prev.status !== "pending" && prev.status !== "confirmed") continue;
      if (prev.cancelledBy === "driver") continue; // we did it ourselves
      if (prev.passengerName) {
        showToast(
          "info",
          "Booking cancelled",
          prev.cancelledBy === "passenger"
            ? prev.passengerName + " cancelled their booking."
            : "A booking was cancelled (" + (prev.cancelReason || "system") + ")."
        );
      }
    }
    prevBookingsRef.current = current;
  }, []);

  // Load routes + the driver's locked default route
  useEffect(() => {
    const driverId = user?.uid;
    getActiveRoutes()
      .then(setRoutes)
      .catch((error) => console.error("Failed to load routes:", error));
    if (driverId) {
      getDriverDefaultRoute(driverId)
        .then((id) => {
          if (id) {
            setLockedRouteId(id);
            setSelectedRouteId(id);
          }
        })
        .catch(() => {});
    }
  }, [user?.uid]);

  // Subscribe to driver's active trip
  useEffect(() => {
    if (!user?.uid) return;

    const unsubscribe = subscribeDriverActiveTrip(
      user.uid,
      (trip) => {
        setActiveTrip(trip);
        if (trip?.routeId) {
          setSelectedRouteId(trip.routeId);
        }
      },
      (error) => {
        showToast("error", "Connection problem", "Could not load your trip. Check your connection and restart the trip.");
        console.error("Active trip listener error:", error);
      }
    );

    return unsubscribe;
  }, [user?.uid]);

  // Real-time bookings subscription when trip is active
  useEffect(() => {
    if (!activeTrip || !user?.uid) {
      setBookings([]);
      return;
    }

    const unsubscribe = subscribeDriverBookings(
      user.uid,
      (updatedBookings) => {
        setBookings(updatedBookings);
        // Also refresh pickup locations when bookings change
        getDriverPickupLocations(user.uid).then(setPickupLocations).catch(() => {});
        detectNewBookings(updatedBookings);
        detectPassengerCancellations(updatedBookings);
      },
      (error) => {
        showToast("error", "Connection problem", "New bookings may not appear. Check your connection.");
        console.error("Bookings listener error:", error);
      }
    );

    return unsubscribe;
  }, [activeTrip, user?.uid, detectNewBookings, detectPassengerCancellations]);

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
        hasConfirmedBooking
          ? // Tight cadence while carrying a passenger: the tracking passenger
            // sees this position glide in near-real-time on their map.
            { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 8 }
          : { accuracy: Location.Accuracy.Balanced, timeInterval: 15000, distanceInterval: 50 },
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
  }, [activeTrip, user?.uid, hasConfirmedBooking]);

  // Keep the screen awake while a trip is active — a driving driver must never miss a booking
  useEffect(() => {
    if (activeTrip) {
      activateKeepAwakeAsync().catch(() => {});
    } else {
      deactivateKeepAwake();
    }
  }, [activeTrip]);

  // Never leave the vibration running when the screen goes away
  useEffect(() => {
    return () => Vibration.cancel();
  }, []);

  // Alert countdown — after ALERT_SECONDS the card hands the booking back to the list
  useEffect(() => {
    if (!alertBooking) return;
    const interval = setInterval(() => {
      setAlertSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(interval);
          Vibration.cancel();
          if (alertBooking.id) alertDismissedIdsRef.current.add(alertBooking.id);
          setAlertBooking(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [alertBooking]);

  // Clear the takeover card if the alerted booking is resolved or withdrawn
  useEffect(() => {
    if (!alertBooking) return;
    const stillPending = bookings.some(
      (b: any) => b.id === alertBooking.id && b.status === "pending"
    );
    if (!stillPending) {
      Vibration.cancel();
      if (alertBooking.id) alertDismissedIdsRef.current.add(alertBooking.id);
      setAlertBooking(null);
    }
  }, [bookings, alertBooking]);

  // Center the map once on the first location fix, then leave the camera to the driver
  useEffect(() => {
    if (location && mapRef.current && !firstLocationFixRef.current) {
      firstLocationFixRef.current = true;
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

  // One-shot camera jump to the new pickup when the takeover card appears
  useEffect(() => {
    const pickup = alertBooking?.pickupLocation;
    if (!pickup?.latitude || !mapRef.current) return;
    mapRef.current.animateToRegion(
      {
        latitude: pickup.latitude,
        longitude: pickup.longitude,
        latitudeDelta: 0.03,
        longitudeDelta: 0.03,
      },
      600
    );
  }, [alertBooking?.id]);

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
      if (alertBooking?.id === bookingId) {
        setAlertBooking(null);
        Vibration.cancel();
      }
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
        showToast("success", "Booking accepted", "Passenger is paying now — you'll see Paid when done.");
      } catch (error) {
        console.error("Confirm booking error:", error);
        showToast("error", "Failed to confirm", "Please try again.");
      }
    },
    [bookings, activeTrip, alertBooking]
  );

  const handleRejectBooking = useCallback(
    async (bookingId: string) => {
      if (alertBooking?.id === bookingId) {
        setAlertBooking(null);
        Vibration.cancel();
      }
      const booking = bookings.find((b: any) => b.id === bookingId);
      try {
        // An unanswered request is a REJECTION — no money has moved, so the
        // seats are simply released. Once the passenger has paid, the same tap
        // becomes a driver CANCELLATION, which is what triggers a refund.
        if (booking && booking.status === "pending" && booking.paymentStatus !== "paid") {
          await rejectBooking(bookingId);
        } else {
          await cancelBooking(
            bookingId,
            user?.uid ?? "driver",
            user?.uid,
            booking?.passengerId,
            activeTrip ? `${activeTrip.origin || "Origin"} → ${activeTrip.destination || "Destination"}` : undefined
          );
        }
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: "cancelled" } : b))
        );
        showToast("info", "Booking rejected", "Passenger has been notified.");
      } catch (error) {
        console.error("Reject booking error:", error);
        showToast("error", "Failed to reject", "Please try again.");
      }
    },
    [user?.uid, bookings, activeTrip, alertBooking]
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


  // Road route to the next confirmed pickup — refetch after moving >300 m
  useEffect(() => {
    if (!nextPickup?.pickupLocation?.latitude || !location) {
      setNextPickupRoute(null);
      setRoutedFrom(null);
      return;
    }
    const from = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
    if (routedFrom && haversineMeters(routedFrom, from) < 300) return;
    const to = {
      latitude: nextPickup.pickupLocation.latitude,
      longitude: nextPickup.pickupLocation.longitude,
    };
    const ticket = ++routeFetchRef.current;
    fetchRoutePath(from, to)
      .then((routePath) => {
        if (ticket === routeFetchRef.current) {
          setNextPickupRoute(routePath);
          setRoutedFrom(from);
        }
      })
      .catch(() => {});
  }, [nextPickup?.id, location, routedFrom]);

  const nextPickupDistanceM =
    nextPickup?.pickupLocation?.latitude && location
      ? haversineMeters(
          { latitude: location.coords.latitude, longitude: location.coords.longitude },
          { latitude: nextPickup.pickupLocation.latitude, longitude: nextPickup.pickupLocation.longitude }
        )
      : null;
  const nextPickupEtaMin =
    nextPickupRoute?.fromRoads && nextPickupRoute.durationSeconds > 0
      ? nextPickupRoute.durationSeconds / 60
      : nextPickupDistanceM != null
        ? etaFromDistance(nextPickupDistanceM)
        : null;

  const alertDistanceM =
    alertBooking?.pickupLocation?.latitude && location
      ? haversineMeters(
          { latitude: location.coords.latitude, longitude: location.coords.longitude },
          {
            latitude: alertBooking.pickupLocation.latitude,
            longitude: alertBooking.pickupLocation.longitude,
          }
        )
      : null;

  const selectedPickupDistanceM =
    selectedPickup && location
      ? haversineMeters(
          { latitude: location.coords.latitude, longitude: location.coords.longitude },
          { latitude: selectedPickup.latitude, longitude: selectedPickup.longitude }
        )
      : null;

  // Hand off to Google Maps turn-by-turn (fallback: web directions)
  const handleNavigateToPickup = useCallback(() => {
    if (!nextPickup?.pickupLocation?.latitude) return;
    const { latitude, longitude } = nextPickup.pickupLocation;
    const appUrl =
      Platform.OS === "ios"
        ? `maps://app?daddr=${latitude},${longitude}&dirflg=d`
        : `google.navigation:q=${latitude},${longitude}`;
    const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=driving`;
    Linking.canOpenURL(appUrl)
      .then((supported) => Linking.openURL(supported ? appUrl : webUrl))
      .catch(() => {
        showToast("error", "Navigation unavailable", "Could not open maps navigation.");
      });
  }, [nextPickup]);

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
              <View style={[styles.pickupLabel, ds.pickupLabel]}>
                <AppText variant="caption" style={[styles.pickupLabelText, ds.pickupLabelText]} numberOfLines={1}>
                  {pickup.passengerName}
                </AppText>
              </View>
            </Marker>
          ))}
        </MapView>

        {/* ---- Top bar ---- */}
        <View style={[styles.topBar, ds.topBar]}>
          <Pressable style={[styles.iconButton, ds.iconButton]} onPress={() => router.navigate("/driver-home")}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.primary} />
          </Pressable>
          <View style={styles.topBarTitle}>
            <AppText variant="caption" style={[styles.topBarEyebrow, ds.topBarEyebrow]}>DRIVER MAP</AppText>
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
                    ds.chip,
                    selectedRouteId === route.id && styles.chipSelected,
                    lockedRouteId && route.id !== selectedRouteId && styles.chipDim,
                  ]}
                  onPress={() => {
                    if (lockedRouteId) {
                      showToast(
                        "info",
                        "Route locked",
                        "Your default route can be changed in Profile settings."
                      );
                      return;
                    }
                    setSelectedRouteId(route.id);
                  }}
                >
                  <AppText
                    variant="caption"
                    style={[
                      styles.chipText,
                      ds.chipText,
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
              <Pressable
                style={styles.panelToggle}
                onPress={() => setPanelExpanded((v) => !v)}
              >
                <View style={styles.panelIconSmall}>
                  <MaterialCommunityIcons name="steering" size={18} color={COLORS.primary} />
                </View>
                <AppText variant="caption" style={[styles.panelToggleText, ds.panelTitle]} numberOfLines={1}>
                  {selectedRouteId
                    ? "Ready to go — start your trip when set"
                    : "Choose a route to begin"}
                </AppText>
                <MaterialCommunityIcons
                  name={panelExpanded ? "chevron-down" : "chevron-up"}
                  size={20}
                  color={COLORS.textSecondary}
                />
              </Pressable>
              {panelExpanded && (
                <PrimaryButton
                  title={starting ? "Starting trip..." : "Start trip"}
                  onPress={() => void handleStartTrip()}
                  disabled={starting || !selectedRouteId}
                />
              )}
            </View>
          ) : (
            /* Active trip — show trip info and bookings */
            <ScrollView style={styles.panelContent} showsVerticalScrollIndicator={false}>
              <Pressable
                style={styles.panelToggle}
                onPress={() => setPanelExpanded((v) => !v)}
              >
                <AppText variant="caption" style={[styles.panelToggleText, ds.panelTitle]} numberOfLines={1}>
                  Trip active — {bookings.length} booking{bookings.length === 1 ? "" : "s"} • {seatCount} seat{seatCount === 1 ? "" : "s"} left
                </AppText>
                <MaterialCommunityIcons
                  name={panelExpanded ? "chevron-down" : "chevron-up"}
                  size={20}
                  color={COLORS.textSecondary}
                />
              </Pressable>
              {panelExpanded && (
              <>
              {/* Next pickup — Bolt-style navigation card */}
              {nextPickup && (
                <View style={styles.nextPickupCard}>
                  <View style={styles.nextPickupHeader}>
                    <View style={styles.nextPickupIcon}>
                      <MaterialCommunityIcons name="navigation-variant-outline" size={18} color={COLORS.white} />
                    </View>
                    <View style={styles.nextPickupCopy}>
                      <AppText variant="caption" style={styles.nextPickupEyebrow}>NEXT PICKUP</AppText>
                      <AppText variant="heading" style={styles.nextPickupName}>
                        {nextPickup.passengerName || "Passenger"}
                      </AppText>
                    </View>
                    {nextPickupDistanceM != null && (
                      <View style={styles.nextPickupDistance}>
                        <AppText variant="heading" style={styles.nextPickupDistanceText}>
                          {formatDistance(nextPickupDistanceM)}
                        </AppText>
                        {nextPickupEtaMin != null && (
                          <AppText variant="caption" style={styles.nextPickupEta}>
                            {formatEta(nextPickupEtaMin)}
                          </AppText>
                        )}
                      </View>
                    )}
                  </View>
                  <View style={styles.nextPickupActions}>
                    <Pressable style={styles.navigateBtn} onPress={handleNavigateToPickup}>
                      <MaterialCommunityIcons name="google-maps" size={16} color={COLORS.white} />
                      <AppText variant="caption" style={styles.navigateBtnText}>Navigate</AppText>
                    </Pressable>
                    <AppText variant="caption" style={styles.nextPickupSeats} numberOfLines={1}>
                      {nextPickup.seats || 1} seat{(nextPickup.seats || 1) > 1 ? "s" : ""} • {nextPickup.pickupLocation?.address || "Pickup point"}
                    </AppText>
                  </View>
                </View>
              )}

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
                      <View style={styles.bookingInfoRow}>
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
                            <View
                              style={[
                                styles.bookingStatusBadge,
                                {
                                  backgroundColor:
                                    booking.status === "confirmed"
                                      ? COLORS.success
                                      : booking.status === "cancelled" || booking.status === "expired"
                                        ? COLORS.danger
                                        : booking.status === "completed"
                                          ? COLORS.primary
                                          : booking.status === "awaiting_payment"
                                            ? COLORS.accent
                                            : COLORS.warning,
                                },
                              ]}
                            >
                              <AppText variant="caption" style={styles.bookingStatusText}>
                                {booking.status === "confirmed"
                                  ? "Confirmed"
                                  : booking.status === "cancelled"
                                    ? booking.cancelReason === "rejected_by_driver"
                                      ? "Rejected"
                                      : "Cancelled"
                                    : booking.status === "expired"
                                      ? "Expired"
                                      : booking.status === "completed"
                                        ? "Dropped off"
                                        : booking.status === "awaiting_payment"
                                          ? "Awaiting payment"
                                          : "Pending"}
                              </AppText>
                            </View>
                            <AppText variant="caption" style={styles.bookingSeatsInline}>
                              {booking.seats || 1} seat{(booking.seats || 1) > 1 ? "s" : ""}
                            </AppText>
                            {booking.paymentStatus === "paid" ? (
                              <View style={styles.paidBadge}>
                                <MaterialCommunityIcons name="cash-check" size={12} color={COLORS.white} />
                                <AppText variant="caption" style={styles.paidBadgeText}>
                                  Paid
                                </AppText>
                              </View>
                            ) : booking.status === "awaiting_payment" || booking.status === "pending" ? (
                              <View style={styles.unpaidBadge}>
                                <MaterialCommunityIcons name="clock-outline" size={12} color={COLORS.accent} />
                                <AppText variant="caption" style={styles.unpaidBadgeText}>
                                  Unpaid
                                </AppText>
                              </View>
                            ) : null}
                          </View>
                        </View>
                      </View>
                      {booking.status === "pending" && (
                        <View style={styles.bookingActionsWide}>
                          <Pressable
                            style={({ pressed }) => [styles.rejectBtnWide, pressed && { opacity: 0.85 }]}
                            onPress={() => void handleRejectBooking(booking.id)}
                          >
                            <MaterialCommunityIcons name="close" size={18} color={COLORS.danger} />
                            <AppText variant="caption" style={styles.rejectBtnWideText}>
                              Reject
                            </AppText>
                          </Pressable>
                          <Pressable
                            style={({ pressed }) => [styles.confirmBtnWide, pressed && { opacity: 0.85 }]}
                            onPress={() => void handleConfirmBooking(booking.id)}
                          >
                            <MaterialCommunityIcons name="check" size={18} color={COLORS.white} />
                            <AppText variant="caption" style={styles.confirmBtnWideText}>
                              Accept
                            </AppText>
                          </Pressable>
                        </View>
                      )}
                      {booking.status === "awaiting_payment" && (
                        <View style={styles.paymentWaitRow}>
                          <MaterialCommunityIcons name="timer-sand" size={14} color={COLORS.accent} />
                          <AppText variant="caption" style={styles.paymentWaitText}>
                            Waiting for this passenger to pay. Pick up only once it shows Paid.
                          </AppText>
                        </View>
                      )}
                      {booking.status === "confirmed" && (
                        <Pressable
                          style={({ pressed }) => [styles.dropoffBtnWide, pressed && { opacity: 0.85 }]}
                          onPress={() => void handleCompleteBooking(booking.id)}
                        >
                          <MaterialCommunityIcons name="account-check" size={18} color={COLORS.white} />
                          <AppText variant="caption" style={styles.dropoffBtnWideText}>
                            Picked up
                          </AppText>
                        </Pressable>
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
              </>
              )}
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
                    {selectedPickupDistanceM != null && (
                      <AppText variant="caption" style={styles.pickupSeats}>
                        • {formatDistance(selectedPickupDistanceM)} away
                      </AppText>
                    )}
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.pickupSheetClose, pressed && { opacity: 0.7 }]}
                  onPress={() => setSelectedPickup(null)}
                >
                  <MaterialCommunityIcons name="close" size={20} color={COLORS.textSecondary} />
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {/* ---- New-booking takeover card ---- */}
        {alertBooking && (
          <Animated.View style={[styles.alertOverlay, { opacity: alertAnim }]}>
            <Animated.View
              style={[
                styles.alertCard,
                {
                  transform: [
                    {
                      scale: alertAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.9, 1],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.alertHeader}>
                <View
                  style={[
                    styles.alertIconWrap,
                    {
                      transform: [
                        {
                          scale: alertPulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: [1, 1.15],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <MaterialCommunityIcons name="bell-ring-outline" size={22} color={COLORS.white} />
                </View>
                <View style={styles.alertCopy}>
                  <AppText variant="caption" style={styles.alertEyebrow}>
                    NEW BOOKING
                  </AppText>
                  <AppText variant="heading" style={styles.alertTitle}>
                    {alertBooking.passengerName || "Passenger"}
                  </AppText>
                </View>
                <View style={styles.alertCountdown}>
                  <AppText variant="heading" style={styles.alertCountdownText}>
                    {alertSecondsLeft}
                  </AppText>
                </View>
              </View>
              <View style={styles.alertMeta}>
                <View style={styles.alertMetaRow}>
                  <MaterialCommunityIcons name="map-marker-radius" size={16} color={COLORS.warning} />
                  <AppText variant="caption" style={styles.alertMetaText} numberOfLines={2}>
                    {alertBooking.pickupLocation?.address || "Pickup point"}
                  </AppText>
                </View>
                <View style={styles.alertMetaRow}>
                  <MaterialCommunityIcons name="seat-passenger" size={16} color={COLORS.warning} />
                  <AppText variant="caption" style={styles.alertMetaText}>
                    {alertBooking.seats || 1} seat{(alertBooking.seats || 1) > 1 ? "s" : ""}
                    {alertDistanceM != null ? " • " + formatDistance(alertDistanceM) + " away" : ""}
                  </AppText>
                </View>
                {alertBooking.totalPesewas ? (
                  <View style={styles.alertMetaRow}>
                    <MaterialCommunityIcons name="cash-multiple" size={16} color={COLORS.warning} />
                    <AppText variant="caption" style={styles.alertMetaText}>
                      {formatPesewas(alertBooking.totalPesewas)} total — your share is paid into your
                      wallet after the ride.
                    </AppText>
                  </View>
                ) : null}
              </View>
              <View style={styles.alertActions}>
                <Pressable
                  style={({ pressed }) => [styles.alertRejectBtn, pressed && { opacity: 0.85 }]}
                  onPress={() => void handleRejectBooking(alertBooking.id)}
                >
                  <MaterialCommunityIcons name="close" size={22} color={COLORS.danger} />
                  <AppText variant="body" style={styles.alertRejectText}>
                    Reject
                  </AppText>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.alertAcceptBtn, pressed && { opacity: 0.85 }]}
                  onPress={() => void handleConfirmBooking(alertBooking.id)}
                >
                  <MaterialCommunityIcons name="check" size={22} color={COLORS.white} />
                  <AppText variant="body" style={styles.alertAcceptText}>
                    Accept
                  </AppText>
                </Pressable>
              </View>
            </Animated.View>
          </Animated.View>
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
  chipDim: {
    opacity: 0.5,
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
    bottom: 84,
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
  panelToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  panelIconSmall: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  panelToggleText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
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
    padding: SPACING.md,
    borderRadius: 14,
    backgroundColor: COLORS.veryLightBlue,
    marginBottom: SPACING.sm,
  },
  bookingInfoRow: {
    flexDirection: "row",
    alignItems: "center",
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
  paidBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: COLORS.success,
  },
  paidBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: "700",
  },
  unpaidBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },
  unpaidBadgeText: {
    color: COLORS.accent,
    fontSize: 10,
    fontWeight: "700",
  },
  paymentWaitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  paymentWaitText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 11,
  },
  bookingActionsWide: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  rejectBtnWide: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.danger,
    backgroundColor: COLORS.white,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  rejectBtnWideText: {
    color: COLORS.danger,
    fontWeight: "700",
  },
  confirmBtnWide: {
    flex: 1.5,
    height: 52,
    borderRadius: 12,
    backgroundColor: COLORS.success,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  confirmBtnWideText: {
    color: COLORS.white,
    fontWeight: "700",
  },
  dropoffBtnWide: {
    height: 52,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: SPACING.sm,
  },
  dropoffBtnWideText: {
    color: COLORS.white,
    fontWeight: "700",
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
  pickupSheetClose: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.veryLightBlue,
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

  nextPickupCard: {
    borderRadius: 16,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    backgroundColor: COLORS.navy,
  },
  nextPickupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  nextPickupIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  nextPickupCopy: {
    flex: 1,
  },
  nextPickupEyebrow: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  nextPickupName: {
    color: COLORS.white,
    fontSize: 16,
  },
  nextPickupDistance: {
    alignItems: "flex-end",
  },
  nextPickupDistanceText: {
    color: COLORS.white,
    fontSize: 16,
  },
  nextPickupEta: {
    color: "rgba(255,255,255,0.7)",
  },
  nextPickupActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    marginTop: SPACING.md,
  },
  navigateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderRadius: 10,
  },
  navigateBtnText: {
    color: COLORS.white,
    fontWeight: "700",
  },
  nextPickupSeats: {
    color: "rgba(255,255,255,0.75)",
    flex: 1,
  },
  endTripButton: {
    marginTop: SPACING.md,
  },

  // New-booking takeover card
  alertOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    elevation: 24,
    backgroundColor: "rgba(11,23,44,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.lg,
  },
  alertCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: COLORS.navy,
    borderRadius: 20,
    padding: SPACING.lg,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 12,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  alertIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  alertCopy: {
    flex: 1,
  },
  alertEyebrow: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  alertTitle: {
    color: COLORS.white,
    fontSize: 20,
    lineHeight: 26,
  },
  alertCountdown: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: COLORS.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  alertCountdownText: {
    color: COLORS.white,
    fontSize: 18,
  },
  alertMeta: {
    gap: SPACING.xs,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  alertMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  alertMetaText: {
    color: "rgba(255,255,255,0.85)",
    flex: 1,
  },
  alertActions: {
    flexDirection: "row",
    gap: SPACING.sm,
  },
  alertRejectBtn: {
    flex: 1,
    height: 56,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: COLORS.danger,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  alertRejectText: {
    color: COLORS.danger,
    fontWeight: "800",
    fontSize: 16,
  },
  alertAcceptBtn: {
    flex: 1.4,
    height: 56,
    borderRadius: 14,
    backgroundColor: COLORS.success,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  alertAcceptText: {
    color: COLORS.white,
    fontWeight: "800",
    fontSize: 16,
  },
});
