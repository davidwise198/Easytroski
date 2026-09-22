import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import AuthGate from "../../src/components/AuthGate";
import EmptyState from "../../src/components/ui/EmptyState";
import StatCard from "../../src/components/ui/StatCard";
import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import {
  mateActionError,
  subscribeDriver,
  subscribeMateActiveTrip,
  subscribeMateBookings,
} from "../../src/services/mates";
import {
  confirmBooking,
  rejectBooking,
  updateBookingStatus,
} from "../../src/services/transport";
import { COLORS, SPACING } from "../../src/theme";
import type { Booking, Driver, Trip } from "../../src/types/models";
import { showToast } from "../../src/utils/toast";

const ABOARD_STATUSES = ["confirmed", "picked_up"];
const HELD_STATUSES = ["pending", "awaiting_payment"];

function timeOf(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function placeLabel(location: { address?: string; latitude?: number; longitude?: number } | undefined): string {
  if (!location) return "—";
  if (location.address) return location.address;
  if (typeof location.latitude === "number" && typeof location.longitude === "number") {
    return `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
  }
  return "—";
}

function statusLabel(booking: Booking): { text: string; color: string } {
  switch (booking.status) {
    case "pending":
      return { text: "New request", color: COLORS.warning };
    case "awaiting_payment":
      return { text: "Awaiting payment", color: COLORS.accent };
    case "confirmed":
      return { text: "Paid · not picked up", color: COLORS.success };
    case "picked_up":
      return { text: "On board", color: COLORS.primary };
    case "completed":
      return { text: "Dropped off", color: COLORS.textSecondary };
    default:
      return { text: String(booking.status || ""), color: COLORS.textSecondary };
  }
}

export default function MatePassengersScreen() {
  const { user } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(
    () => ({
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      card: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      rowIcon: { backgroundColor: colors.veryLightBlue },
      infoRow: { backgroundColor: colors.veryLightBlue + "99" },
    }),
    [colors]
  );

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    const fail = () => {
      setError("We couldn't reach EasyTroski. Check your connection and try again.");
      setLoading(false);
    };
    const unsubTrip = subscribeMateActiveTrip(uid, (active) => setTrip(active), fail);
    const unsubBookings = subscribeMateBookings(
      uid,
      (rows) => {
        setBookings(rows);
        setLoading(false);
      },
      fail
    );
    return () => {
      unsubTrip();
      unsubBookings();
    };
  }, [user?.uid, reloadKey]);

  useEffect(() => {
    if (!trip?.driverId) {
      setDriver(null);
      return;
    }
    return subscribeDriver(trip.driverId, setDriver, () => {});
  }, [trip?.driverId]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  /** Only bookings belonging to the trip being worked are shown. */
  const tripBookings = useMemo(
    () => (trip ? bookings.filter((b) => !b.tripId || b.tripId === trip.id) : bookings),
    [bookings, trip]
  );

  const requests = tripBookings.filter((b) => b.status === "pending");
  const awaitingPayment = tripBookings.filter((b) => b.status === "awaiting_payment");
  const confirmed = tripBookings.filter((b) => b.status === "confirmed");
  const onboard = tripBookings.filter((b) => b.status === "picked_up");
  const done = tripBookings.filter((b) => b.status === "completed");

  const seatsFor = (list: Booking[]) =>
    list.reduce((total, b) => total + Number(b.seats || 1), 0);

  const capacity = Number(driver?.vehicleCapacity || 12);
  const available = Number(driver?.availableSeats || 0);
  const confirmedSeats = seatsFor(tripBookings.filter((b) => ABOARD_STATUSES.includes(String(b.status))));
  const heldSeats = seatsFor(tripBookings.filter((b) => HELD_STATUSES.includes(String(b.status))));

  /**
   * Every action goes to the backend, which re-checks that this mate is really
   * assigned to the booking's trip. The app never decides anything itself, and
   * the button stays disabled until the server answers — so a double tap can
   * only ever produce one decision.
   */
  const run = useCallback(
    async (booking: Booking, action: "accept" | "reject" | "picked_up" | "dropped_off") => {
      if (busyId) return;
      setBusyId(booking.id);
      try {
        if (action === "accept") {
          await confirmBooking(booking.id, booking.passengerId);
          showToast("success", "Booking accepted", "The passenger can pay now.");
        } else if (action === "reject") {
          await rejectBooking(booking.id);
          showToast("info", "Booking rejected", "The passenger has been told.");
        } else if (action === "picked_up") {
          await updateBookingStatus(booking.id, "picked_up");
          showToast("success", "Passenger picked up", "They're on board.");
        } else {
          await updateBookingStatus(booking.id, "completed");
          showToast("success", "Passenger dropped off", "Their seat is recorded.");
        }
      } catch (err) {
        // The backend refused: either the assignment ended under us or somebody
        // else already answered. Say which, in plain words.
        showToast("error", "Couldn't do that", mateActionError(err));
      } finally {
        setBusyId(null);
      }
    },
    [busyId]
  );

  const renderCard = (booking: Booking, action?: React.ReactNode) => {
    const status = statusLabel(booking);
    return (
      <View key={booking.id} style={[styles.card, ds.card]}>
        <View style={styles.cardTop}>
          <View style={[styles.cardIcon, ds.rowIcon]}>
            <MaterialCommunityIcons name="account" size={20} color={colors.primary} />
          </View>
          <View style={styles.cardCopy}>
            <AppText variant="heading" style={[styles.cardName, ds.text]} numberOfLines={1}>
              {booking.passengerName || "Passenger"}
            </AppText>
            <AppText variant="caption" style={[styles.cardMeta, ds.secondary]}>
              {booking.seats || 1} seat{(booking.seats || 1) > 1 ? "s" : ""}
              {timeOf(booking.createdAt) ? ` · ${timeOf(booking.createdAt)}` : ""}
            </AppText>
          </View>
          <View style={[styles.badge, { backgroundColor: status.color + "22" }]}>
            <AppText variant="caption" style={[styles.badgeText, { color: status.color }]}>
              {status.text}
            </AppText>
          </View>
        </View>

        <View style={[styles.infoRow, ds.infoRow]}>
          <MaterialCommunityIcons name="map-marker-account" size={15} color={COLORS.primary} />
          <AppText variant="caption" style={[styles.infoText, ds.secondary]} numberOfLines={2}>
            Pick up: {placeLabel(booking.pickupLocation)}
          </AppText>
        </View>
        <View style={[styles.infoRow, ds.infoRow]}>
          <MaterialCommunityIcons name="map-marker-check" size={15} color={COLORS.primary} />
          <AppText variant="caption" style={[styles.infoText, ds.secondary]} numberOfLines={2}>
            Getting off at: {placeLabel(booking.dropOffLocation)}
          </AppText>
        </View>

        {action}
      </View>
    );
  };

  const decideButtons = (booking: Booking) => (
    <View style={styles.actionRow}>
      <Pressable
        style={({ pressed }) => [
          styles.actionBtn,
          styles.rejectBtn,
          (pressed || busyId === booking.id) && { opacity: 0.75 },
        ]}
        disabled={Boolean(busyId)}
        onPress={() => void run(booking, "reject")}
      >
        <MaterialCommunityIcons name="close" size={18} color={COLORS.danger} />
        <AppText variant="caption" style={styles.rejectText}>
          Reject
        </AppText>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.actionBtn,
          styles.acceptBtn,
          (pressed || busyId === booking.id) && { opacity: 0.75 },
        ]}
        disabled={Boolean(busyId)}
        onPress={() => void run(booking, "accept")}
      >
        <MaterialCommunityIcons
          name={busyId === booking.id ? "timer-sand" : "check"}
          size={18}
          color={COLORS.white}
        />
        <AppText variant="caption" style={styles.acceptText}>
          {busyId === booking.id ? "Working..." : "Accept"}
        </AppText>
      </Pressable>
    </View>
  );

  const singleButton = (
    booking: Booking,
    label: string,
    icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"],
    action: "picked_up" | "dropped_off",
    tone: string
  ) => (
    <Pressable
      style={({ pressed }) => [styles.wideBtn, { backgroundColor: tone }, (pressed || busyId === booking.id) && { opacity: 0.8 }]}
      disabled={Boolean(busyId)}
      onPress={() => void run(booking, action)}
    >
      <MaterialCommunityIcons name={icon} size={18} color={COLORS.white} />
      <AppText variant="caption" style={styles.wideBtnText}>
        {busyId === booking.id ? "Working..." : label}
      </AppText>
    </Pressable>
  );

  const section = (title: string, list: Booking[], body: (b: Booking) => React.ReactNode) =>
    list.length === 0 ? null : (
      <View>
        <AppText variant="caption" style={[styles.sectionLabel, ds.secondary]}>
          {title.toUpperCase()}
        </AppText>
        {list.map((booking) => body(booking))}
      </View>
    );

  const nothingOnBoard =
    requests.length + awaitingPayment.length + confirmed.length + onboard.length + done.length === 0;

  return (
    <AuthGate allowedRoles={["mate"]}>
      <AppBackground>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <AppText variant="caption" style={[styles.eyebrow, ds.secondary]}>
            PASSENGERS
          </AppText>
          <AppText variant="heading" style={[styles.title, ds.text]} numberOfLines={1}>
            {trip ? "Your passengers" : "Passengers"}
          </AppText>
          <AppText variant="caption" style={[styles.subtitle, ds.secondary]}>
            {trip ? "Everyone booked onto the trip you are working." : "You are not on a trip yet."}
          </AppText>

          {loading ? (
            <EmptyState busy icon="account-group" title="Loading passengers..." />
          ) : error ? (
            <EmptyState
              tone="error"
              icon="wifi-off"
              title="Something went wrong"
              message={error}
              actionLabel="Try again"
              onAction={retry}
            />
          ) : !trip ? (
            <EmptyState
              icon="bus-stop-uncovered"
              title="No active trip"
              message="Ask your driver to assign you to today's trip, then this list fills up on its own."
            />
          ) : (
            <>
              <View style={styles.statRow}>
                <StatCard icon="bell-ring-outline" value={requests.length} label="Requests" delay={80} color={COLORS.accent} />
                <StatCard icon="account-group" value={onboard.length + confirmed.length} label="On board" delay={160} />
                <StatCard icon="seat" value={available} label="Seats free" delay={240} color={COLORS.success} />
              </View>
              {heldSeats > 0 ? (
                <AppText variant="caption" style={[styles.note, ds.secondary]}>
                  {heldSeats} of {capacity || "—"} seats held for bookings not paid yet.
                </AppText>
              ) : null}

              {nothingOnBoard ? (
                <EmptyState
                  icon="account-check-outline"
                  title="No passengers yet"
                  message="Booking requests from passengers will appear here the moment they come in."
                />
              ) : null}

              {requests.length === 0 && !nothingOnBoard ? (
                <AppText variant="caption" style={[styles.calmNote, ds.secondary]}>
                  No pending booking requests.
                </AppText>
              ) : null}

              {section("Booking requests", requests, (b) => renderCard(b, decideButtons(b)))}
              {section("Waiting to pay", awaitingPayment, (b) =>
                renderCard(
                  b,
                  <View style={styles.waitRow}>
                    <MaterialCommunityIcons name="timer-sand" size={14} color={COLORS.accent} />
                    <AppText variant="caption" style={[styles.waitText, ds.secondary]}>
                      Waiting for this passenger to pay. Their seat is held until they do.
                    </AppText>
                  </View>
                )
              )}
              {section("Confirmed passengers", confirmed, (b) =>
                renderCard(b, singleButton(b, "Passenger picked up", "account-arrow-right", "picked_up", COLORS.primary))
              )}
              {section("On board", onboard, (b) =>
                renderCard(b, singleButton(b, "Dropped off", "account-check", "dropped_off", COLORS.success))
              )}
              {section("Finished today", done, (b) => renderCard(b))}
            </>
          )}
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
  statRow: { flexDirection: "row", gap: SPACING.sm },
  note: { marginTop: SPACING.sm, fontSize: 11 },
  calmNote: { marginTop: SPACING.lg, fontSize: 12 },

  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
  },
  card: {
    padding: SPACING.lg,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: SPACING.sm,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: { flex: 1 },
  cardName: { fontSize: 16, lineHeight: 21 },
  cardMeta: { marginTop: 1 },
  badge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: 10,
  },
  badgeText: { fontSize: 10, fontWeight: "700" },

  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: 12,
    marginTop: SPACING.sm,
  },
  infoText: { flex: 1, fontSize: 12, lineHeight: 17 },

  actionRow: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    borderRadius: 16,
  },
  rejectBtn: {
    backgroundColor: "rgba(239,68,68,0.10)",
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  rejectText: { color: COLORS.danger, fontWeight: "700" },
  acceptBtn: { backgroundColor: COLORS.success },
  acceptText: { color: COLORS.white, fontWeight: "700" },

  wideBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    borderRadius: 16,
    marginTop: SPACING.md,
  },
  wideBtnText: { color: COLORS.white, fontWeight: "700" },

  waitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  waitText: { flex: 1, fontSize: 12, lineHeight: 17 },
});
