import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import AuthGate from "../../src/components/AuthGate";
import EmptyState from "../../src/components/ui/EmptyState";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import SeatOfferControl from "../../src/components/mate/SeatOfferControl";
import StatCard from "../../src/components/ui/StatCard";
import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import { getUserProfile } from "../../src/services/profile";
import {
  ensureMyIds,
  fetchRoute,
  subscribeDriver,
  subscribeMateActiveTrip,
  subscribeMateBookings,
  subscribeMateConnections,
  subscribeMateJoinRequests,
  type SeatUsage,
} from "../../src/services/mates";
import { COLORS, SPACING } from "../../src/theme";
import type { Booking, Driver, MateConnection, MateJoinRequest, Route, Trip } from "../../src/types/models";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** The trip's own status, in the words a Mate would actually use. */
function tripStatusLabel(status: unknown): string {
  switch (String(status)) {
    case "online":
      return "Started";
    case "boarding":
      return "Boarding";
    case "in_progress":
      return "On the way";
    case "scheduled":
      return "Scheduled";
    default:
      return "Working";
  }
}

const HELD_STATUSES = ["pending", "awaiting_payment"];
const ABOARD_STATUSES = ["confirmed", "picked_up"];

/**
 * The mate's dashboard.
 *
 * It answers the four questions a mate has when they open the app: am I on a
 * trip, which driver and vehicle, how many seats are left, and does anything
 * need a decision. All of it is live — a booking request or an assignment
 * appears without a refresh.
 */
