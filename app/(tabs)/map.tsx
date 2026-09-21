import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { MapView, MapViewType, Marker, PROVIDER_DEFAULT } from "../../src/components/map/MapExports";
import { AnimatedDriverMarker } from "../../src/components/map/AnimatedDriverMarker";
import { isLocationFresh } from "../../src/utils/geo";
import { router, useLocalSearchParams } from "expo-router";

import AuthGate from "../../src/components/AuthGate";
import AppText from "../../src/components/ui/AppText";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import { TripMarker } from "../../src/components/map/TripMarker";
import { useLocation } from "../../src/contexts/LocationContext";
import { useAuth } from "../../src/contexts/AuthContext";
import { getActiveTripMarkers, subscribeActiveTripMarkers, subscribeDriverLocation, TrackedDriverLocation } from "../../src/services/map";
import { fetchRoutePath, polylineLengthMeters, splitRouteAtDriver, RoutePath } from "../../src/services/directions";
import { RouteLine } from "../../src/components/map/RouteLine";
import { haversineMeters, formatDistance, formatEta, etaFromDistance } from "../../src/utils/geo";
import StarRating from "../../src/components/ui/StarRating";
import { createBooking, cancelBooking, rateDriver, getActiveRoutes, NoSeatsError } from "../../src/services/transport";
import { auth, db } from "../../src/services/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { COLORS, SPACING } from "../../src/theme";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import { useMemo } from "react";
import { showToast } from "../../src/utils/toast";
import { getFriendlyError } from "../../src/utils/firebaseErrors";
import { formatPesewas } from "../../src/utils/money";
import { friendlyPaymentError } from "../../src/services/payments";
import {
  ActiveTripMarker,
  Route,
  TripStatus,
} from "../../src/types/models";

