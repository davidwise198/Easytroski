import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Vibration, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "../ui/AppText";
import { useAuth } from "../../contexts/AuthContext";
import type { Booking, Trip } from "../../types/models";
import {
  mateActionError,
  subscribeMateActiveTrip,
  subscribeMateBookings,
} from "../../services/mates";
import { confirmBooking, rejectBooking } from "../../services/transport";
import { COLORS, SPACING } from "../../theme";
import { showToast } from "../../utils/toast";

/** How long the request stays on screen before it steps back to the list. */
const AUTO_DISMISS_SECONDS = 25;

function requestTime(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function placeLabel(location?: { address?: string }): string {
  return location?.address || "See map";
}

/**
 * Can the Mate still do something about this request?
 *
 * Pending is not enough on its own: once the passenger's hold has run out the
 * request is history waiting for the reaper, and interrupting the Mate over it
 * would be noise. This is also what decides whether a request found on opening
 * the app is worth a pop-up.
 */
function stillAnswerable(booking: Booking): boolean {
  if (booking.status !== "pending") return false;
  const expiry = booking.seatHoldExpiresAt ? Date.parse(String(booking.seatHoldExpiresAt)) : NaN;
  if (Number.isNaN(expiry)) return true; // unknown → let the backend refuse it
  return expiry > Date.now();
}

/**
 * The Mate's new-request alert.
 *
 * The Mate is now the only person who can answer a booking request, so the
 * request has to find them wherever they are in the app. This is mounted by the
 * mate tab layout, watches the same live data the Passengers screen uses, and
 * takes over the screen with a repeating vibration when something arrives.
 *
 * It decides nothing itself. Accept and Reject call the same backend actions as
 * the Passengers screen, so the server stays the authority — and the alert
 * disappears on its own if the assignment or the trip ends underneath it.
 */
export default function MateRequestAlert() {
  const { user, userRole } = useAuth();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [alertBooking, setAlertBooking] = useState<Booking | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_DISMISS_SECONDS);

  /** Ids already known, so opening the app never fires a backlog of alerts. */
  const seen = useRef<Set<string> | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  // ─── Live data (same streams the Passengers screen reads) ────────────────
  useEffect(() => {
    const uid = user?.uid;
    if (!uid || userRole !== "mate") return;
    const unsubBookings = subscribeMateBookings(uid, setBookings, () => {});
    const unsubTrip = subscribeMateActiveTrip(uid, setTrip, () => {});
    return () => {
      unsubBookings();
      unsubTrip();
      Vibration.cancel();
    };
  }, [user?.uid, userRole]);

  /**
   * Seed on the first payload.
   *
   * A request the Mate can still answer is exactly what this alert exists for,
   * so one that is found when the app opens — the phone was in a pocket, the app
   * was closed — is NOT written off as history while its hold is still running.
   * Anything already answered, or whose hold has lapsed, is: that belongs to the
   * Passengers list rather than to a pop-up.
   *
   * (Without push notifications installed, this is the path that catches a
   * request that arrived while the app was not in front of them.)
   */
  useEffect(() => {
    if (seen.current !== null) return;
    seen.current = new Set(
      bookings.filter((booking) => !stillAnswerable(booking)).map((booking) => booking.id)
    );
  }, [bookings]);

  // A request that arrives while the Mate is working the trip.
  useEffect(() => {
    const known = seen.current;
    if (!known || !trip) return;
    const fresh = bookings.filter(
      (booking) => stillAnswerable(booking) && !known.has(booking.id)
    );
    if (fresh.length === 0) return;
    fresh.forEach((booking) => known.add(booking.id));
    setAlertBooking(fresh[fresh.length - 1]);
  }, [bookings, trip]);

  const dismiss = useCallback(() => {
    setAlertBooking(null);
    Vibration.cancel();
  }, []);

  // Steps away on its own, and immediately if the assignment or the trip ends,
  // or if somebody else answers the request first.
  useEffect(() => {
    if (!alertBooking) return;
    const live = bookings.find((booking) => booking.id === alertBooking.id);
    if (!trip || !live || live.status !== "pending") dismiss();
  }, [bookings, trip, alertBooking, dismiss]);

  useEffect(() => {
    if (!alertBooking) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    Vibration.vibrate([0, 450, 250, 450], true);
    setSecondsLeft(AUTO_DISMISS_SECONDS);
    const tick = setInterval(() => setSecondsLeft((left) => Math.max(0, left - 1)), 1000);
    const auto = setTimeout(dismiss, AUTO_DISMISS_SECONDS * 1000);
    const alertId = alertBooking.id;

    return () => {
      clearInterval(tick);
      clearTimeout(auto);
      Vibration.cancel();
      // Not forgotten: if it is still unanswered it stays in the list.
      void alertId;
    };
  }, [alertBooking, anim, dismiss]);

  const decide = useCallback(
    async (booking: Booking, decision: "accept" | "reject") => {
      if (busyId) return;
      setBusyId(booking.id);
      try {
        if (decision === "accept") {
          await confirmBooking(booking.id, booking.passengerId);
          showToast("success", "Booking accepted", "The passenger can pay now.");
        } else {
          await rejectBooking(booking.id);
          showToast("info", "Booking rejected", "Those seats were released.");
        }
        dismiss();
      } catch (error) {
        showToast("error", "Couldn't do that", mateActionError(error));
      } finally {
        setBusyId(null);
      }
    },
    [busyId, dismiss]
  );

  const style = useMemo(
    () => ({
      overlay: { opacity: anim },
      card: {
        transform: [
          { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) },
        ],
      },
      pulse: {
        transform: [
          {
            scale: anim.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.12],
            }),
          },
        ],
      },
    }),
    [anim]
  );

  if (!alertBooking) return null;

  const seats = alertBooking.seats || 1;
  const working = busyId === alertBooking.id;

  return (
    <Animated.View style={[styles.overlay, style.overlay]} pointerEvents="auto">
      <Animated.View style={[styles.card, style.card]}>
        <View style={styles.header}>
          <Animated.View style={[styles.iconWrap, style.pulse]}>
            <MaterialCommunityIcons name="bell-ring-outline" size={22} color={COLORS.white} />
          </Animated.View>
          <View style={styles.copy}>
            <AppText variant="caption" style={styles.eyebrow}>
              NEW BOOKING REQUEST
            </AppText>
            <AppText variant="heading" style={styles.title} numberOfLines={1}>
              {alertBooking.passengerName || "Passenger"}
            </AppText>
          </View>
          <View style={styles.countdown}>
            <AppText variant="heading" style={styles.countdownText}>
              {secondsLeft}
            </AppText>
          </View>
        </View>

        <View style={styles.meta}>
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="seat-passenger" size={16} color={COLORS.warning} />
            <AppText variant="caption" style={styles.metaText}>
              {seats} seat{seats > 1 ? "s" : ""}
              {requestTime(alertBooking.createdAt) ? ` · asked at ${requestTime(alertBooking.createdAt)}` : ""}
            </AppText>
          </View>
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="map-marker-account" size={16} color={COLORS.warning} />
            <AppText variant="caption" style={styles.metaText} numberOfLines={2}>
              Pick up: {placeLabel(alertBooking.pickupLocation)}
            </AppText>
          </View>
          <View style={styles.metaRow}>
            <MaterialCommunityIcons name="map-marker-check" size={16} color={COLORS.warning} />
            <AppText variant="caption" style={styles.metaText} numberOfLines={2}>
              Getting off at: {placeLabel(alertBooking.dropOffLocation)}
            </AppText>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.rejectBtn, (pressed || working) && styles.pressed]}
            disabled={Boolean(busyId)}
            onPress={() => void decide(alertBooking, "reject")}
          >
            <MaterialCommunityIcons name="close" size={22} color={COLORS.danger} />
            <AppText variant="body" style={styles.rejectText}>
              Reject
            </AppText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.acceptBtn, (pressed || working) && styles.pressed]}
            disabled={Boolean(busyId)}
            onPress={() => void decide(alertBooking, "accept")}
          >
            <MaterialCommunityIcons
              name={working ? "timer-sand" : "check"}
              size={22}
              color={COLORS.white}
            />
            <AppText variant="body" style={styles.acceptText}>
              {working ? "Working..." : "Accept"}
            </AppText>
          </Pressable>
        </View>

        <Pressable style={styles.laterBtn} onPress={dismiss} disabled={Boolean(busyId)}>
          <AppText variant="caption" style={styles.laterText}>
            Decide later — keep it in the list
          </AppText>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 60,
    elevation: 24,
    backgroundColor: "rgba(11,23,44,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.lg,
  },
  card: {
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  eyebrow: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  title: {
    color: COLORS.white,
    fontSize: 20,
    lineHeight: 26,
  },
  countdown: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: COLORS.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  countdownText: { color: COLORS.white },

  meta: {
    marginTop: SPACING.lg,
    gap: SPACING.md,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  metaText: {
    color: "rgba(255,255,255,0.85)",
    flex: 1,
    lineHeight: 18,
  },

  actions: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginTop: SPACING.xl,
  },
  pressed: { opacity: 0.85 },
  rejectBtn: {
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
  rejectText: { color: COLORS.white, fontWeight: "800" },
  acceptBtn: {
    flex: 1.4,
    height: 56,
    borderRadius: 14,
    backgroundColor: COLORS.success,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  acceptText: { color: COLORS.white, fontWeight: "800" },

  laterBtn: {
    marginTop: SPACING.md,
    alignItems: "center",
  },
  laterText: {
    color: "rgba(255,255,255,0.7)",
    fontWeight: "700",
  },
});
