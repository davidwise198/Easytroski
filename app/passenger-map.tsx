import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { MapView, MapViewType, Marker, PROVIDER_DEFAULT } from "../src/components/map/MapExports";
import { router, useLocalSearchParams } from "expo-router";

import AuthGate from "../src/components/AuthGate";
import AppText from "../src/components/ui/AppText";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import { TripMarker } from "../src/components/map/TripMarker";
import { useLocation } from "../src/contexts/LocationContext";
import { useAuth } from "../src/contexts/AuthContext";
import { getActiveTripMarkers, subscribeActiveTripMarkers, subscribeDriverLocation } from "../src/services/map";
import StarRating from "../src/components/ui/StarRating";
import { createBooking, cancelBooking, rateDriver, getActiveRoutes } from "../src/services/transport";
import { auth, db } from "../src/services/firebase";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { COLORS, SPACING } from "../src/theme";
import { showToast } from "../src/utils/toast";
import {
  ActiveTripMarker,
  Route,
  TripStatus,
} from "../src/types/models";

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
  const [cancellingBooking, setCancellingBooking] = useState(false);
  const [editingSeats, setEditingSeats] = useState(false);
  const [bookingSeats, setBookingSeats] = useState(1);
  const [trackedDriverId, setTrackedDriverId] = useState<string | null>(null);
  const [trackedDriverLocation, setTrackedDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showRating, setShowRating] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);
  const [submittingRating, setSubmittingRating] = useState(false);
  const [tripToRate, setTripToRate] = useState<{ tripId: string; driverId: string } | null>(null);
  const [driverApproaching, setDriverApproaching] = useState(false);
  const [remainingSeats, setRemainingSeats] = useState<number | null>(null);

  // Selected trip for bottom sheet
  const [selectedMarker, setSelectedMarker] =
    useState<ActiveTripMarker | null>(null);

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
      const unsubscribe = subscribeActiveTripMarkers(selectedRouteId, (updatedMarkers) => {
        setMarkers(updatedMarkers);
        setLoadingTrips(false);
      });
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
          setLastBookingStatus(data.status);
          if (data.status === "confirmed") {
            showToast("success", "Booking confirmed", "Your driver has confirmed your seat!");
          } else if (data.status === "cancelled") {
            showToast("info", "Booking declined", "The driver could not take this booking.");
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

      setBookingTripId(marker.trip.id);
      try {
        const bookingId = await createBooking({
          passengerId,
          driverId: marker.trip.driverId,
          routeId: marker.trip.routeId ?? "",
          pickupLocation: {
            latitude: marker.driverLocation.latitude,
            longitude: marker.driverLocation.longitude,
            address: marker.trip.origin || "Pickup",
          },
          dropOffLocation: {
            latitude: marker.driverLocation.latitude,
            longitude: marker.driverLocation.longitude,
            address: marker.trip.destination || "Drop-off",
          },
          seats: 1,
        });
        setLastBookingId(bookingId);
        setLastBookingStatus("pending");
        setTrackedDriverId(marker.trip.driverId);
        showToast(
          "success",
          "Booking sent",
          `Your driver will confirm ${marker.trip.origin} → ${marker.trip.destination} shortly.`
        );
        setSelectedMarker(null);

        // Refresh markers so seat count updates on the map
        getActiveTripMarkers(selectedRouteId ?? undefined)
          .then(setMarkers)
          .catch(() => {});
      } catch (error) {
        showToast(
          "error",
          "Booking failed",
          "We could not create your booking. Please try again."
        );
      } finally {
        setBookingTripId(null);
      }
    },
    [selectedRouteId]
  );

  // Subscribe to driver location when booking is confirmed
  useEffect(() => {
    if (lastBookingStatus !== "confirmed" || !trackedDriverId) {
      setTrackedDriverLocation(null);
      return;
    }

    const unsubscribe = subscribeDriverLocation(trackedDriverId, (location) => {
      setTrackedDriverLocation(location);
    });

    return unsubscribe;
  }, [lastBookingStatus, trackedDriverId]);

  const handleCancelBooking = useCallback(async () => {
    if (!lastBookingId || !user?.uid) return;
    setCancellingBooking(true);
    try {
      await cancelBooking(lastBookingId, "passenger");
      setLastBookingStatus("cancelled");
      showToast("info", "Booking cancelled", "Your booking has been cancelled.");
    } catch {
      showToast("error", "Cancel failed", "Could not cancel booking. Please try again.");
    } finally {
      setCancellingBooking(false);
    }
  }, [lastBookingId, user?.uid]);

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

  // Check if driver is approaching (within 500m of pickup)
  useEffect(() => {
    if (!trackedDriverLocation || !lastBookingId || lastBookingStatus !== "confirmed") {
      setDriverApproaching(false);
      return;
    }

    // Simple distance check using Haversine
    const R = 6371000; // Earth radius in meters
    const dLat = ((trackedDriverLocation.latitude - (location?.coords.latitude || 0)) * Math.PI) / 180;
    const dLon = ((trackedDriverLocation.longitude - (location?.coords.longitude || 0)) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((location?.coords.latitude || 0) * Math.PI / 180) * Math.cos(trackedDriverLocation.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    setDriverApproaching(distance < 500);
  }, [trackedDriverLocation, lastBookingId, lastBookingStatus, location]);

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
        >
          {/* Trip markers */}
          {markers.map((marker) => (
            <TripMarker
              key={marker.trip.id}
              marker={marker}
              onPress={() => handleMarkerPress(marker)}
            />
          ))}

          {/* Live tracking marker for confirmed booking */}
          {trackedDriverLocation && lastBookingStatus === "confirmed" && (
            <Marker
              coordinate={trackedDriverLocation}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.trackingMarker}>
                <MaterialCommunityIcons name="bus" size={20} color={COLORS.white} />
              </View>
            </Marker>
          )}
        </MapView>

        {/* ---- Top bar ---- */}
        <View style={styles.topBar}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.primary} />
          </Pressable>

          <View style={styles.topBarTitle}>
            <AppText variant="caption" style={styles.topBarEyebrow}>EASYTROLSKI MAP</AppText>
            <AppText variant="heading" style={styles.topBarText}>Find a ride</AppText>
          </View>

          <Pressable style={styles.iconButton} onPress={() => requestPermission()}>
            <MaterialCommunityIcons name="crosshairs-gps" size={20} color={COLORS.primary} />
          </Pressable>
        </View>

        {/* ---- Location permission banner ---- */}
        {permissionStatus === "denied" && (
          <Pressable style={styles.permissionBanner} onPress={() => requestPermission()}>
            <MaterialCommunityIcons name="map-marker-alert-outline" size={18} color={COLORS.warning} />
            <AppText variant="caption" style={styles.permissionText}>
              {deniedMessage || "Location permission needed for nearby routes"}
            </AppText>
          </Pressable>
        )}

        {permissionStatus === "undetermined" && !locationLoading && (
          <Pressable style={styles.permissionBanner} onPress={() => requestPermission()}>
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
              style={[styles.chip, !selectedRouteId && styles.chipSelected]}
              onPress={() => setSelectedRouteId(null)}
            >
              <AppText
                variant="caption"
                style={[styles.chipText, !selectedRouteId && styles.chipTextSelected]}
              >
                All routes
              </AppText>
            </Pressable>

            {routes.map((route) => (
              <Pressable
                key={route.id}
                style={[
                  styles.chip,
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
                    selectedRouteId === route.id && styles.chipTextSelected,
                  ]}
                >
                  {route.origin} → {route.destination}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* ---- Driver approaching notification ---- */}
        {driverApproaching && lastBookingStatus === "confirmed" && (
          <View style={[styles.approachingBanner, { top: 240 }]}>
            <MaterialCommunityIcons name="bus-alert" size={18} color={COLORS.success} />
            <AppText variant="caption" style={styles.approachingText}>
              Your driver is approaching! Get ready.
            </AppText>
          </View>
        )}

        {/* ---- Bus stop warning after booking ---- */}
        {lastBookingId && (lastBookingStatus === "pending" || lastBookingStatus === "confirmed") && !driverApproaching && (
          <View style={[styles.busStopBanner, { top: driverApproaching ? 290 : 240 }]}>
            <MaterialCommunityIcons name="bus-stop" size={18} color={COLORS.primary} />
            <AppText variant="caption" style={styles.busStopText}>
              Please stand by the nearest bus stop for easy pickup.
            </AppText>
          </View>
        )}

        {/* ---- Booking status banner + edit seats ---- */}
        {lastBookingId && lastBookingStatus && (
          <>
          <View style={[
            styles.bookingBanner,
            { top: (driverApproaching ? 290 : 0) + ((lastBookingStatus === "pending" || lastBookingStatus === "confirmed") && !driverApproaching ? 50 : 0) + 240 },
            lastBookingStatus === "confirmed" && styles.bookingBannerSuccess,
            lastBookingStatus === "cancelled" && styles.bookingBannerError,
          ]}>
            <MaterialCommunityIcons
              name={
                lastBookingStatus === "confirmed" ? "check-circle" :
                lastBookingStatus === "cancelled" ? "close-circle" :
                "clock-outline"
              }
              size={18}
              color={
                lastBookingStatus === "confirmed" ? COLORS.success :
                lastBookingStatus === "cancelled" ? COLORS.danger :
                COLORS.warning
              }
            />
            <AppText variant="caption" style={styles.bookingBannerText}>
              {lastBookingStatus === "confirmed"
                ? `Booking confirmed! ${bookingSeats} seat${bookingSeats > 1 ? 's' : ''} reserved.${remainingSeats !== null ? ` ${remainingSeats} seat${remainingSeats !== 1 ? 's' : ''} remaining.` : ''} Your driver is on the way.`
                : lastBookingStatus === "cancelled"
                  ? "Booking declined. The driver could not take this booking."
                  : "Booking pending — waiting for driver to confirm..."}
            </AppText>
            {(lastBookingStatus === "pending" || lastBookingStatus === "confirmed") && (
              <View style={styles.bannerActions}>
                <Pressable
                  style={styles.editSeatsBtn}
                  onPress={() => setEditingSeats(!editingSeats)}
                >
                  <MaterialCommunityIcons name="pencil" size={12} color={COLORS.primary} />
                </Pressable>
                <Pressable
                  style={styles.cancelBookingBtn}
                  onPress={() => void handleCancelBooking()}
                  disabled={cancellingBooking}
                >
                  <MaterialCommunityIcons name="close" size={14} color={COLORS.danger} />
                </Pressable>
              </View>
            )}
          </View>

          {/* Edit seats inline */}
          {editingSeats && lastBookingStatus !== "cancelled" && (
            <View style={styles.editSeatsRow}>
              <AppText variant="caption" style={styles.editSeatsLabel}>Seats:</AppText>
              <Pressable
                style={styles.seatEditBtn}
                onPress={() => { if (bookingSeats > 1) setBookingSeats(bookingSeats - 1); }}
              >
                <MaterialCommunityIcons name="minus" size={16} color={COLORS.primary} />
              </Pressable>
              <AppText variant="heading" style={styles.seatEditText}>{bookingSeats}</AppText>
              <Pressable
                style={styles.seatEditBtn}
                onPress={() => { if (bookingSeats < 5) setBookingSeats(bookingSeats + 1); }}
              >
                <MaterialCommunityIcons name="plus" size={16} color={COLORS.primary} />
              </Pressable>
              <Pressable
                style={styles.seatSaveBtn}
                onPress={() => {
                  if (lastBookingId) {
                    void updateDoc(doc(db, "bookings", lastBookingId), { seats: bookingSeats });
                  }
                  setEditingSeats(false);
                  showToast("success", "Updated", `${bookingSeats} seat${bookingSeats > 1 ? 's' : ''} reserved.`);
                }}
              >
                <AppText variant="caption" style={styles.seatSaveText}>Save</AppText>
              </Pressable>
            </View>
          )}
          </>
        )}

        {/* ---- Loading indicator for trips ---- */}
        {loadingTrips && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color={COLORS.primary} />
          </View>
        )}

        {/* ---- Bottom sheet: selected trip detail ---- */}
        {selectedMarker && (
          <View style={styles.bottomSheet}>
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
                  <AppText variant="heading" style={styles.sheetRoute}>
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
                  </View>
                </View>
              </View>

              {/* Vehicle info */}
              <View style={styles.vehicleInfoCard}>
                <View style={styles.vehicleInfoRow}>
                  <MaterialCommunityIcons name="steering" size={16} color={COLORS.primary} />
                  <AppText variant="caption" style={styles.vehicleInfoLabel}>Driver</AppText>
                  <AppText variant="heading" style={styles.vehicleInfoValue}>
                    {selectedMarker.trip.driverName || "Driver"}
                  </AppText>
                </View>
                {selectedMarker.trip.vehiclePlate && (
                  <View style={styles.vehicleInfoRow}>
                    <MaterialCommunityIcons name="car" size={16} color={COLORS.primary} />
                    <AppText variant="caption" style={styles.vehicleInfoLabel}>Plate</AppText>
                    <AppText variant="heading" style={styles.vehicleInfoValue}>
                      {selectedMarker.trip.vehiclePlate}
                    </AppText>
                  </View>
                )}
                {(selectedMarker.trip.vehicleColor || selectedMarker.trip.vehicleBrand) && (
                  <View style={styles.vehicleInfoRow}>
                    <MaterialCommunityIcons name="palette" size={16} color={COLORS.primary} />
                    <AppText variant="caption" style={styles.vehicleInfoLabel}>Vehicle</AppText>
                    <AppText variant="heading" style={styles.vehicleInfoValue}>
                      {[selectedMarker.trip.vehicleColor, selectedMarker.trip.vehicleBrand].filter(Boolean).join(" ")}
                    </AppText>
                  </View>
                )}
              </View>

              {/* Seats */}
              <View style={styles.sheetInfo}>
                <View style={styles.sheetInfoItem}>
                  <MaterialCommunityIcons
                    name="seat"
                    size={18}
                    color={COLORS.primary}
                  />
                  <View>
                    <AppText variant="heading" style={styles.sheetInfoValue}>
                      {selectedMarker.availableSeats}
                    </AppText>
                    <AppText variant="caption" style={styles.sheetInfoLabel}>
                      seats left
                    </AppText>
                  </View>
                </View>
                {selectedMarker.trip.vehicleCapacity && (
                  <View style={styles.sheetInfoItem}>
                    <MaterialCommunityIcons
                      name="bus-side"
                      size={18}
                      color={COLORS.textSecondary}
                    />
                    <View>
                      <AppText variant="heading" style={styles.sheetInfoValue}>
                        {selectedMarker.trip.vehicleCapacity}
                      </AppText>
                      <AppText variant="caption" style={styles.sheetInfoLabel}>
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
                      : `Book seat — ${selectedMarker.trip.origin} → ${selectedMarker.trip.destination}`
                  }
                  onPress={() => void handleBookTrip(selectedMarker)}
                  disabled={
                    selectedMarker.trip.status === "completed" ||
                    selectedMarker.trip.status === "cancelled" ||
                    bookingTripId !== null
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
            <View style={styles.ratingCard}>
              <MaterialCommunityIcons name="star-circle" size={48} color={COLORS.accent} />
              <AppText variant="heading" style={styles.ratingTitle}>Rate your trip</AppText>
              <AppText variant="body" style={styles.ratingSubtitle}>How was your ride?</AppText>
              <StarRating value={ratingValue} onChange={setRatingValue} size={40} />
              <PrimaryButton
                title={submittingRating ? "Submitting..." : "Submit rating"}
                onPress={() => void handleSubmitRating()}
                disabled={submittingRating || ratingValue === 0}
                style={styles.ratingSubmitBtn}
              />
              <Pressable onPress={() => { setShowRating(false); setRatingValue(0); }}>
                <AppText variant="caption" style={styles.ratingSkip}>Skip for now</AppText>
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
  bannerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  editSeatsBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  cancelBookingBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E2",
  },
  editSeatsRow: {
    position: "absolute",
    top: 290,
    left: SPACING.md,
    right: SPACING.md,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: 12,
    backgroundColor: COLORS.white,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  editSeatsLabel: {
    color: COLORS.textSecondary,
    fontWeight: "600",
  },
  seatEditBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.veryLightBlue,
  },
  seatEditText: {
    color: COLORS.navy,
    fontSize: 16,
    minWidth: 20,
    textAlign: "center",
  },
  seatSaveBtn: {
    marginLeft: "auto",
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
  },
  seatSaveText: {
    color: COLORS.white,
    fontWeight: "600",
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

  /* ── Live tracking ── */
  trackingMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.success,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: COLORS.white,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
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
