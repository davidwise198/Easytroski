import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Marker } from "./MapExports";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "../ui/AppText";
import { COLORS, SPACING } from "../../theme";
import { ActiveTripMarker, TripStatus } from "../../types/models";

// ---------------------------------------------------------------------------
// Status color + label helpers
// ---------------------------------------------------------------------------

function tripStatusLabel(status: TripStatus): string {
  switch (status) {
    case "online":
    case "boarding":
      return "Boarding";
    case "in_progress":
      return "On the way";
    case "scheduled":
      return "Scheduled";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "offline":
      return "Offline";
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
    case "cancelled":
      return COLORS.danger;
    case "completed":
    case "offline":
    default:
      return COLORS.textSecondary;
  }
}

// ---------------------------------------------------------------------------
// Trip marker component (shows on both passenger and driver maps)
//
// The marker is fully tappable — no Callout is used because it would
// intercept the press and prevent the bottom sheet from opening.
// Tapping the marker triggers onPress which opens the detail bottom sheet.
// ---------------------------------------------------------------------------

type TripMarkerProps = {
  marker: ActiveTripMarker;
  onPress?: () => void;
};

export function TripMarker({ marker, onPress }: TripMarkerProps) {
  const { trip, driverLocation, availableSeats } = marker;
  const statusColor = tripStatusColor(trip.status);

  return (
    <Marker
      coordinate={{
        latitude: driverLocation.latitude,
        longitude: driverLocation.longitude,
      }}
      onPress={onPress}
      tracksViewChanges={true}
    >
      {/* Tappable vehicle icon marker */}
      <View style={styles.markerWrapper}>
        <View style={[styles.markerContainer, { borderColor: statusColor }]}>
          <MaterialCommunityIcons
            name="bus"
            size={22}
            color={COLORS.white}
          />
        </View>

        {/* Seat count badge */}
        {availableSeats > 0 && (
          <View style={styles.seatBadge}>
            <AppText variant="caption" style={styles.seatBadgeText}>
              {availableSeats}
            </AppText>
          </View>
        )}
      </View>
    </Marker>
  );
}

// ---------------------------------------------------------------------------
// User location marker (blue dot)
// ---------------------------------------------------------------------------

export function UserLocationMarker() {
  return (
    <Marker coordinate={{ latitude: 0, longitude: 0 }} anchor={{ x: 0.5, y: 0.5 }}>
      <View style={styles.userDot}>
        <View style={styles.userDotInner} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  markerWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  markerContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  seatBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.white,
  },
  seatBadgeText: {
    color: COLORS.white,
    fontSize: 10,
    fontWeight: "800",
  },
  userDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(23, 105, 224, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  userDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
});
