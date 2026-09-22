import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  // Built-in clipboard + share only: adding expo-clipboard would be a native
  // module, and therefore a fresh APK build, which this feature can't justify.
  Clipboard,
  Easing,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { router } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { doc, onSnapshot } from "firebase/firestore";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import AuthGate from "../../src/components/AuthGate";
import { useAuth } from "../../src/contexts/AuthContext";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import {
  getActiveRoutes,
  getDriverActiveTrip,
  getDriverDefaultRoute,
  setDriverAvailability,
  startTrip,
  endTrip,
  updateDriverSeats,
  updateDriverLocation,
  selfHealAfterRestart,
} from "../../src/services/transport";
import { getUserProfile, getPhotoURL } from "../../src/services/profile";
import { db } from "../../src/services/firebase";
import {
  formatCutoffHour,
  friendlyPaymentError,
  requestPayout,
} from "../../src/services/payments";
import {
  assignMateToTrip,
  decideJoinRequest,
  ensureMyIds,
  subscribeDriverConnections,
  subscribeDriverJoinRequests,
  unassignMateFromTrip,
} from "../../src/services/mates";
import { formatPesewas } from "../../src/utils/money";
import { COLORS, SPACING } from "../../src/theme";
import { MateConnection, MateJoinRequest, Route, Trip } from "../../src/types/models";
import { showToast } from "../../src/utils/toast";

/** Wallet buckets written by the backend; the app only ever reads them. */
const EMPTY_WALLET = {
  withdrawablePesewas: 0,
  pendingPesewas: 0,
  lifetimePesewas: 0,
  momoProvider: null as string | null,
  momoNumber: null as string | null,
};

const MOMO_LABELS: Record<string, string> = {
  mtn: "MTN MoMo",
  vod: "Telecel Cash",
  atl: "AT Money",
};

// ---------------------------------------------------------------------------
// Pulse dot for online status
// ---------------------------------------------------------------------------

function PulseDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1.8,
            duration: 1000,
            easing: Easing.out(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 1000,
            easing: Easing.in(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [scale, opacity]);

  return (
    <View style={styles.pulseWrap}>
      <Animated.View
        style={[
          styles.pulseRing,
          {
            backgroundColor: color,
            transform: [{ scale }],
            opacity,
          },
        ]}
      />
      <View style={[styles.pulseDot, { backgroundColor: color }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main driver dashboard — cockpit mode
// ---------------------------------------------------------------------------

export default function DriverDashboardScreen() {
  const { user } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(
    () => ({
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      statusTitle: { color: "#FFFFFF" },
      statusPanel: { backgroundColor: "#102A43" },
      statusPanelOnline: { backgroundColor: "#0D3320" },
      routeRow: { backgroundColor: colors.veryLightBlue + "BC" },
      selectedRoute: { borderColor: COLORS.primary, backgroundColor: colors.blueWash },
      seatCounterCard: { backgroundColor: colors.blueWash, borderColor: colors.veryLightBlue },
      seatBtn: { backgroundColor: colors.white, borderColor: colors.veryLightBlue },
      driverIcon: { backgroundColor: colors.blueWash },
    }),
    [colors]
  );

  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [lockedRouteId, setLockedRouteId] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(null);
  const [ending, setEnding] = useState(false);
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [seatCount, setSeatCount] = useState(12);
  const [wallet, setWallet] = useState(EMPTY_WALLET);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [driverCode, setDriverCode] = useState<string | null>(null);
  const [mateRequests, setMateRequests] = useState<MateJoinRequest[]>([]);
  const [mates, setMates] = useState<MateConnection[]>([]);
  const [mateBusyId, setMateBusyId] = useState<string | null>(null);
  const [assignedMateId, setAssignedMateId] = useState<string | null>(null);

  // Fetch user profile
  useEffect(() => {
    if (user?.uid) {
      getUserProfile(user.uid).then(setProfile).catch(() => {});
    }
  }, [user?.uid]);

  // Wallet balances live on the driver document and are backend-owned, so we
  // simply mirror them — the app can never credit itself.
  useEffect(() => {
    const driverId = user?.uid;
    if (!driverId) return;
    const unsub = onSnapshot(
      doc(db, "drivers", driverId),
      (snap) => {
        const data = snap.data();
        if (!data) return;
        setWallet({
          withdrawablePesewas: Number(data.walletBalancePesewas || 0),
          pendingPesewas: Number(data.pendingEarningsPesewas || 0),
          lifetimePesewas: Number(data.lifetimeEarningsPesewas || 0),
          momoProvider: (data.momoProvider as string) ?? null,
          momoNumber: (data.momoNumber as string) ?? null,
        });
      },
      () => {}
    );
    return unsub;
  }, [user?.uid]);

  // Driver ID, mate requests and connected mates — all live, so a request that
  // arrives while the driver is looking at this screen appears immediately.
  useEffect(() => {
    const uid = user?.uid;
    if (!uid) return;
    let cancelled = false;
    ensureMyIds()
      .then((ids) => {
        if (!cancelled) setDriverCode(ids.driverCode ?? null);
      })
      .catch(() => {});
    const unsubRequests = subscribeDriverJoinRequests(uid, setMateRequests, () => {});
    const unsubConnections = subscribeDriverConnections(uid, setMates, () => {});
    return () => {
      cancelled = true;
      unsubRequests();
      unsubConnections();
    };
  }, [user?.uid]);

  // Which mate is on the running trip. Assigning and unassigning update this
  // straight away so the card never shows a stale decision.
  useEffect(() => {
    setAssignedMateId(activeTrip?.mateId ?? null);
  }, [activeTrip?.id, activeTrip?.mateId]);

  const handleWithdraw = async () => {
    if (payoutBusy) return;
    setPayoutBusy(true);
    try {
      const result = await requestPayout();
      showToast(
        "success",
        "Withdrawal requested",
        result.message ||
          `${formatPesewas(result.amountPesewas)} is on its way to your Mobile Money wallet.`
      );
    } catch (error) {
      showToast("error", "Withdrawal", friendlyPaymentError(error));
    } finally {
      setPayoutBusy(false);
    }
  };

  // Check for active trip on mount
  useEffect(() => {
    const driverId = user?.uid;
    if (!driverId) return;

    // If the app was killed while online, take the driver back offline -
    // passengers must never see a driver who isn't running the app.
    selfHealAfterRestart(driverId).catch(() => {});

    getDriverActiveTrip(driverId)
      .then((trip) => {
        if (trip) {
          setActiveTrip(trip);
          setOnline(true);
          setSelectedRouteId(trip.routeId);
        }
      })
      .catch((error) => console.error("Active trip check error:", error));
  }, [user?.uid]);

  useEffect(() => {
    const driverId = user?.uid;
    Promise.all([
      getActiveRoutes(),
      driverId ? getDriverDefaultRoute(driverId) : Promise.resolve(null),
    ])
      .then(([activeRoutes, defaultRouteId]) => {
        setRoutes(activeRoutes);
        if (defaultRouteId && activeRoutes.some((r) => r.id === defaultRouteId)) {
          // Saved default wins — it's locked until changed in Profile settings.
          setLockedRouteId(defaultRouteId);
          setSelectedRouteId(defaultRouteId);
        } else if (!selectedRouteId && activeRoutes.length > 0) {
          setSelectedRouteId(activeRoutes[0].id);
        }
      })
      .catch((error) => console.error("Driver route loading error:", error))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Keep the screen awake while online — a driver mid-trip must never miss a booking.
  useEffect(() => {
    if (online) {
      activateKeepAwakeAsync().catch(() => {});
    } else {
      deactivateKeepAwake();
    }
  }, [online]);

  // Location tracking when online
  useEffect(() => {
    const driverId = user?.uid;
    if (!online || !driverId) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;

    const startLocationTracking = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setOnline(false);
        showToast(
          "warning",
          "Location needed",
          "Location permission is required while you are online."
        );
        return;
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 8000,
          distanceInterval: 12,
        },
        ({ coords }) => {
          if (!cancelled) {
            void updateDriverLocation(driverId, coords.latitude, coords.longitude);
          }
        }
      );
    };

    void startLocationTracking().catch((error) => {
      console.error("Location tracking error:", error);
    });

    return () => {
      cancelled = true;
      try {
        subscription?.remove();
      } catch {
        // expo-location cleanup — safe to ignore
      }
    };
  }, [online, user?.uid]);

  const pendingMateRequests = mateRequests.filter((r) => r.status === "pending");
  const connectedMates = mates.filter((m) => m.status === "active");

  const copyDriverId = async () => {
    if (!driverCode) return;
    Clipboard.setString(driverCode);
    showToast("success", "Driver ID copied", "Give it to your mate so they can ask to join you.");
  };

  const shareDriverId = async () => {
    if (!driverCode) return;
    try {
      await Share.share({
        message: `Join me as my mate on EasyTroski. My Driver ID is ${driverCode}.`,
      });
    } catch {
      // The user dismissed the share sheet — nothing to report.
    }
  };

  const handleMateDecision = async (requestId: string, decision: "accept" | "reject") => {
    if (mateBusyId) return;
    setMateBusyId(requestId);
    try {
      await decideJoinRequest(requestId, decision);
      if (decision === "accept") {
        showToast(
          "success",
          "Mate added",
          "Assign them to a trip when you are ready to drive."
        );
      } else {
        showToast("info", "Request declined", "The mate has been told.");
      }
    } catch (error) {
      showToast("error", "Couldn't do that", friendlyPaymentError(error));
    } finally {
      setMateBusyId(null);
    }
  };

  const handleAssignMate = async (mateId: string) => {
    if (!activeTrip) {
      showToast("info", "Start the trip first", "A mate can only be assigned while a trip is running.");
      return;
    }
    if (mateBusyId) return;
    setMateBusyId(mateId);
    try {
      const result = await assignMateToTrip(activeTrip.id, mateId);
      setAssignedMateId(result.mateId);
      showToast(
        "success",
        "Mate assigned",
        "They handle passenger bookings from now on."
      );
    } catch (error) {
      showToast("error", "Couldn't assign", friendlyPaymentError(error));
    } finally {
      setMateBusyId(null);
    }
  };

  const handleUnassignMate = async () => {
    if (!activeTrip || !assignedMateId || mateBusyId) return;
    setMateBusyId(assignedMateId);
    try {
      await unassignMateFromTrip(activeTrip.id);
      setAssignedMateId(null);
      showToast(
        "info",
        "Mate removed from this trip",
        "Assign a Mate before accepting passenger bookings."
      );
    } catch (error) {
      showToast("error", "Couldn't remove", friendlyPaymentError(error));
    } finally {
      setMateBusyId(null);
    }
  };

  const handleAvailability = async (nextOnline: boolean) => {
    const driverId = user?.uid;
    if (!driverId) return;

    setOnline(nextOnline);
    try {
      await setDriverAvailability(driverId, nextOnline);
    } catch {
      setOnline(!nextOnline);
      showToast("error", "Update failed", "Could not update your availability.");
    }
  };

  const handleStartTrip = async () => {
    const driverId = user?.uid;
    if (!driverId || !selectedRouteId) {
      showToast("warning", "No route", "Choose a route before starting.");
      return;
    }
    if (activeTrip) {
      showToast("warning", "Trip active", "End your current trip first.");
      return;
    }

    setStarting(true);
    try {
      const tripId = await startTrip(driverId, selectedRouteId, "going", seatCount);
      // Land the driver on the map where live bookings appear
      router.replace("/driver-map");
      setActiveTrip({
        id: tripId,
        driverId,
        routeId: selectedRouteId,
        status: "in_progress",
        direction: "going",
        startTime: new Date() as any,
      });
      setOnline(true);
      showToast("success", "Trip started", "Passengers can now see you.");
    } catch {
      showToast("error", "Failed", "Could not start trip. Try again.");
    } finally {
      setStarting(false);
    }
  };

  const handleEndTrip = async () => {
    const driverId = user?.uid;
    if (!activeTrip || !driverId) return;

    setEnding(true);
    try {
      await endTrip(activeTrip.id, driverId);
      setActiveTrip(null);
      setOnline(false);
      showToast("success", "Trip ended", "You are now offline.");
    } catch {
      showToast("error", "Failed", "Could not end trip. Try again.");
    } finally {
      setEnding(false);
    }
  };

  const handleUpdateSeats = async (newCount: number) => {
    const driverId = user?.uid;
    if (!driverId) return;
    const clamped = Math.max(0, Math.min(30, newCount));
    setSeatCount(clamped);
    try {
      await updateDriverSeats(driverId, clamped);
    } catch {
      showToast("error", "Failed", "Could not update seat count.");
    }
  };

  const displayName =
    profile?.name || user?.displayName || user?.email?.split("@")[0] || "Driver";
  const photoURL = getPhotoURL(user, profile);

  return (
    <AuthGate allowedRoles={["driver"]}>
      <AppBackground>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* ─── Status header ─── */}
          <View style={styles.headerRow}>
            <View style={styles.statusCopy}>
              {online && <PulseDot color={COLORS.success} />}
              <AppText variant="heading" style={[styles.driverName, ds.text]}>
                {displayName}
              </AppText>
            </View>
            <Pressable
              onPress={() => router.push("/profile")}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.driverIcon, ds.driverIcon]}>
                {photoURL ? (
                  <Image source={{ uri: photoURL }} style={styles.driverPhoto} resizeMode="cover" />
                ) : (
                  <MaterialCommunityIcons name="account" size={24} color={colors.primary} />
                )}
              </View>
            </Pressable>
          </View>

          {/* ─── Status panel + online switch ─── */}
          <View style={[styles.statusPanel, ds.statusPanel, online && ds.statusPanelOnline]}>
            <View style={styles.statusCopy}>
              <AppText variant="heading" style={[styles.statusTitle, ds.statusTitle]} numberOfLines={1}>
                {activeTrip ? "Trip active" : online ? "You are online" : "You are offline"}
              </AppText>
              <AppText variant="caption" style={styles.statusText} numberOfLines={2}>
                {activeTrip
                  ? "Passengers can see your trip on the map."
                  : online
                    ? "Passengers can find your active trip."
                    : "Go online when you are ready to drive."}
              </AppText>
            </View>
            {!activeTrip && (
              <Switch
                value={online}
                onValueChange={(v) => void handleAvailability(v)}
                trackColor={{ false: "#4A5568", true: COLORS.success }}
                thumbColor={COLORS.white}
              />
            )}
          </View>

          {/* ─── Active trip quick actions ─── */}
          {activeTrip && (
            <View style={styles.activeTripRow}>
              <Pressable
                style={({ pressed }) => [styles.activeTripBtn, pressed && { opacity: 0.7 }]}
                onPress={() => router.navigate("/driver-map")}
              >
                <MaterialCommunityIcons name="map" size={20} color={COLORS.primary} />
                <AppText variant="body" style={[styles.activeTripBtnText, ds.text]}>
                  Open map
                </AppText>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.activeTripBtn, styles.activeTripBtnEnd, pressed && { opacity: 0.7 }]}
                onPress={() => void handleEndTrip()}
                disabled={ending}
              >
                <MaterialCommunityIcons name="stop-circle-outline" size={20} color={COLORS.white} />
                <AppText variant="body" style={styles.activeTripBtnEndText}>
                  {ending ? "Ending..." : "End trip"}
                </AppText>
              </Pressable>
            </View>
          )}

          {/* ─── Routes ─── */}
          <AppText variant="caption" style={[styles.sectionLabel, ds.secondary]}>
            {activeTrip ? "CURRENT ROUTE" : lockedRouteId ? "YOUR DEFAULT ROUTE" : "CHOOSE YOUR ROUTE"}
          </AppText>
          {lockedRouteId && (
            <AppText variant="caption" style={[styles.lockNote, ds.secondary]}>
              Locked as your default — change it in Profile settings.
            </AppText>
          )}
          {loading ? (
            <ActivityIndicator color={COLORS.primary} style={{ marginVertical: SPACING.lg }} />
          ) : routes.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons
                name="map-marker-off-outline"
                size={36}
                color={colors.textSecondary}
              />
              <AppText variant="body" style={[styles.emptyText, ds.secondary]}>
                No routes available yet.
              </AppText>
              <AppText variant="caption" style={[styles.emptyHint, ds.secondary]}>
                Contact an admin to add routes.
              </AppText>
            </View>
          ) : (
            <View style={styles.routeList}>
              {routes.map((route) => (
                <Pressable
                  key={route.id}
                  style={[
                    [styles.routeRow, ds.routeRow],
                    route.id === selectedRouteId && [styles.selectedRoute, ds.selectedRoute],
                    lockedRouteId && route.id !== selectedRouteId && styles.routeRowDim,
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
                  <View style={styles.routeRadio}>
                    <View
                      style={[
                        styles.routeRadioInner,
                        route.id === selectedRouteId && styles.routeRadioActive,
                      ]}
                    />
                  </View>
                  <View style={styles.routeCopy}>
                    <AppText variant="heading" style={[styles.routeTitle, ds.text]}>
                      {route.origin}
                    </AppText>
                    <AppText variant="caption" style={[styles.routeDest, ds.secondary]}>
                      → {route.destination}
                      {route.stops?.length ? ` (${route.stops.length} stops)` : ""}
                    </AppText>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* ─── Seat counter ─── */}
          {!activeTrip && (
            <View style={[styles.seatCounterCard, ds.seatCounterCard]}>
              <View style={styles.seatCounterLeft}>
                <MaterialCommunityIcons name="seat" size={20} color={COLORS.primary} />
                <AppText variant="heading" style={[styles.seatCounterLabel, ds.text]}>
                  Available seats
                </AppText>
              </View>
              <View style={styles.seatCounterControls}>
                <Pressable
                  style={[styles.seatBtn, ds.seatBtn]}
                  onPress={() => void handleUpdateSeats(seatCount - 1)}
                >
                  <MaterialCommunityIcons name="minus" size={18} color={COLORS.primary} />
                </Pressable>
                <AppText variant="heading" style={[styles.seatCountText, ds.text]}>
                  {seatCount}
                </AppText>
                <Pressable
                  style={[styles.seatBtn, ds.seatBtn]}
                  onPress={() => void handleUpdateSeats(seatCount + 1)}
                >
                  <MaterialCommunityIcons name="plus" size={18} color={COLORS.primary} />
                </Pressable>
              </View>
            </View>
          )}

          {/* ─── Giant start trip button ─── */}
          {!activeTrip && (
            <PrimaryButton
              title={starting ? "Starting..." : "Start trip"}
              onPress={() => void handleStartTrip()}
              disabled={starting || !selectedRouteId}
              style={styles.startButton}
            />
          )}

          {/* ─── Earnings ───
              Deliberately last: money is checked between trips, never while
              driving, so it can't compete with the trip controls. */}
          <View style={[styles.walletCard, ds.seatCounterCard]}>
            <View style={styles.walletHeader}>
              <View style={styles.walletHeaderLeft}>
                <MaterialCommunityIcons name="wallet-outline" size={20} color={COLORS.primary} />
                <AppText variant="caption" style={[styles.walletEyebrow, ds.secondary]}>
                  EARNINGS
                </AppText>
              </View>
              <AppText variant="caption" style={[styles.walletHint, ds.secondary]}>
                Withdrawals open at {formatCutoffHour()}
              </AppText>
            </View>

            <View style={styles.walletBalanceRow}>
              <AppText variant="title" style={[styles.walletBalance, ds.text]}>
                {formatPesewas(wallet.withdrawablePesewas)}
              </AppText>
              <AppText variant="caption" style={[styles.walletBalanceLabel, ds.secondary]}>
                ready to withdraw
              </AppText>
            </View>

            <View style={styles.walletSplit}>
              <View style={styles.walletSplitItem}>
                <AppText variant="caption" style={[styles.walletSplitLabel, ds.secondary]}>
                  Pending
                </AppText>
                <AppText variant="body" style={[styles.walletSplitValue, ds.text]}>
                  {formatPesewas(wallet.pendingPesewas)}
                </AppText>
              </View>
              <View style={styles.walletSplitItem}>
                <AppText variant="caption" style={[styles.walletSplitLabel, ds.secondary]}>
                  Lifetime
                </AppText>
                <AppText variant="body" style={[styles.walletSplitValue, ds.text]}>
                  {formatPesewas(wallet.lifetimePesewas)}
                </AppText>
              </View>
            </View>

            {wallet.momoNumber ? (
              <View style={styles.walletAccountRow}>
                <MaterialCommunityIcons name="cellphone" size={14} color={COLORS.textSecondary} />
                <AppText variant="caption" style={[styles.walletAccount, ds.secondary]}>
                  Paid to {MOMO_LABELS[wallet.momoProvider || ""] || "Mobile Money"} · {wallet.momoNumber}
                </AppText>
              </View>
            ) : (
              <Pressable onPress={() => router.push("/profile")}>
                <AppText variant="caption" style={styles.walletAccountMissing}>
                  Add your Mobile Money details in Profile settings to get paid.
                </AppText>
              </Pressable>
            )}

            <PrimaryButton
              title={payoutBusy ? "Requesting..." : "Withdraw earnings"}
              onPress={() => void handleWithdraw()}
              disabled={payoutBusy || wallet.withdrawablePesewas <= 0}
              style={styles.walletButton}
            />
          </View>
          {/* ─── My Mates ───
              The Driver ID a mate needs in order to ask to join, the requests
              that arrive against it, and who is working today's trip. */}
          <View style={[styles.mateCard, ds.seatCounterCard]}>
            <View style={styles.mateHeader}>
              <View style={styles.mateHeaderLeft}>
                <MaterialCommunityIcons name="account-group" size={20} color={COLORS.primary} />
                <AppText variant="caption" style={[styles.mateEyebrow, ds.secondary]}>
                  MY MATES
                </AppText>
              </View>
              {driverCode ? (
                <View style={styles.mateIdRow}>
                  <AppText variant="caption" style={[styles.mateIdText, ds.text]}>
                    {driverCode}
                  </AppText>
                  <Pressable
                    style={({ pressed }) => [styles.mateIconBtn, pressed && { opacity: 0.7 }]}
                    onPress={() => void copyDriverId()}
                  >
                    <MaterialCommunityIcons name="content-copy" size={15} color={COLORS.primary} />
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.mateIconBtn, pressed && { opacity: 0.7 }]}
                    onPress={() => void shareDriverId()}
                  >
                    <MaterialCommunityIcons name="share-variant" size={15} color={COLORS.primary} />
                  </Pressable>
                </View>
              ) : null}
            </View>

            <AppText variant="caption" style={[styles.mateHelp, ds.secondary]}>
              {driverCode
                ? "Give a mate this ID so they can join you. Your Mate handles passenger bookings, so assign one before you take requests."
                : "Creating your Driver ID..."}
            </AppText>

            {activeTrip && !assignedMateId ? (
              <AppText variant="caption" style={[styles.mateHelp, ds.secondary]}>
                No Mate assigned — passenger booking requests cannot be handled.
              </AppText>
            ) : null}

            {pendingMateRequests.length > 0 ? (
              <View style={styles.mateList}>
                <AppText variant="caption" style={[styles.mateSectionLabel, ds.secondary]}>
                  MATE REQUESTS
                </AppText>
                {pendingMateRequests.map((request) => (
                  <View key={request.id} style={styles.mateRow}>
                    <View style={[styles.mateAvatar, ds.driverIcon]}>
                      <MaterialCommunityIcons name="account-tie" size={18} color={COLORS.primary} />
                    </View>
                    <View style={styles.mateRowCopy}>
                      <AppText variant="body" style={[styles.mateRowName, ds.text]} numberOfLines={1}>
                        {request.mateName || "A mate"}
                      </AppText>
                      <AppText variant="caption" style={[styles.mateRowSub, ds.secondary]} numberOfLines={1}>
                        {request.mateCode || "Wants to join you"}
                      </AppText>
                    </View>
                    <View style={styles.mateRowActions}>
                      <Pressable
                        style={({ pressed }) => [
                          styles.mateSmallBtn,
                          styles.mateRejectBtn,
                          pressed && { opacity: 0.7 },
                        ]}
                        disabled={Boolean(mateBusyId)}
                        onPress={() => void handleMateDecision(request.id, "reject")}
                      >
                        <AppText variant="caption" style={styles.mateRejectText}>
                          Reject
                        </AppText>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [
                          styles.mateSmallBtn,
                          styles.mateAcceptBtn,
                          pressed && { opacity: 0.7 },
                        ]}
                        disabled={Boolean(mateBusyId)}
                        onPress={() => void handleMateDecision(request.id, "accept")}
                      >
                        <AppText variant="caption" style={styles.mateAcceptText}>
                          Accept
                        </AppText>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {connectedMates.length > 0 ? (
              <View style={styles.mateList}>
                <AppText variant="caption" style={[styles.mateSectionLabel, ds.secondary]}>
                  YOUR MATES
                </AppText>
                {connectedMates.map((mate) => {
                  const working = assignedMateId === mate.mateId;
                  return (
                    <View key={mate.id} style={styles.mateRow}>
                      <View style={[styles.mateAvatar, ds.driverIcon]}>
                        <MaterialCommunityIcons
                          name={working ? "account-check" : "account-tie"}
                          size={18}
                          color={working ? COLORS.success : COLORS.primary}
                        />
                      </View>
                      <View style={styles.mateRowCopy}>
                        <AppText variant="body" style={[styles.mateRowName, ds.text]} numberOfLines={1}>
                          {mate.mateName || "Your mate"}
                        </AppText>
                        <AppText variant="caption" style={[styles.mateRowSub, ds.secondary]} numberOfLines={1}>
                          {working ? "Working this trip" : "Connected"}
                        </AppText>
                      </View>
                      {activeTrip ? (
                        <Pressable
                          style={({ pressed }) => [
                            styles.mateSmallBtn,
                            working ? styles.mateRejectBtn : styles.mateAssignBtn,
                            pressed && { opacity: 0.7 },
                          ]}
                          disabled={Boolean(mateBusyId)}
                          onPress={() =>
                            working ? void handleUnassignMate() : void handleAssignMate(mate.mateId)
                          }
                        >
                          <AppText
                            variant="caption"
                            style={working ? styles.mateRejectText : styles.mateAcceptText}
                          >
                            {working ? "Remove" : "Assign"}
                          </AppText>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {pendingMateRequests.length === 0 && connectedMates.length === 0 ? (
              <AppText variant="caption" style={[styles.mateHelp, ds.secondary]}>
                No mates yet. Anyone who enters your Driver ID will appear here for you to approve.
              </AppText>
            ) : null}
          </View>
        </ScrollView>
      </AppBackground>
    </AuthGate>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  mateCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: SPACING.lg,
    marginTop: SPACING.lg,
  },
  mateHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.sm,
  },
  mateHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  mateEyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  mateIdRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  mateIdText: {
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  mateIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  mateHelp: {
    marginTop: SPACING.sm,
    fontSize: 12,
    lineHeight: 17,
  },
  mateList: {
    marginTop: SPACING.md,
  },
  mateSectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },
  mateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: "rgba(23,105,224,0.10)",
  },
  mateAvatar: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  mateRowCopy: { flex: 1 },
  mateRowName: { fontWeight: "600" },
  mateRowSub: { marginTop: 1, fontSize: 11 },
  mateRowActions: { flexDirection: "row", gap: SPACING.xs },
  mateSmallBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 12,
  },
  mateRejectBtn: {
    backgroundColor: "rgba(239,68,68,0.10)",
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  mateRejectText: { color: COLORS.danger, fontWeight: "700" },
  mateAcceptBtn: { backgroundColor: COLORS.success },
  mateAssignBtn: { backgroundColor: COLORS.primary },
  mateAcceptText: { color: COLORS.white, fontWeight: "700" },
  walletCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: SPACING.lg,
    marginTop: SPACING.xl,
  },
  walletHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACING.sm,
  },
  walletHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
  },
  walletEyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  walletHint: {
    fontSize: 10,
  },
  walletBalanceRow: {
    marginTop: SPACING.md,
  },
  walletBalance: {
    fontSize: 30,
    lineHeight: 36,
  },
  walletBalanceLabel: {
    marginTop: 2,
  },
  walletSplit: {
    flexDirection: "row",
    marginTop: SPACING.md,
    gap: SPACING.lg,
  },
  walletSplitItem: {
    flex: 1,
  },
  walletSplitLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  walletSplitValue: {
    marginTop: 2,
    fontWeight: "600",
  },
  walletAccountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    marginTop: SPACING.md,
  },
  walletAccount: {
    flex: 1,
  },
  walletAccountMissing: {
    color: COLORS.accent,
    marginTop: SPACING.md,
    fontWeight: "600",
  },
  walletButton: {
    marginTop: SPACING.md,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
    paddingBottom: 120,
  },

  /* ── Header ── */
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: SPACING.lg,
  },
  statusCopy: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    flex: 1,
  },
  driverName: { fontSize: 22, lineHeight: 28 },
  driverIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  driverPhoto: { width: 46, height: 46, borderRadius: 16 },

  /* ── Status panel ── */
  statusPanel: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.lg,
    borderRadius: 20,
    backgroundColor: "#102A43",
    marginBottom: SPACING.lg,
  },
  statusTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 24,
    flexShrink: 1,
  },
  statusText: {
    color: "rgba(255,255,255,0.72)",
    marginTop: 3,
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },

  /* ── Pulse dot ── */
  pulseWrap: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pulseRing: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  /* ── Active trip quick actions ── */
  activeTripRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  activeTripBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.xs,
    paddingVertical: SPACING.md,
    borderRadius: 16,
    backgroundColor: COLORS.blueWash,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  activeTripBtnText: { color: COLORS.primary, fontWeight: "700" },
  activeTripBtnEnd: {
    backgroundColor: COLORS.danger,
    borderColor: COLORS.danger,
  },
  activeTripBtnEndText: { color: COLORS.white, fontWeight: "700" },

  /* ── Routes ── */
  sectionLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: SPACING.sm,
  },
  routeList: { gap: SPACING.sm },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.lg,
    borderRadius: 18,
    backgroundColor: "rgba(232,243,255,0.72)",
    borderWidth: 1.5,
    borderColor: "transparent",
  },
  selectedRoute: {
    borderColor: COLORS.primary,
  },
  routeRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: SPACING.md,
  },
  routeRadioInner: {
    width: 0,
    height: 0,
    borderRadius: 0,
  },
  routeRadioActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  routeCopy: { flex: 1 },
  routeTitle: { fontSize: 16, lineHeight: 21 },
  routeDest: { marginTop: 2 },
  routeRowDim: {
    opacity: 0.55,
  },
  lockNote: {
    fontSize: 12,
    marginTop: -2,
    marginBottom: SPACING.sm,
  },

  emptyState: { alignItems: "center", padding: SPACING.xl },
  emptyText: {
    textAlign: "center",
    marginTop: SPACING.sm,
  },
  emptyHint: {
    textAlign: "center",
    marginTop: SPACING.xs,
    opacity: 0.6,
    fontSize: 12,
  },

  /* ── Seat counter ── */
  seatCounterCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.lg,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  seatCounterLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  seatCounterLabel: {
    fontSize: 15,
  },
  seatCounterControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
  },
  seatBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  seatCountText: {
    fontSize: 24,
    minWidth: 36,
    textAlign: "center",
  },

  /* ── Start button ── */
  startButton: {
    marginTop: SPACING.md,
    height: 60,
    borderRadius: 18,
  },
});