// Ghana/Omanjor default center (used when location is unavailable)
const DEFAULT_REGION = {
  latitude: 5.6037,
  longitude: -0.187,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
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

export default function PassengerMapScreen() {
  const { user, signOut } = useAuth();
  const { colors, isDark } = useThemeColors();
  const ds = useMemo(() => ({
    topBarText: { color: colors.text },
    topBarEyebrow: { color: colors.primary },
    chipText: { color: colors.text },
    bookingBannerText: { color: colors.text },
    sheetRoute: { color: colors.text },
    vehicleInfoValue: { color: colors.text },
    seatEditText: { color: colors.text },
    ratingTitle: { color: colors.text },
    topBar: { backgroundColor: isDark ? 'rgba(30,41,59,0.95)' : 'rgba(255,255,255,0.92)' },
    permissionBanner: { backgroundColor: colors.surface },
    chip: { backgroundColor: colors.surface, borderColor: colors.veryLightBlue },
    bookingBanner: { backgroundColor: colors.surface },
    loadingOverlay: { backgroundColor: colors.surface },
    bottomSheet: { backgroundColor: colors.surface },
    ratingCard: { backgroundColor: colors.surface },
    vehicleInfoCard: { backgroundColor: colors.veryLightBlue },
    sheetInfo: { borderColor: colors.veryLightBlue },
    iconButton: { backgroundColor: colors.blueWash },
    permissionText: { color: colors.textSecondary },
    vehicleInfoLabel: { color: colors.textSecondary },
    sheetInfoValue: { color: colors.text },
    sheetInfoLabel: { color: colors.textSecondary },
    ratingSubtitle: { color: colors.textSecondary },
    ratingSkip: { color: colors.textSecondary },
    approachingText: { color: colors.success },
    busStopBanner: { backgroundColor: colors.blueWash },
    busStopText: { color: colors.primary },
    sheetStatusText: { color: colors.white },
    chipTextSelected: { color: colors.white },
    trackingPanel: { backgroundColor: colors.surface },
    trackingPanelTitle: { color: colors.text },
    trackingPanelSub: { color: colors.textSecondary },
    sheetDistanceChip: { backgroundColor: colors.blueWash },
    sheetDistanceText: { color: colors.primary },
    recenterButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.veryLightBlue },
  }), [colors, isDark]);
  const params = useLocalSearchParams<{ routeId?: string }>();
  const {
    status: permissionStatus,
    location,
    loading: locationLoading,
    deniedMessage,
    requestPermission,
  } = useLocation();

  const mapRef = useRef<MapViewType>(null);

  // Route & trip data
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(
    params.routeId ?? null
  );
  const [markers, setMarkers] = useState<ActiveTripMarker[]>([]);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [bookingTripId, setBookingTripId] = useState<string | null>(null);
  const [lastBookingId, setLastBookingId] = useState<string | null>(null);
  const [lastBookingStatus, setLastBookingStatus] = useState<string | null>(null);
  // Latest booking document: fare, seats, payment window and refund state all
  // come from here so the banner never has to guess.
  const [bookingDoc, setBookingDoc] = useState<Record<string, any> | null>(null);
  // Only announce a status change once, even if the doc updates again.
  const toastedStatusRef = useRef<string | null>(null);
  const [cancelledMeta, setCancelledMeta] = useState<{ cancelledBy?: string; cancelReason?: string } | null>(null);
  const [cancellingBooking, setCancellingBooking] = useState(false);
  const [bookingSeats, setBookingSeats] = useState(1);
  const [trackedDriverId, setTrackedDriverId] = useState<string | null>(null);
  const [trackedDriverLocation, setTrackedDriverLocation] = useState<TrackedDriverLocation | null>(null);
  const [showRating, setShowRating] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [submittingRating, setSubmittingRating] = useState(false);
  const [tripToRate, setTripToRate] = useState<{ tripId: string; driverId: string } | null>(null);
  const [remainingSeats, setRemainingSeats] = useState<number | null>(null);
  const [routePath, setRoutePath] = useState<RoutePath | null>(null);
  const [routedFrom, setRoutedFrom] = useState<{ latitude: number; longitude: number } | null>(null);
  const routeFetchRef = useRef(0);
  const trackedLocRef = useRef<TrackedDriverLocation | null>(null);
  // Camera follow: recenter gently while the driver moves, pause when the
  // passenger pans the map manually, resume from the recenter button.
  const [cameraFollow, setCameraFollow] = useState(true);
  const followLastRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const pickupLastRef = useRef<{ latitude: number; longitude: number } | null>(null);

  // Selected trip for bottom sheet
  const [selectedMarker, setSelectedMarker] =
    useState<ActiveTripMarker | null>(null);
  // Seats requested for the booking currently being placed (1–4)
  const [requestedSeats, setRequestedSeats] = useState(1);

  // Load routes on mount
  useEffect(() => {
    getActiveRoutes()
      .then((activeRoutes) => {
        setRoutes(activeRoutes);
      })
      .catch((error) => {
        console.error("Failed to load routes:", error);
      });
  }, []);

  // Subscribe to real-time trip marker updates when route selection changes
  useEffect(() => {
    setLoadingTrips(true);

    if (selectedRouteId) {
      // Subscribe to real-time updates for a specific route
      const unsubscribe = subscribeActiveTripMarkers(
        selectedRouteId,
        (updatedMarkers) => {
          setMarkers(updatedMarkers);
          setLoadingTrips(false);
        },
        (error) => {
          console.error("[passenger map] marker listener failed:", error);
          showToast("error", "Connection problem", "Live driver positions may be unavailable.");
          setLoadingTrips(false);
        }
      );
      return unsubscribe;
    } else {
      // For "all routes", do initial fetch then subscribe to trip changes
      getActiveTripMarkers()
        .then(setMarkers)
        .catch(() => setMarkers([]))
        .finally(() => setLoadingTrips(false));

      // Re-fetch every 30 seconds for "all routes" view
      const interval = setInterval(() => {
        getActiveTripMarkers()
          .then(setMarkers)
          .catch(() => {});
      }, 30000);

      return () => clearInterval(interval);
    }
  }, [selectedRouteId]);

  // Ghost-driver guard: prune markers whose driver stopped publishing
  // (app closed) even if Firestore hasn't pushed a fresh snapshot lately.
  useEffect(() => {
    const interval = setInterval(() => {
      setMarkers((prev) => {
        const next = prev.filter((m) => isLocationFresh(m.locationUpdatedAt));
        return next.length === prev.length ? prev : next;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Re-center map when user location becomes available
  useEffect(() => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.08,
          longitudeDelta: 0.08,
        },
        500
      );
    }
  }, [location]);

  const handleMarkerPress = useCallback((marker: ActiveTripMarker) => {
    setSelectedMarker(marker);
    // Default seat request to 1, capped at what's actually available
    setRequestedSeats(Math.min(1, Math.max(1, marker.availableSeats || 1)));
    if (mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: marker.driverLocation.latitude,
          longitude: marker.driverLocation.longitude,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        },
        400
      );
    }
  }, []);

  // Subscribe to booking status when we have a lastBookingId
  useEffect(() => {
    if (!lastBookingId) return;

    const unsubscribe = onSnapshot(
      doc(db, "bookings", lastBookingId),
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setBookingDoc({ ...data, id: snapshot.id });
          setLastBookingStatus(data.status);
          setCancelledMeta({
            cancelledBy: data.cancelledBy,
            cancelReason: data.cancelReason,
          });

          // Announce each state once, not on every field change.
          const isNewStatus = toastedStatusRef.current !== data.status;
          toastedStatusRef.current = data.status;
          if (!isNewStatus) return;

          if (data.status === "awaiting_payment") {
            showToast(
              "success",
              "Driver accepted",
              "Complete payment to secure your seat."
            );
          } else if (data.status === "confirmed") {
            showToast("success", "Payment received", "Your seat is confirmed. Have a safe trip!");
          } else if (data.status === "expired") {
            showToast(
              "info",
              "Payment window closed",
              "Your seats were released. You can book another ride."
            );
          } else if (data.status === "cancelled") {
            const msg =
              data.cancelledBy === "passenger"
                ? "Booking cancelled"
                : data.cancelReason === "driver_no_response"
                  ? "Booking expired"
                  : "Booking declined";
            const detail =
              data.cancelledBy === "passenger"
                ? "You cancelled this booking."
                : data.cancelReason === "driver_no_response"
                  ? "The driver didn't respond in time."
                  : "The driver could not take this booking.";
            showToast("info", msg, detail);
          } else if (data.status === "completed") {
            setTripToRate({ tripId: data.tripId || "", driverId: data.driverId || "" });
            setShowRating(true);
          }
        }
      }
    );

    return unsubscribe;
  }, [lastBookingId]);

  const handleBookTrip = useCallback(
    async (marker: ActiveTripMarker) => {
      const passengerId = auth.currentUser?.uid;
      if (!passengerId) {
        showToast("error", "Not signed in", "Please sign in to book a trip.");
        return;
      }

      // One active booking at a time — while a booking is pending or
      // confirmed, the passenger cannot place another one.
      if (
        lastBookingId &&
        (lastBookingStatus === "pending" ||
          lastBookingStatus === "awaiting_payment" ||
          lastBookingStatus === "confirmed")
      ) {
        showToast("info", "Booking in progress", "You already have an active booking. Finish or cancel it before booking another ride.");
        return;
      }

      setBookingTripId(marker.trip.id);
      // Never send a booking the driver cannot fulfil — without this
      // the passenger could reserve seats a full tro-tro doesn't have.
      const seatsLeft = marker.availableSeats ?? 0;
      if (seatsLeft <= 0) {
        showToast("error", "No seats left", "This tro-tro is full. Please pick another ride.");
        setSelectedMarker(null);
        return;
      }
      // The driver navigates to the pickup COORDINATES, so a booking without
      // a real passenger position sends them to the wrong place.
      const passengerLat = location?.coords?.latitude;
      const passengerLng = location?.coords?.longitude;
      if (passengerLat == null || passengerLng == null) {
        showToast("info", "Location needed", "Turn on location so your driver can find you, then book again.");
        setSelectedMarker(null);
        return;
      }
      // Hard cap of 3 seats per booking
      const seatsToBook = Math.min(3, requestedSeats, seatsLeft);

      try {
        const bookingId = await createBooking({
          passengerId,
          driverId: marker.trip.driverId,
          routeId: marker.trip.routeId ?? "",
          pickupLocation: {
            // The passenger's real current position — where the driver must go.
            latitude: passengerLat,
            longitude: passengerLng,
            address: marker.trip.origin || "Pickup",
          },
          dropOffLocation: {
            // Route destinations are name pairs with no stored coordinates,
            // so the honest value is the labelled address.
            latitude: 0,
            longitude: 0,
            address: marker.trip.destination || "Drop-off",
          },
          seats: seatsToBook,
        });
        setLastBookingId(bookingId);
        setLastBookingStatus("pending");
        setBookingSeats(seatsToBook);
        setTrackedDriverId(marker.trip.driverId);
        showToast(
          "success",
          "Booking sent",
          `Requested ${seatsToBook} seat${seatsToBook > 1 ? "s" : ""} — your driver will confirm shortly.`
        );
        setSelectedMarker(null);

        // Refresh markers so seat count updates on the map
        getActiveTripMarkers(selectedRouteId ?? undefined)
          .then(setMarkers)
          .catch(() => {});
      } catch (error) {
        // Log full detail for diagnosis, show a friendly line to the user
        console.error("[map] createBooking failed:", error);
        showToast(
          "error",
          "Booking failed",
          error instanceof NoSeatsError
            ? error.message
            : getFriendlyError(error)
        );
      } finally {
        setBookingTripId(null);
      }
    },
    [selectedRouteId, requestedSeats, lastBookingId, lastBookingStatus, location]
  );

  // Subscribe to driver location when booking is confirmed
  useEffect(() => {
    if (lastBookingStatus !== "confirmed" || !trackedDriverId) {
      setTrackedDriverLocation(null);
      return;
    }

    const unsubscribe = subscribeDriverLocation(trackedDriverId, (location) => {
      trackedLocRef.current = location;
      setTrackedDriverLocation(location);
    });

    return unsubscribe;
  }, [lastBookingStatus, trackedDriverId]);

  // Bolt-style road route: fetch driver→pickup route, refetch after either
  // end moves far enough that the line no longer matches reality.
  useEffect(() => {
    if (lastBookingStatus !== "confirmed" || !trackedDriverLocation || !location) {
      setRoutePath(null);
      setRoutedFrom(null);
      return;
    }
    const driverPos = { latitude: trackedDriverLocation.latitude, longitude: trackedDriverLocation.longitude };
    const pickup = { latitude: location.coords.latitude, longitude: location.coords.longitude };
    const driverMoved = routedFrom && haversineMeters(routedFrom, driverPos) >= 300;
    const pickupMoved = pickupLastRef.current && haversineMeters(pickupLastRef.current, pickup) >= 75;
    if (routedFrom && !driverMoved && !pickupMoved) return;
    pickupLastRef.current = pickup;

    const ticket = ++routeFetchRef.current;
    fetchRoutePath(driverPos, pickup)
      .then((path) => {
        if (ticket === routeFetchRef.current) {
          setRoutePath(path);
          setRoutedFrom(driverPos);
        }
      })
      .catch(() => {});
  }, [lastBookingStatus, trackedDriverLocation, location, routedFrom]);

  // Camera follow: as the driver moves, keep driver + passenger in frame.
  // Only recenters when the driver has moved meaningfully (>30 m) so the
  // map doesn't jitter on every GPS blip, and never fights the passenger's
  // own panning (cameraFollow pauses on drag; recenter button resumes it).
  useEffect(() => {
    if (
      !cameraFollow ||
      lastBookingStatus !== "confirmed" ||
      !trackedDriverLocation ||
      !location ||
      !mapRef.current
    ) {
      return;
    }
    const driverPos = { latitude: trackedDriverLocation.latitude, longitude: trackedDriverLocation.longitude };
    const passengerPos = { latitude: location.coords.latitude, longitude: location.coords.longitude };
    if (followLastRef.current && haversineMeters(followLastRef.current, driverPos) < 30) return;
    followLastRef.current = driverPos;

    const lats = [driverPos.latitude, passengerPos.latitude];
    const lngs = [driverPos.longitude, passengerPos.longitude];
    mapRef.current.animateToRegion(
      {
        latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
        longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
        latitudeDelta: Math.max(0.012, (Math.max(...lats) - Math.min(...lats)) * 1.9),
        longitudeDelta: Math.max(0.012, (Math.max(...lngs) - Math.min(...lngs)) * 1.9),
      },
      650
    );
  }, [cameraFollow, lastBookingStatus, trackedDriverLocation, location]);

  // Fit camera to driver + passenger once tracking begins
  useEffect(() => {
    if (lastBookingStatus !== "confirmed" || !trackedDriverId) return;
    const timer = setTimeout(() => {
      const driverPos = trackedLocRef.current;
      if (!driverPos || !mapRef.current) return;
      const points: { latitude: number; longitude: number }[] = [driverPos];
      if (location) {
        points.push({ latitude: location.coords.latitude, longitude: location.coords.longitude });
      }
      const lats = points.map((p) => p.latitude);
      const lngs = points.map((p) => p.longitude);
      mapRef.current.animateToRegion(
        {
          latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
          longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
          latitudeDelta: Math.max(0.02, (Math.max(...lats) - Math.min(...lats)) * 1.9),
          longitudeDelta: Math.max(0.02, (Math.max(...lngs) - Math.min(...lngs)) * 1.9),
        },
        600
      );
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBookingStatus, trackedDriverId]);

  // Live driver→passenger metrics for the tracking panel.
  // Freshness matters: a stale Firestore position (driver app closed or
  // not yet publishing) must never claim "arrived" or "approaching".
  const driverFixIsFresh = trackedDriverLocation ? isLocationFresh(trackedDriverLocation.updatedAt) : false;
  const liveDriverM =
    trackedDriverLocation && location
      ? haversineMeters(trackedDriverLocation, {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        })
      : null;
  const driverArrived = driverFixIsFresh && liveDriverM != null && liveDriverM < 60;
  const driverApproaching = driverFixIsFresh && !driverArrived && liveDriverM != null && liveDriverM < 500;
  const remainingRouteM =
    routePath && trackedDriverLocation
      ? polylineLengthMeters(splitRouteAtDriver(routePath.coordinates, trackedDriverLocation).remaining)
      : liveDriverM;
  const fullRouteM = routePath ? polylineLengthMeters(routePath.coordinates) : 0;
  const etaMinutes =
    routePath?.fromRoads && routePath.durationSeconds > 0 && fullRouteM > 0 && remainingRouteM != null
      ? (routePath.durationSeconds / 60) * Math.min(1, remainingRouteM / fullRouteM)
      : remainingRouteM != null
        ? etaFromDistance(remainingRouteM)
        : null;
  const selectedDistanceM =
    selectedMarker && location
      ? haversineMeters(selectedMarker.driverLocation, {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        })
      : null;

  const handleCancelBooking = useCallback(async () => {
    if (!lastBookingId || !user?.uid) return;
    setCancellingBooking(true);
    try {
      await cancelBooking(lastBookingId, "passenger", trackedDriverId ?? undefined);
      toastedStatusRef.current = "cancelled";
      setLastBookingStatus("cancelled");
      setCancelledMeta({ cancelledBy: "passenger", cancelReason: "cancelled_by_passenger" });
      showToast("info", "Booking cancelled", "Your booking has been cancelled.");
    } catch (error) {
      showToast("error", "Cancel failed", friendlyPaymentError(error));
    } finally {
      setCancellingBooking(false);
    }
  }, [lastBookingId, user?.uid, trackedDriverId]);

  // Human-readable reason a booking ended, derived from who cancelled and why
  const cancelledBannerText = (
    data: { cancelledBy?: string; cancelReason?: string } | null
  ): string => {
    if (data?.cancelledBy === "passenger") {
      return "You cancelled this booking.";
    }
    switch (data?.cancelReason) {
      case "trip_ended":
      case "driver_offline":
      case "driver_inactive":
        return "Your trip ended. Try booking another ride.";
      case "driver_no_response":
        return "The driver didn't respond in time. Try another ride.";
      case "payment_expired":
        return "Payment wasn't completed in time, so your seats were released.";
      case "cancelled_by_driver":
        return "The driver cancelled this ride. Any payment you made is being refunded.";
      case "rejected_by_driver":
      default:
        return "Booking REJECTED by driver. Try booking another ride.";
    }
  };

  // Dismiss a finished booking (cancelled) so the passenger can book again cleanly
  const handleDismissBooking = useCallback(() => {
    setLastBookingId(null);
    setLastBookingStatus(null);
    setCancelledMeta(null);
    setBookingTripId(null);
    setTrackedDriverId(null);
    setTrackedDriverLocation(null);
  }, []);

  // Get remaining seats from the tracked trip
  useEffect(() => {
    if (!trackedDriverId || lastBookingStatus !== "confirmed") {
      setRemainingSeats(null);
      return;
    }
    // Find the trip marker that matches this driver
    const marker = markers.find(m => m.trip.driverId === trackedDriverId);
    if (marker) {
      setRemainingSeats(marker.availableSeats);
    }
  }, [trackedDriverId, lastBookingStatus, markers]);

  const handleSubmitRating = useCallback(async () => {
    if (!tripToRate || !user?.uid || ratingValue === 0) return;
    setSubmittingRating(true);
    try {
      await rateDriver(tripToRate.tripId, tripToRate.driverId, user.uid, ratingValue);
      showToast("success", "Thanks!", "Your rating has been submitted.");
      setShowRating(false);
      setRatingValue(0);
      setTripToRate(null);
    } catch {
      showToast("error", "Rating failed", "Could not submit rating. Please try again.");
    } finally {
      setSubmittingRating(false);
    }
  }, [tripToRate, user?.uid, ratingValue]);

  const userRegion = location
    ? {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      }
    : DEFAULT_REGION;

  return (
    <AuthGate allowedRoles={["passenger"]}>
      <View style={styles.container}>
        {/* ---- Map ---- */}
        <MapView
          ref={mapRef}
          style={styles.map}
          provider={PROVIDER_DEFAULT}
          showsUserLocation={permissionStatus === "granted"}
          showsMyLocationButton={false}
          initialRegion={userRegion}
          onPanDrag={() => setCameraFollow(false)}
        >
          {/* Trip markers */}
          {markers.map((marker) => (
            <TripMarker
              key={marker.trip.id}
              marker={marker}
              onPress={() => handleMarkerPress(marker)}
            />
          ))}

          {/* Bolt-style gliding/rotating marker for the confirmed booking */}
          {lastBookingStatus === "confirmed" && trackedDriverLocation && (
            <AnimatedDriverMarker location={trackedDriverLocation} />
          )}

          {/* Bolt-style road route line (driver → pickup) */}
          {lastBookingStatus === "confirmed" && trackedDriverLocation && routePath && location && (
            <RouteLine
              driver={trackedDriverLocation}
              destination={{ latitude: location.coords.latitude, longitude: location.coords.longitude }}
              coordinates={routePath.coordinates}
            />
          )}
        </MapView>

        {/* ---- Top bar ---- */}
        <View style={[styles.topBar, ds.topBar]}>
          <Pressable style={[styles.iconButton, ds.iconButton]} onPress={() => router.navigate("/home")}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.primary} />
          </Pressable>

          <View style={styles.topBarTitle}>
            <AppText variant="caption" style={[styles.topBarEyebrow, ds.topBarEyebrow]}>EASYTROLSKI MAP</AppText>
            <AppText variant="heading" style={[styles.topBarText, ds.topBarText]}>Find a ride</AppText>
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
              {deniedMessage || "Location permission needed for nearby routes"}
            </AppText>
          </Pressable>
        )}

        {permissionStatus === "undetermined" && !locationLoading && (
          <Pressable style={[styles.permissionBanner, ds.permissionBanner]} onPress={() => requestPermission()}>
            <MaterialCommunityIcons name="map-marker-plus" size={18} color={COLORS.primary} />
            <AppText variant="caption" style={[styles.permissionText, { color: COLORS.primary }]}>
              Tap to enable location and see nearby routes
            </AppText>
          </Pressable>
        )}

        {/* ---- Route filter chips ---- */}
        <View style={styles.routeChipsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.routeChips}
          >
            <Pressable
              style={[styles.chip, ds.chip, !selectedRouteId && styles.chipSelected]}
              onPress={() => setSelectedRouteId(null)}
            >
              <AppText
                variant="caption"
                style={[styles.chipText, ds.chipText, !selectedRouteId && styles.chipTextSelected]}
              >
                All routes
              </AppText>
            </Pressable>

            {routes.map((route) => (
              <Pressable
                key={route.id}
                style={[
                  styles.chip,
                  ds.chip,
                  selectedRouteId === route.id && styles.chipSelected,
                ]}
                onPress={() =>
                  setSelectedRouteId(
                    selectedRouteId === route.id ? null : route.id
                  )
                }
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

        {/* ---- Live tracking panel (Bolt-style) ---- */}
        {lastBookingStatus === "confirmed" && (
          <View style={[styles.trackingPanel, ds.trackingPanel]}>
            <View style={styles.trackingPanelIcon}>
              <MaterialCommunityIcons
                name={driverArrived ? "map-marker-check" : !driverFixIsFresh ? "map-marker-question" : driverApproaching ? "bus-alert" : "map-marker-path"}
                size={20}
                color={driverApproaching || driverArrived ? COLORS.success : COLORS.primary}
              />
            </View>
            <View style={styles.trackingPanelCopy}>
              <AppText variant="heading" style={[styles.trackingPanelTitle, ds.trackingPanelTitle]}>
                {driverArrived
                  ? "Your driver has arrived"
                  : !driverFixIsFresh
                    ? "Locating your driver…"
                    : liveDriverM != null
                      ? `Driver is ${formatDistance(liveDriverM)} away${etaMinutes != null ? ` • ${formatEta(etaMinutes)}` : ""}`
                      : "Tracking your driver"}
              </AppText>
              <AppText variant="caption" style={[styles.trackingPanelSub, ds.trackingPanelSub]}>
                {driverArrived
                  ? "Get ready — your driver is close"
                  : !driverFixIsFresh
                    ? "Waiting for the driver's live position"
                    : driverApproaching
                      ? "Get ready — your driver is close"
                      : routePath?.fromRoads
                        ? "Live route to your pickup"
                        : "Direct line — road routing unavailable"}
              </AppText>
            </View>
          </View>
        )}

        {/* Resume camera follow after the passenger pans away */}
        {lastBookingStatus === "confirmed" && !cameraFollow && (
          <Pressable
            accessibilityLabel="Recenter map on driver"
            onPress={() => {
              followLastRef.current = null;
              setCameraFollow(true);
            }}
            style={[styles.recenterButton, ds.recenterButton]}
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={20} color={COLORS.primary} />
          </Pressable>
        )}

        {/* ---- Booking status banner (hidden once the trip is completed) ---- */}
        {lastBookingId && lastBookingStatus && lastBookingStatus !== "completed" && (
          <View style={[
            styles.bookingBanner,
            ds.bookingBanner,
            { top: lastBookingStatus === "confirmed" ? 300 : 240 },
            lastBookingStatus === "confirmed" && styles.bookingBannerSuccess,
            lastBookingStatus === "awaiting_payment" && styles.bookingBannerAction,
            (lastBookingStatus === "cancelled" || lastBookingStatus === "expired") && styles.bookingBannerError,
          ]}>
            <MaterialCommunityIcons
              name={
                lastBookingStatus === "confirmed" ? "check-circle" :
                lastBookingStatus === "awaiting_payment" ? "credit-card-clock-outline" :
                (lastBookingStatus === "cancelled" || lastBookingStatus === "expired") ? "close-circle" :
                "clock-outline"
              }
              size={18}
              color={
                lastBookingStatus === "confirmed" ? COLORS.success :
                lastBookingStatus === "awaiting_payment" ? COLORS.primary :
                (lastBookingStatus === "cancelled" || lastBookingStatus === "expired") ? COLORS.danger :
                COLORS.warning
              }
            />
            <AppText variant="caption" style={[styles.bookingBannerText, ds.bookingBannerText]}>
              {lastBookingStatus === "confirmed"
                ? `Seat confirmed — ${bookingDoc?.seats ?? bookingSeats} seat${(bookingDoc?.seats ?? bookingSeats) > 1 ? 's' : ''} paid for.${remainingSeats !== null ? ` ${remainingSeats} seat${remainingSeats !== 1 ? 's' : ''} remaining.` : ''} Your driver is on the way.`
                : lastBookingStatus === "awaiting_payment"
                  ? `Driver ACCEPTED — pay ${formatPesewas(bookingDoc?.totalPesewas)} to reserve your seat${(bookingDoc?.seats ?? 1) > 1 ? 's' : ''}.`
                  : lastBookingStatus === "expired"
                    ? "Payment wasn't completed in time, so your seats were released."
                    : lastBookingStatus === "cancelled"
                      ? cancelledBannerText(cancelledMeta)
                      : "Waiting for the driver to ACCEPT or REJECT your booking…"}
            </AppText>
            {lastBookingStatus === "awaiting_payment" ? (
              <View style={styles.bannerActions}>
                <Pressable
                  style={({ pressed }) => [styles.payNowBtn, pressed && { opacity: 0.85 }]}
                  onPress={() => {
                    if (lastBookingId) router.push(`/booking/pay?bookingId=${lastBookingId}`);
                  }}
                >
                  <AppText variant="caption" style={styles.payNowText}>Pay now</AppText>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.cancelBookingBtn, pressed && { opacity: 0.7 }]}
                  onPress={() => void handleCancelBooking()}
                  disabled={cancellingBooking}
                >
                  <MaterialCommunityIcons name="close" size={14} color={COLORS.danger} />
                </Pressable>
              </View>
            ) : (lastBookingStatus === "cancelled" || lastBookingStatus === "expired") ? (
              <Pressable
                style={({ pressed }) => [styles.dismissBookingBtn, pressed && { opacity: 0.7 }]}
                onPress={handleDismissBooking}
              >
                <MaterialCommunityIcons name="close" size={16} color={COLORS.textSecondary} />
              </Pressable>
            ) : lastBookingStatus === "pending" ? (
              <Pressable
                style={({ pressed }) => [styles.cancelBookingBtn, pressed && { opacity: 0.7 }]}
                onPress={() => void handleCancelBooking()}
                disabled={cancellingBooking}
              >
                <MaterialCommunityIcons name="close" size={14} color={COLORS.danger} />
              </Pressable>
            ) : null}
          </View>
        )}

        {/* ---- Loading indicator for trips ---- */}
        {loadingTrips && (
          <View style={[styles.loadingOverlay, ds.loadingOverlay]}>
            <ActivityIndicator size="small" color={COLORS.primary} />
          </View>
        )}

        {/* ---- Bottom sheet: selected trip detail ---- */}
        {selectedMarker && (
          <View style={[styles.bottomSheet, ds.bottomSheet]}>
            <View style={styles.handle} />
            <View style={styles.sheetContent}>
              {/* Route header */}
              <View style={styles.sheetHeader}>
                <View style={styles.sheetRouteIcon}>
                  <MaterialCommunityIcons
                    name="bus"
                    size={20}
                    color={COLORS.primary}
                  />
                </View>
                <View style={styles.sheetRouteCopy}>
                  <AppText variant="heading" style={[styles.sheetRoute, ds.sheetRoute]}>
                    {selectedMarker.trip.origin || "Origin"} →{" "}
                    {selectedMarker.trip.destination || "Destination"}
                  </AppText>
                  <View style={styles.sheetStatusRow}>
                    <View
                      style={[
                        styles.sheetStatusBadge,
                        {
                          backgroundColor: tripStatusColor(
                            selectedMarker.trip.status
                          ),
                        },
                      ]}
                    >
                      <AppText variant="caption" style={styles.sheetStatusText}>
                        {tripStatusLabel(selectedMarker.trip.status)}
                      </AppText>
                    </View>
                    {selectedDistanceM != null && (
                      <View style={[styles.sheetDistanceChip, ds.sheetDistanceChip]}>
                        <MaterialCommunityIcons name="map-marker-distance" size={12} color={COLORS.primary} />
                        <AppText variant="caption" style={[styles.sheetDistanceText, ds.sheetDistanceText]}>
                          {formatDistance(selectedDistanceM)} from you
                        </AppText>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {/* Vehicle info */}
              <View style={[styles.vehicleInfoCard, ds.vehicleInfoCard]}>
                <View style={styles.vehicleInfoRow}>
                  <MaterialCommunityIcons name="steering" size={16} color={COLORS.primary} />
                  <AppText variant="caption" style={[styles.vehicleInfoLabel, ds.vehicleInfoLabel]}>Driver</AppText>
                  <AppText variant="heading" style={[styles.vehicleInfoValue, ds.vehicleInfoValue]}>
                    {selectedMarker.trip.driverName || "Driver"}
                  </AppText>
                </View>
                {selectedMarker.trip.vehiclePlate && (
                  <View style={styles.vehicleInfoRow}>
                    <MaterialCommunityIcons name="car" size={16} color={COLORS.primary} />
                    <AppText variant="caption" style={[styles.vehicleInfoLabel, ds.vehicleInfoLabel]}>Plate</AppText>
                    <AppText variant="heading" style={[styles.vehicleInfoValue, ds.vehicleInfoValue]}>
                      {selectedMarker.trip.vehiclePlate}
                    </AppText>
                  </View>
                )}
                {(selectedMarker.trip.vehicleColor || selectedMarker.trip.vehicleBrand) && (
                  <View style={styles.vehicleInfoRow}>
                    <MaterialCommunityIcons name="palette" size={16} color={COLORS.primary} />
                    <AppText variant="caption" style={[styles.vehicleInfoLabel, ds.vehicleInfoLabel]}>Vehicle</AppText>
                    <AppText variant="heading" style={[styles.vehicleInfoValue, ds.vehicleInfoValue]}>
                      {[selectedMarker.trip.vehicleColor, selectedMarker.trip.vehicleBrand].filter(Boolean).join(" ")}
                    </AppText>
                  </View>
                )}
              </View>

              {/* Seats + seat picker */}
              <View style={[styles.sheetInfo, ds.sheetInfo]}>
                <View style={styles.sheetInfoItem}>
                  <MaterialCommunityIcons
                    name="seat"
                    size={18}
                    color={COLORS.primary}
                  />
                  <View>
                    <AppText variant="heading" style={[styles.sheetInfoValue, ds.sheetInfoValue]}>
                      {selectedMarker.availableSeats ?? 0}
                    </AppText>
                    <AppText variant="caption" style={[styles.sheetInfoLabel, ds.sheetInfoLabel]}>
                      seats left
                    </AppText>
                  </View>
                </View>
                {(selectedMarker.availableSeats ?? 0) > 0 && (
                  <View style={styles.sheetInfoItem}>
                    <MaterialCommunityIcons name="ticket-confirmation" size={18} color={COLORS.primary} />
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Pressable
                        style={styles.seatPickerBtn}
                        onPress={() => setRequestedSeats(Math.max(1, requestedSeats - 1))}
                      >
                        <MaterialCommunityIcons name="minus" size={16} color={COLORS.primary} />
                      </Pressable>
                      <AppText variant="heading" style={[styles.seatPickerValue, ds.sheetInfoValue]}>
                        {requestedSeats}
                      </AppText>
                      <Pressable
                        style={styles.seatPickerBtn}
                        onPress={() =>
                          setRequestedSeats(Math.min(3, selectedMarker.availableSeats ?? 1, requestedSeats + 1))
                        }
                      >
                        <MaterialCommunityIcons name="plus" size={16} color={COLORS.primary} />
                      </Pressable>
                    </View>
                    <AppText variant="caption" style={[styles.sheetInfoLabel, ds.sheetInfoLabel]}>
                      book seats
                    </AppText>
                  </View>
                )}
                {selectedMarker.trip.vehicleCapacity && (
                  <View style={styles.sheetInfoItem}>
                    <MaterialCommunityIcons
                      name="bus-side"
                      size={18}
                      color={COLORS.textSecondary}
                    />
                    <View>
                      <AppText variant="heading" style={[styles.sheetInfoValue, ds.sheetInfoValue]}>
                        {selectedMarker.trip.vehicleCapacity}
                      </AppText>
                      <AppText variant="caption" style={[styles.sheetInfoLabel, ds.sheetInfoLabel]}>
                        capacity
                      </AppText>
                    </View>
                  </View>
                )}
              </View>

              <View style={styles.sheetActions}>
                <PrimaryButton
                  title={
                    bookingTripId === selectedMarker.trip.id
                      ? "Booking..."
                      : (selectedMarker.availableSeats ?? 0) <= 0
                        ? "No seats available"
                        : `Book ${requestedSeats} seat${requestedSeats > 1 ? "s" : ""} — ${selectedMarker.trip.origin} → ${selectedMarker.trip.destination}`
                  }
                  onPress={() => void handleBookTrip(selectedMarker)}
                  disabled={
                    selectedMarker.trip.status === "completed" ||
                    selectedMarker.trip.status === "cancelled" ||
                    bookingTripId !== null ||
                    (selectedMarker.availableSeats ?? 0) <= 0 ||
                    (lastBookingId !== null && (lastBookingStatus === "pending" || lastBookingStatus === "confirmed"))
                  }
                  style={styles.bookButton}
                />
                <PrimaryButton
                  title="Close"
                  onPress={() => setSelectedMarker(null)}
                  variant="outline"
                />
              </View>
            </View>
          </View>
        )}

        {/* ── Rating modal ── */}
        {showRating && (
          <View style={styles.ratingOverlay}>
            <View style={[styles.ratingCard, ds.ratingCard]}>
              <MaterialCommunityIcons name="star-circle" size={48} color={COLORS.accent} />
              <AppText variant="heading" style={[styles.ratingTitle, ds.ratingTitle]}>Rate your trip</AppText>
              <AppText variant="body" style={[styles.ratingSubtitle, ds.ratingSubtitle]}>How was your ride?</AppText>
              <StarRating value={ratingValue} onChange={setRatingValue} size={40} />
              <PrimaryButton
                title={submittingRating ? "Submitting..." : "Submit rating"}
                onPress={() => void handleSubmitRating()}
                disabled={submittingRating || ratingValue === 0}
                style={styles.ratingSubmitBtn}
              />
              <Pressable onPress={() => { setShowRating(false); setRatingValue(0); }}>
                <AppText variant="caption" style={[styles.ratingSkip, ds.ratingSkip]}>Skip for now</AppText>
              </Pressable>
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
    fontSize: 20,
    lineHeight: 26,
  },

  // Permission banners
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

  // Route chips
  routeChipsContainer: {
    position: "absolute",
    top: 190,
    left: 0,
    right: 0,
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

  // Driver approaching
  approachingBanner: {
    position: "absolute",
    top: 240,
    left: SPACING.md,
    right: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 14,
    backgroundColor: COLORS.success + "15",
    borderWidth: 1,
    borderColor: COLORS.success + "40",
    zIndex: 10,
  },
  approachingText: {
    flex: 1,
    color: COLORS.success,
    fontSize: 13,
    fontWeight: "700",
  },

  // Bus stop banner
  busStopBanner: {
    position: "absolute",
    top: 240,
    left: SPACING.md,
    right: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 14,
    backgroundColor: COLORS.blueWash,
    borderWidth: 1,
    borderColor: COLORS.primary + "30",
  },
  busStopText: {
    flex: 1,
    color: COLORS.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
  },

  // Booking banner
  bookingBannerSuccess: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.success,
  },
  bookingBannerError: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.danger,
  },
  bookingBanner: {
    position: "absolute",
    top: 240,
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
  bookingBannerText: {
    flex: 1,
    color: COLORS.navy,
    fontSize: 12,
    lineHeight: 16,
  },
  dismissBookingBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.veryLightBlue,
  },
  cancelBookingBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E2",
  },

  /** Payment is owed: highlight the banner so the CTA is unmissable. */
  bookingBannerAction: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },

  bannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },

  payNowBtn: {
    paddingVertical: 6,
    paddingHorizontal: SPACING.md,
    borderRadius: 10,
    backgroundColor: COLORS.primary,
  },

  payNowText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  // Loading
  loadingOverlay: {
    position: "absolute",
    top: 230,
    alignSelf: "center",
    backgroundColor: COLORS.white,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 12,
  },

  // Bottom sheet
  bottomSheet: {
    position: "absolute",
    bottom: 84,
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
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.veryLightBlue,
    alignSelf: "center",
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  sheetContent: {
    paddingHorizontal: SPACING.lg,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  sheetRouteIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  sheetRouteCopy: {
    flex: 1,
  },
  sheetRoute: {
    color: COLORS.navy,
    fontSize: 18,
    lineHeight: 24,
  },
  sheetStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  sheetStatusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 10,
  },
  sheetStatusText: {
    color: COLORS.white,
    fontSize: 11,
    fontWeight: "600",
  },
  sheetPlate: {
    color: COLORS.textSecondary,
    fontWeight: "600",
  },
  vehicleInfoCard: {
    padding: SPACING.md,
    borderRadius: 14,
    backgroundColor: COLORS.veryLightBlue,
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  vehicleInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  vehicleInfoLabel: {
    color: COLORS.textSecondary,
    width: 50,
  },
  vehicleInfoValue: {
    color: COLORS.navy,
    fontSize: 14,
    flex: 1,
  },
  sheetInfo: {
    flexDirection: "row",
    gap: SPACING.xl,
    marginBottom: SPACING.md,
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.veryLightBlue,
  },
  sheetInfoItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  sheetInfoValue: {
    color: COLORS.navy,
    fontSize: 20,
  },
  sheetInfoLabel: {
    color: COLORS.textSecondary,
    marginTop: -2,
  },
  sheetActions: {
    gap: SPACING.sm,
  },
  bookButton: {
    marginBottom: SPACING.xs,
  },
  seatPickerBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  seatPickerValue: {
    minWidth: 28,
    textAlign: "center",
    marginHorizontal: 6,
  },

  /* ── Live tracking ── */
  trackingPanel: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 240,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.md,
    borderRadius: 16,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
  trackingPanelIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.blueWash,
    alignItems: "center",
    justifyContent: "center",
  },
  trackingPanelCopy: {
    flex: 1,
  },
  trackingPanelTitle: {
    fontSize: 14,
    color: COLORS.navy,
  },
  trackingPanelSub: {
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  sheetDistanceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.blueWash,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  sheetDistanceText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: "600",
  },
  recenterButton: {
    position: "absolute",
    right: 16,
    bottom: 260,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.navy,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },

  /* ── Rating modal ── */
  ratingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  ratingCard: {
    width: "85%",
    backgroundColor: COLORS.white,
    borderRadius: 24,
    padding: SPACING.xl,
    alignItems: "center",
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  ratingTitle: {
    color: COLORS.navy,
    fontSize: 22,
    marginTop: SPACING.md,
  },
  ratingSubtitle: {
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  ratingSubmitBtn: {
    marginTop: SPACING.lg,
    width: "100%",
  },
  ratingSkip: {
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
});