export default function MateHomeScreen() {
  const { user } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(
    () => ({
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      card: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      tripCard: { backgroundColor: colors.blueWash, borderColor: colors.veryLightBlue },
      rowIcon: { backgroundColor: colors.veryLightBlue },
    }),
    [colors]
  );

  const [name, setName] = useState("");
  const [mateCode, setMateCode] = useState<string | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [connections, setConnections] = useState<MateConnection[]>([]);
  const [requests, setRequests] = useState<MateJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Authoritative seat numbers straight from the backend, used for the moment
  // after a change until the driver document catches up in the listener.
  const [usage, setUsage] = useState<SeatUsage | null>(null);

  // Name for the greeting, plus the Mate ID (created on first use if needed).
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let cancelled = false;
    getUserProfile(uid)
      .then((profile) => {
        if (!cancelled) setName(String(profile?.name || "").split(" ")[0] || "");
      })
      .catch(() => {});
    ensureMyIds()
      .then((ids) => {
        if (!cancelled) setMateCode(ids.mateCode ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  // Anything that should change without a refresh.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    const fail = () => {
      setError("We couldn't reach EasyTroski. Check your connection and try again.");
      setLoading(false);
    };
    const unsubTrip = subscribeMateActiveTrip(
      uid,
      (active) => {
        setTrip(active);
        setLoading(false);
      },
      fail
    );
    const unsubBookings = subscribeMateBookings(uid, setBookings, fail);
    const unsubConnections = subscribeMateConnections(uid, setConnections, () => {});
    const unsubRequests = subscribeMateJoinRequests(uid, setRequests, () => {});
    return () => {
      unsubTrip();
      unsubBookings();
      unsubConnections();
      unsubRequests();
    };
  }, [user?.uid, reloadKey]);

  // Driver + route for whichever trip is running.
  useEffect(() => {
    const driverId = trip?.driverId;
    const routeId = trip?.routeId;
    if (!driverId) {
      setDriver(null);
      setRoute(null);
      return;
    }
    const unsubDriver = subscribeDriver(driverId, setDriver, () => {});
    let cancelled = false;
    if (routeId) {
      fetchRoute(routeId)
        .then((r) => {
          if (!cancelled) setRoute(r);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      unsubDriver();
    };
  }, [trip?.driverId, trip?.routeId]);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  const tripBookings = useMemo(
    () => (trip ? bookings.filter((b) => !b.tripId || b.tripId === trip.id) : bookings),
    [bookings, trip]
  );

  const seatsFor = (statuses: string[]) =>
    tripBookings
      .filter((b) => statuses.includes(String(b.status)))
      .reduce((total, b) => total + Number(b.seats || 1), 0);

  // 12 is the same fallback the backend uses when a driver never recorded a
  // capacity, so the mate's totals can never disagree with what is bookable.
  const capacity = Number(driver?.vehicleCapacity || 12);
  const available = Number(driver?.availableSeats || 0);
  const confirmedSeats = seatsFor(ABOARD_STATUSES);
  const heldSeats = seatsFor(HELD_STATUSES);
  const onBoardSeats = seatsFor(["picked_up"]);
  // Every seat a passenger is holding: unpaid requests included, because a held
  // seat cannot be sold again either. Same rule the backend applies.
  const committedSeats = confirmedSeats + heldSeats;
  const maxOffer = Math.max(0, capacity - committedSeats);
  // The backend's own numbers win when we have them (just after a seat change).
  const offeredSeats = usage ? usage.offered : available;
  const requestCount = tripBookings.filter((b) => b.status === "pending").length;
  const passengerCount = tripBookings.filter((b) => ABOARD_STATUSES.includes(String(b.status))).length;

  const activeConnection = connections.find((c) => c.status === "active") ?? null;
  const pendingRequest = requests.find((r) => r.status === "pending") ?? null;
  const routeLabel = route ? `${route.origin} → ${route.destination}` : "Trip in progress";

  // Booking progress on this trip, from the bookings already being listened to.
  const progressLabel = (() => {
    const count = (status: string) =>
      tripBookings.filter((b) => String(b.status) === status).length;
    const parts = [
      count("pending") ? `${count("pending")} waiting to answer` : "",
      count("awaiting_payment") ? `${count("awaiting_payment")} waiting to pay` : "",
      count("confirmed") ? `${count("confirmed")} paid` : "",
      count("picked_up") ? `${count("picked_up")} on board` : "",
      count("completed") ? `${count("completed")} dropped off` : "",
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "No passengers yet.";
  })();

  const openTab = (tab: "mate-passengers" | "mate-driver") =>
    router.navigate(`/${tab}`);

  return (
    <AuthGate allowedRoles={["mate"]}>
      <AppBackground>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* ─── Header ─── */}
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <AppText variant="caption" style={[styles.eyebrow, ds.secondary]}>
                MATE
              </AppText>
              <AppText variant="heading" style={[styles.greeting, ds.text]} numberOfLines={1}>
                {name ? `${greeting()}, ${name}` : greeting()}
              </AppText>
            </View>
            <Pressable
              onPress={() => router.push("/profile")}
              style={({ pressed }) => [styles.avatar, ds.rowIcon, pressed && { opacity: 0.7 }]}
            >
              <MaterialCommunityIcons name="account" size={22} color={colors.primary} />
            </Pressable>
          </View>

          {loading ? (
            <EmptyState busy icon="bus" title="Loading your trip..." />
          ) : error ? (
            <EmptyState
              tone="error"
              icon="wifi-off"
              title="Something went wrong"
              message={error}
              actionLabel="Try again"
              onAction={retry}
            />
          ) : trip ? (
            <>
              {/* ─── Current trip ─── */}
              <View style={[styles.tripCard, ds.tripCard]}>
                <View style={styles.tripTop}>
                  <AppText variant="caption" style={[styles.eyebrow, ds.secondary]}>
                    CURRENT TRIP
                  </AppText>
                  <View style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <AppText variant="caption" style={styles.liveText}>
                      {tripStatusLabel(trip.status)}
                    </AppText>
                  </View>
                </View>
                <AppText variant="title" style={[styles.tripRoute, ds.text]} numberOfLines={2}>
                  {routeLabel}
                </AppText>
                <View style={styles.metaRow}>
                  <MaterialCommunityIcons name="account" size={15} color={colors.textSecondary} />
                  <AppText variant="caption" style={[styles.metaText, ds.secondary]} numberOfLines={1}>
                    {driver?.name || trip.driverName || "Your driver"}
                  </AppText>
                </View>
                <View style={styles.metaRow}>
                  <MaterialCommunityIcons name="bus" size={15} color={colors.textSecondary} />
                  <AppText variant="caption" style={[styles.metaText, ds.secondary]} numberOfLines={1}>
                    {driver?.vehicleRegistration || "Vehicle"}
                    {driver?.vehicleColor ? ` · ${driver.vehicleColor}` : ""}
                  </AppText>
                </View>
                <View style={styles.metaRow}>
                  <MaterialCommunityIcons name="account-group" size={15} color={colors.textSecondary} />
                  <AppText variant="caption" style={[styles.metaText, ds.secondary]} numberOfLines={2}>
                    {progressLabel}
                  </AppText>
                </View>
              </View>

              {/* ─── Seats ─── */}
              <AppText variant="caption" style={[styles.sectionLabel, ds.secondary]}>
                SEATS
              </AppText>
              <View style={styles.statRow}>
                <StatCard icon="seat-passenger" value={capacity} label="Total" delay={80} />
                <StatCard
                  icon="account-check"
                  value={confirmedSeats}
                  label="Paid"
                  delay={160}
                  color={COLORS.success}
                />
                <StatCard icon="seat" value={offeredSeats} label="On offer" delay={240} />
              </View>
              <AppText variant="caption" style={[styles.seatNote, ds.secondary]}>
                {[`${onBoardSeats} on board`, heldSeats > 0 ? `${heldSeats} held for unpaid requests` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </AppText>

              <SeatOfferControl
                offered={offeredSeats}
                capacity={capacity}
                committed={committedSeats}
                maxOffer={maxOffer}
                onUsage={setUsage}
              />

              {/* ─── What needs attention ─── */}
              <AppText variant="caption" style={[styles.sectionLabel, ds.secondary]}>
                TODAY
              </AppText>

              <Pressable
                style={({ pressed }) => [styles.actionCard, ds.card, pressed && { opacity: 0.85 }]}
                onPress={() => openTab("mate-passengers")}
              >
                <View style={[styles.actionIcon, ds.rowIcon]}>
                  <MaterialCommunityIcons
                    name="bell-ring-outline"
                    size={22}
                    color={requestCount > 0 ? COLORS.accent : colors.primary}
                  />
                </View>
                <View style={styles.actionCopy}>
                  <AppText variant="heading" style={[styles.actionTitle, ds.text]}>
                    Booking requests
                  </AppText>
                  <AppText variant="caption" style={[styles.actionSub, ds.secondary]}>
                    {requestCount > 0
                      ? `${requestCount} waiting for your decision`
                      : "Nothing waiting right now"}
                  </AppText>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
              </Pressable>

              <Pressable
                style={({ pressed }) => [styles.actionCard, ds.card, pressed && { opacity: 0.85 }]}
                onPress={() => openTab("mate-passengers")}
              >
                <View style={[styles.actionIcon, ds.rowIcon]}>
                  <MaterialCommunityIcons name="account-group" size={22} color={colors.primary} />
                </View>
                <View style={styles.actionCopy}>
                  <AppText variant="heading" style={[styles.actionTitle, ds.text]}>
                    Passengers
                  </AppText>
                  <AppText variant="caption" style={[styles.actionSub, ds.secondary]}>
                    {passengerCount > 0
                      ? `${passengerCount} on board`
                      : "No passengers yet"}
                  </AppText>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textSecondary} />
              </Pressable>

              {requestCount > 0 ? (
                <PrimaryButton
                  title={`Review ${requestCount} request${requestCount > 1 ? "s" : ""}`}
                  onPress={() => openTab("mate-passengers")}
                  style={styles.primary}
                />
              ) : null}
            </>
          ) : (
            <>
              {/* ─── No trip assigned ─── */}
              <EmptyState
                icon="bus-stop-uncovered"
                title="No active trip"
                message={
                  activeConnection
                    ? "You are not currently assigned to a trip. Your driver assigns you when they start one."
                    : "You are not connected to a driver yet. Join one with their Driver ID to start working."
                }
              />

              {pendingRequest ? (
                <EmptyState
                  icon="clock-outline"
                  title="Join request pending"
                  message={`Waiting for ${pendingRequest.driverName || "the driver"} to approve your request.`}
                  actionLabel="View My Driver"
                  onAction={() => openTab("mate-driver")}
                />
              ) : activeConnection ? (
                <>
                  <View style={[styles.actionCard, ds.card]}>
                    <View style={[styles.actionIcon, ds.rowIcon]}>
                      <MaterialCommunityIcons name="account" size={22} color={colors.primary} />
                    </View>
                    <View style={styles.actionCopy}>
                      <AppText variant="heading" style={[styles.actionTitle, ds.text]}>
                        {activeConnection.driverName || "Your driver"}
                      </AppText>
                      <AppText variant="caption" style={[styles.actionSub, ds.secondary]}>
                        {activeConnection.driverCode || "Connected"}
                      </AppText>
                    </View>
                  </View>
                  <PrimaryButton
                    title="View My Driver"
                    onPress={() => openTab("mate-driver")}
                    style={styles.primary}
                  />
                </>
              ) : (
                <PrimaryButton
                  title="Join a Driver"
                  onPress={() => router.push("/mate-join")}
                  style={styles.primary}
                />
              )}

              {mateCode ? (
                <AppText variant="caption" style={[styles.footerNote, ds.secondary]}>
                  Your Mate ID is {mateCode}
                </AppText>
              ) : null}
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.lg,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  greeting: { fontSize: 21, lineHeight: 27, marginTop: 2 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  tripCard: {
    padding: SPACING.lg,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  tripTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(34,197,94,0.16)",
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: COLORS.success },
  liveText: { color: COLORS.success, fontWeight: "700", fontSize: 11 },
  tripRoute: { marginTop: SPACING.xs, fontSize: 22, lineHeight: 28 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  metaText: { flex: 1 },

  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: SPACING.sm,
    marginTop: SPACING.sm,
  },
  statRow: { flexDirection: "row", gap: SPACING.sm },
  seatNote: { marginTop: SPACING.sm, fontSize: 11 },

  actionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    padding: SPACING.lg,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: SPACING.sm,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  actionCopy: { flex: 1 },
  actionTitle: { fontSize: 16, lineHeight: 21 },
  actionSub: { marginTop: 2 },
  primary: { marginTop: SPACING.md },
  footerNote: { textAlign: "center", marginTop: SPACING.lg },
});
