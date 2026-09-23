import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { doc, onSnapshot } from "firebase/firestore";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import AuthGate from "../../src/components/AuthGate";
import { auth, db } from "../../src/services/firebase";
import { getDriverProfile, getRoute } from "../../src/services/transport";
import {
  PAYMENTS_ENV,
  cancelBookingViaApi,
  checkPayment,
  friendlyPaymentError,
  initiateCharge,
  isPaymentsConfigured,
  submitChargeOtp,
} from "../../src/services/payments";
import { formatPesewas, normaliseGhanaPhone } from "../../src/utils/money";
import { COLORS, SPACING } from "../../src/theme";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import { showToast } from "../../src/utils/toast";
import type { MomoProvider } from "../../src/types/models";

/**
 * Where the checkout is in its journey. Payment truth always comes from the
 * backend — these phases only decide what we *show*.
 */
type Phase =
  | "review"          // picked nothing yet; passenger chooses network + number
  | "charging"        // request in flight
  | "approve_on_phone" // MoMo prompt sent; passenger must approve on their phone
  | "otp"             // wallet wants a one-time code
  | "verifying"       // we're checking with the provider
  | "paid"
  | "failed"
  | "expired"
  | "cancelled"
  | "rejected";

const MOMO_NETWORKS: { id: MomoProvider; label: string; hint: string }[] = [
  { id: "mtn", label: "MTN", hint: "MTN Mobile Money" },
  { id: "vod", label: "Telecel", hint: "Telecel Cash" },
  { id: "atl", label: "AT", hint: "AT Money" },
];

const POLL_MS = 5000;

function secondsUntil(iso?: string | null): number {
  if (!iso) return 0;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.round((at - Date.now()) / 1000));
}

function formatCountdown(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function PayBookingScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId?: string }>();
  const { colors } = useThemeColors();

  const [booking, setBooking] = useState<Record<string, any> | null>(null);
  const [loadingBooking, setLoadingBooking] = useState(true);
  const [routeLabel, setRouteLabel] = useState<{ origin: string; destination: string } | null>(null);
  const [driverInfo, setDriverInfo] = useState<{ name?: string; plate?: string; color?: string } | null>(null);

  const [phase, setPhase] = useState<Phase>("review");
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const [momoProvider, setMomoProvider] = useState<MomoProvider | null>(null);
  const [momoNumber, setMomoNumber] = useState("");
  const [otp, setOtp] = useState("");

  // Never let a stale interval or a late response overwrite a finished state.
  const finishedRef = useRef(false);
  /** True once a charge exists: the booking then belongs to the payment UI, so
   *  a routine document update must not drop the passenger back to "review"
   *  and invite a second payment. */
  const chargeStartedRef = useRef(false);
  const markFinished = useCallback((next: Phase) => {
    finishedRef.current = true;
    setPhase(next);
  }, []);

  const ds = useMemo(
    () => ({
      title: { color: colors.text },
      body: { color: colors.textSecondary },
      label: { color: colors.textSecondary },
      card: { backgroundColor: colors.surface, borderColor: colors.glassBorder },
      input: { color: colors.text, borderColor: colors.glassBorder, backgroundColor: colors.surface },
      strong: { color: colors.text },
    }),
    [colors]
  );

  // ── Live booking document ────────────────────────────────────────────
  useEffect(() => {
    if (!bookingId) {
      setLoadingBooking(false);
      return;
    }
    const unsub = onSnapshot(
      doc(db, "bookings", bookingId),
      (snap) => {
        if (!snap.exists()) {
          setLoadingBooking(false);
          return;
        }
        const data = { ...snap.data(), id: snap.id } as Record<string, any>;
        setBooking(data);
        setLoadingBooking(false);

        // The backend may close the booking while we're on this screen.
        if (data.status === "expired") markFinished("expired");
        else if (data.status === "cancelled") {
          markFinished(data.cancelReason === "rejected_by_driver" ? "rejected" : "cancelled");
        } else if (data.paymentStatus === "paid" || data.status === "confirmed") {
          markFinished("paid");
        } else if (data.paymentStatus === "failed" && !chargeStartedRef.current) {
          markFinished("failed");
        } else if (data.status === "awaiting_payment" && !finishedRef.current && !chargeStartedRef.current) {
          setPhase("review");
        }
      },
      () => setLoadingBooking(false)
    );
    return unsub;
  }, [bookingId, markFinished]);

  // ── Route + driver details (display only) ────────────────────────────
  useEffect(() => {
    const routeId = booking?.routeId;
    if (!routeId) return;
    let cancelled = false;
    getRoute(String(routeId))
      .then((r) => {
        if (!cancelled && r) setRouteLabel({ origin: r.origin, destination: r.destination });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [booking?.routeId]);

  useEffect(() => {
    const driverId = booking?.driverId;
    if (!driverId) return;
    let cancelled = false;
    getDriverProfile(String(driverId))
      .then((res) => {
        if (cancelled || !res) return;
        setDriverInfo({
          name: res.driver?.name || res.driver?.displayName || undefined,
          plate: res.driver?.vehiclePlate || res.vehicle?.numberPlate || res.driver?.vehicleRegistration || undefined,
          color: res.vehicle?.color || res.driver?.vehicleColor || undefined,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [booking?.driverId]);

  // ── Default the payer number from the passenger's own profile ────────
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    let cancelled = false;
    const unsub = onSnapshot(doc(db, "users", uid), (snap) => {
      if (cancelled) return;
      const phone = snap.data()?.phone;
      if (typeof phone === "string" && phone) setMomoNumber((current) => current || phone);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // ── Countdown on the payment window ──────────────────────────────────
  useEffect(() => {
    const deadline = booking?.paymentDeadlineAt as string | undefined;
    if (!deadline) {
      setCountdown(0);
      return;
    }
    const tick = () => setCountdown(secondsUntil(deadline));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [booking?.paymentDeadlineAt]);

  // ── Poll the backend while a charge is in flight ─────────────────────
  useEffect(() => {
    if (!bookingId) return;
    const watching = phase === "charging" || phase === "approve_on_phone" || phase === "verifying";
    if (!watching || finishedRef.current) return;

    let stopped = false;
    const probe = async () => {
      try {
        const result = await checkPayment(bookingId);
        if (stopped || finishedRef.current) return;
        if (result.paid) {
          markFinished("paid");
          showToast("success", "Payment successful", "Your seat is confirmed.");
          return;
        }
        if (result.status === "expired") markFinished("expired");
        else if (result.status === "cancelled") markFinished("cancelled");
        else if (result.paymentStatus === "failed") markFinished("failed");
      } catch {
        // Weak network is expected here — the countdown keeps ticking and we retry.
      }
    };
    void probe();
    const id = setInterval(probe, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [bookingId, phase, markFinished]);

  const applyChargeResult = useCallback(
    (result: { state: string; displayText?: string; alreadyInProgress?: boolean }) => {
      if (result.state === "success") {
        markFinished("paid");
        return;
      }
      if (result.state === "send_otp") {
        setPhase("otp");
        showToast("info", "Enter the code", "Your wallet sent you a one-time code.");
        return;
      }
      setPhase("approve_on_phone");
      if (result.alreadyInProgress) {
        showToast("info", "Still verifying", "Please don't pay again yet — we're checking your payment.");
      } else {
        showToast(
          "info",
          "Approve on your phone",
          result.displayText || "Check your phone and approve the Mobile Money request."
        );
      }
    },
    [markFinished]
  );

  const handlePay = useCallback(async () => {
    if (!bookingId) return;
    if (!isPaymentsConfigured()) {
      showToast("error", "Payments unavailable", "Payments are not configured yet. Please update the app.");
      return;
    }
    if (!momoProvider) {
      showToast("error", "Choose a network", "Select the Mobile Money network you're paying from.");
      return;
    }
    const payerPhone = normaliseGhanaPhone(momoNumber);
    if (!payerPhone) {
      showToast("error", "Check your number", "Enter a valid Mobile Money number, e.g. 024 000 0000.");
      return;
    }

    setBusy(true);
    setPhase("charging");
    try {
      chargeStartedRef.current = true;
      const result = await initiateCharge(bookingId, momoProvider, payerPhone);
      applyChargeResult(result);
    } catch (error) {
      // A rejected charge must not leave the screen stuck in "charging".
      chargeStartedRef.current = false;
      setPhase("review");
      showToast("error", "Payment", friendlyPaymentError(error));
    } finally {
      setBusy(false);
    }
  }, [bookingId, momoProvider, momoNumber, applyChargeResult]);

  const handleSubmitOtp = useCallback(async () => {
    if (!bookingId) return;
    chargeStartedRef.current = true;
    const code = otp.trim();
    if (!code) {
      showToast("error", "Enter the code", "Type the one-time code your wallet sent you.");
      return;
    }
    setBusy(true);
    setPhase("verifying");
    try {
      const result = await submitChargeOtp(bookingId, code);
      setOtp("");
      applyChargeResult(result);
    } catch (error) {
      setPhase("otp");
      showToast("error", "Payment", friendlyPaymentError(error));
    } finally {
      setBusy(false);
    }
  }, [bookingId, otp, applyChargeResult]);

  const handleCancel = useCallback(async () => {
    if (!bookingId) return;
    setBusy(true);
    try {
      await cancelBookingViaApi(bookingId, "passenger");
      markFinished("cancelled");
      showToast("info", "Booking cancelled", "Your seats have been released.");
    } catch (error) {
      showToast("error", "Cancel failed", friendlyPaymentError(error));
    } finally {
      setBusy(false);
    }
  }, [bookingId, markFinished]);

  const seats = Number(booking?.seats || 1);
  const farePerSeat = Number(booking?.farePerSeatPesewas || 0);
  const total = Number(booking?.totalPesewas || 0);
  const refund = booking?.refund as { status?: string; amountPesewas?: number } | undefined;

  const origin = routeLabel?.origin || booking?.pickupLocation?.address || "Pickup point";
  const destination = routeLabel?.destination || booking?.dropOffLocation?.address || "Destination";

  if (!bookingId) {
    return (
      <AuthGate>
        <AppBackground>
          <View style={styles.centerState}>
            <MaterialCommunityIcons name="receipt-text-outline" size={44} color={COLORS.textSecondary} />
            <AppText variant="heading" style={[styles.stateTitle, ds.title]}>
              Booking not found
            </AppText>
            <AppText variant="body" style={[styles.stateText, ds.body]}>
              We couldn't open this booking. Please go back and try again.
            </AppText>
            <PrimaryButton title="Back" onPress={() => router.back()} style={styles.stateButton} />
          </View>
        </AppBackground>
      </AuthGate>
    );
  }

  if (loadingBooking) {
    return (
      <AuthGate>
        <AppBackground>
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <AppText variant="body" style={[styles.stateText, ds.body]}>
              Loading your booking...
            </AppText>
          </View>
        </AppBackground>
      </AuthGate>
    );
  }

  // ── Terminal states each get one clear message and one way forward ───
  if (phase === "paid") {
    return (
      <AuthGate>
        <AppBackground>
          <View style={styles.centerState}>
            <View style={[styles.stateIcon, { backgroundColor: "rgba(34,197,94,0.12)" }]}>
              <MaterialCommunityIcons name="check-circle" size={48} color={COLORS.success} />
            </View>
            <AppText variant="heading" style={[styles.stateTitle, ds.title]}>
              Payment successful
            </AppText>
            <AppText variant="body" style={[styles.stateText, ds.body]}>
              {seats} seat{seats > 1 ? "s" : ""} confirmed on {origin} → {destination} for{" "}
              {formatPesewas(total)}. Your driver has been notified.
            </AppText>
            <PrimaryButton title="Done" onPress={() => router.replace("/home")} style={styles.stateButton} />
          </View>
        </AppBackground>
      </AuthGate>
    );
  }

  if (phase === "expired") {
    return (
      <AuthGate>
        <AppBackground>
          <View style={styles.centerState}>
            <View style={[styles.stateIcon, { backgroundColor: "rgba(245,158,11,0.12)" }]}>
              <MaterialCommunityIcons name="timer-off-outline" size={44} color={COLORS.warning} />
            </View>
            <AppText variant="heading" style={[styles.stateTitle, ds.title]}>
              Payment window closed
            </AppText>
            <AppText variant="body" style={[styles.stateText, ds.body]}>
              We didn't receive your payment in time, so your seats were released. Nothing was charged.
            </AppText>
            <PrimaryButton title="Find another ride" onPress={() => router.replace("/map")} style={styles.stateButton} />
          </View>
        </AppBackground>
      </AuthGate>
    );
  }

  if (phase === "failed") {
    return (
      <AuthGate>
        <AppBackground>
          <View style={styles.centerState}>
            <View style={[styles.stateIcon, { backgroundColor: "rgba(239,68,68,0.12)" }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={44} color={COLORS.danger} />
            </View>
            <AppText variant="heading" style={[styles.stateTitle, ds.title]}>
              Payment failed
            </AppText>
            <AppText variant="body" style={[styles.stateText, ds.body]}>
              Your seats have not been permanently reserved. You can try again before the timer runs out.
            </AppText>
            <PrimaryButton
              title="Try again"
              onPress={() => {
                finishedRef.current = false;
                chargeStartedRef.current = false;
                setPhase("review");
              }}
              style={styles.stateButton}
            />
            <PrimaryButton
              title="Cancel booking"
              variant="outline"
              onPress={() => void handleCancel()}
              style={styles.stateButton}
            />
          </View>
        </AppBackground>
      </AuthGate>
    );
  }

  if (phase === "rejected" || phase === "cancelled") {
    const hasRefund = refund?.status && refund.status !== "none";
    return (
      <AuthGate>
        <AppBackground>
          <View style={styles.centerState}>
            <View style={[styles.stateIcon, { backgroundColor: "rgba(239,68,68,0.12)" }]}>
              <MaterialCommunityIcons name="close-circle-outline" size={44} color={COLORS.danger} />
            </View>
            <AppText variant="heading" style={[styles.stateTitle, ds.title]}>
              {phase === "rejected" ? "Booking not accepted" : "Booking cancelled"}
            </AppText>
            <AppText variant="body" style={[styles.stateText, ds.body]}>
              {phase === "rejected"
                ? "The driver couldn't take this booking. Your seats have been released and nothing was charged."
                : hasRefund
                  ? `Your refund of ${formatPesewas(refund?.amountPesewas ?? total)} is ${refund?.status === "processed" ? "complete" : "being processed"}.`
                  : "This booking has been cancelled."}
            </AppText>
            <PrimaryButton title="Find another ride" onPress={() => router.replace("/map")} style={styles.stateButton} />
          </View>
        </AppBackground>
      </AuthGate>
    );
  }

  const awaitingApproval = phase === "approve_on_phone" || phase === "verifying";
  const payable = booking?.status === "awaiting_payment";
  const expiring = countdown > 0 && countdown <= 60;

  return (
    <AuthGate>
      <AppBackground>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
          </Pressable>

          <View style={styles.headerRow}>
            <AppText variant="caption" style={styles.eyebrow}>
              CONFIRM YOUR BOOKING
            </AppText>
            {PAYMENTS_ENV === "test" ? (
              <View style={styles.testPill}>
                <AppText variant="caption" style={styles.testPillText}>
                  TEST MODE
                </AppText>
              </View>
            ) : null}
          </View>

          <AppText variant="title" style={[styles.title, ds.title]}>
            {origin} → {destination}
          </AppText>

          {countdown > 0 && !finishedRef.current ? (
            <View style={[styles.timerRow, expiring && styles.timerRowUrgent]}>
              <MaterialCommunityIcons
                name="timer-outline"
                size={16}
                color={expiring ? COLORS.danger : colors.textSecondary}
              />
              <AppText variant="caption" style={[styles.timerText, expiring && { color: COLORS.danger }]}>
                {expiring ? "Hurry — " : ""}
                Your seats are held for {formatCountdown(countdown)}
              </AppText>
            </View>
          ) : null}

          {/* ── Journey ─────────────────────────────────────────────── */}
          <View style={[styles.card, ds.card]}>
            <AppText variant="caption" style={[styles.cardLabel, ds.label]}>
              TRIP
            </AppText>
            <View style={styles.stopRow}>
              <View style={[styles.dot, { backgroundColor: COLORS.primary }]} />
              <View style={styles.stopText}>
                <AppText variant="caption" style={[styles.stopLabel, ds.label]}>
                  Pickup
                </AppText>
                <AppText variant="body" style={[styles.stopValue, ds.strong]}>
                  {origin}
                </AppText>
              </View>
            </View>
            <View style={styles.stopConnector} />
            <View style={styles.stopRow}>
              <View style={[styles.dot, { backgroundColor: COLORS.accent }]} />
              <View style={styles.stopText}>
                <AppText variant="caption" style={[styles.stopLabel, ds.label]}>
                  Destination
                </AppText>
                <AppText variant="body" style={[styles.stopValue, ds.strong]}>
                  {destination}
                </AppText>
              </View>
            </View>
          </View>

          {/* ── Driver ──────────────────────────────────────────────── */}
          {driverInfo?.name || driverInfo?.plate ? (
            <View style={[styles.card, ds.card]}>
              <AppText variant="caption" style={[styles.cardLabel, ds.label]}>
                DRIVER
              </AppText>
              <AppText variant="body" style={[styles.stopValue, ds.strong]}>
                {driverInfo?.name || "Your driver"}
              </AppText>
              {driverInfo?.plate ? (
                <AppText variant="caption" style={[styles.driverMeta, ds.body]}>
                  {[driverInfo.color, driverInfo.plate].filter(Boolean).join(" · ")}
                </AppText>
              ) : null}
            </View>
          ) : null}

          {/* ── Fare breakdown ──────────────────────────────────────── */}
          <View style={[styles.card, ds.card]}>
            <AppText variant="caption" style={[styles.cardLabel, ds.label]}>
              PAYMENT
            </AppText>
            <View style={styles.lineRow}>
              <AppText variant="body" style={[styles.lineLabel, ds.body]}>
                Price per seat
              </AppText>
              <AppText variant="body" style={[styles.lineValue, ds.strong]}>
                {formatPesewas(farePerSeat)}
              </AppText>
            </View>
            <View style={styles.lineRow}>
              <AppText variant="body" style={[styles.lineLabel, ds.body]}>
                Seats
              </AppText>
              <AppText variant="body" style={[styles.lineValue, ds.strong]}>
                {seats}
              </AppText>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.glassBorder }]} />
            <View style={styles.lineRow}>
              <AppText variant="heading" style={[styles.totalLabel, ds.strong]}>
                Total
              </AppText>
              <AppText variant="heading" style={[styles.totalValue, { color: COLORS.primary }]}>
                {formatPesewas(total)}
              </AppText>
            </View>
          </View>

          {/* ── Mobile money ────────────────────────────────────────── */}
          {payable ? (
            <View style={[styles.card, ds.card]}>
              <AppText variant="caption" style={[styles.cardLabel, ds.label]}>
                PAY WITH MOBILE MONEY
              </AppText>

              <View style={styles.networkRow}>
                {MOMO_NETWORKS.map((network) => {
                  const selected = momoProvider === network.id;
                  return (
                    <Pressable
                      key={network.id}
                      accessibilityLabel={network.hint}
                      onPress={() => setMomoProvider(network.id)}
                      disabled={awaitingApproval || busy}
                      style={({ pressed }) => [
                        styles.networkChip,
                        { borderColor: selected ? colors.primary : colors.glassBorder },
                        selected && { backgroundColor: colors.veryLightBlue },
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      <AppText
                        variant="caption"
                        style={[styles.networkText, selected && { color: colors.primary }]}
                      >
                        {network.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                value={momoNumber}
                onChangeText={setMomoNumber}
                placeholder="Mobile Money number"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
                editable={!awaitingApproval && !busy}
                style={[styles.input, ds.input]}
              />
              <AppText variant="caption" style={[styles.helper, ds.body]}>
                Use the number registered for Mobile Money, e.g. 024 000 0000.
              </AppText>

              {phase === "otp" ? (
                <>
                  <TextInput
                    value={otp}
                    onChangeText={setOtp}
                    placeholder="One-time code"
                    placeholderTextColor={colors.textSecondary}
                    keyboardType="number-pad"
                    maxLength={8}
                    editable={!busy}
                    style={[styles.input, ds.input]}
                  />
                  <PrimaryButton
                    title={busy ? "Confirming..." : "Confirm code"}
                    onPress={() => void handleSubmitOtp()}
                    disabled={busy}
                    style={styles.payButton}
                  />
                </>
              ) : (
                <PrimaryButton
                  title={
                    busy || phase === "charging"
                      ? "Starting payment..."
                      : awaitingApproval
                        ? "Waiting for approval..."
                        : `Pay ${formatPesewas(total)}`
                  }
                  onPress={() => void handlePay()}
                  disabled={busy || awaitingApproval}
                  style={styles.payButton}
                />
              )}

              {awaitingApproval ? (
                <View style={styles.waitBox}>
                  <ActivityIndicator size="small" color={COLORS.primary} />
                  <AppText variant="caption" style={[styles.waitText, ds.body]}>
                    Approve the Mobile Money request on your phone. Don't pay again — we're checking
                    automatically and will confirm as soon as it clears.
                  </AppText>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={[styles.card, ds.card]}>
              <AppText variant="body" style={[styles.lineLabel, ds.body]}>
                {booking?.status === "pending"
                  ? "Waiting for your Mate to accept your booking. You'll pay once they accept."
                  : "This booking is not waiting for payment."}
              </AppText>
            </View>
          )}

          {payable || booking?.status === "pending" ? (
            <Pressable
              onPress={() => void handleCancel()}
              disabled={busy}
              style={({ pressed }) => [styles.cancelLink, pressed && { opacity: 0.7 }]}
            >
              <AppText variant="caption" style={styles.cancelText}>
                Cancel this booking
              </AppText>
            </Pressable>
          ) : null}
        </ScrollView>
      </AppBackground>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.xs,
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  testPill: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(245,158,11,0.14)",
  },
  testPillText: {
    color: COLORS.warning,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 26,
    lineHeight: 33,
    marginBottom: SPACING.sm,
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    marginBottom: SPACING.md,
  },
  timerRowUrgent: {},
  timerText: {
    flex: 1,
  },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  cardLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: SPACING.md,
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
    marginRight: SPACING.md,
  },
  stopText: { flex: 1 },
  stopLabel: { fontSize: 10, letterSpacing: 0.8, fontWeight: "700" },
  stopValue: { marginTop: 2 },
  stopConnector: {
    width: 1,
    height: 18,
    marginLeft: 4.5,
    marginVertical: 4,
    backgroundColor: "rgba(148,163,184,0.5)",
  },
  driverMeta: { marginTop: SPACING.xs },
  lineRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  lineLabel: { flex: 1 },
  lineValue: {},
  divider: {
    height: 1,
    marginVertical: SPACING.sm,
  },
  totalLabel: { fontSize: 17 },
  totalValue: { fontSize: 19 },
  networkRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  networkChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: SPACING.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  networkText: {
    fontWeight: "700",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: SPACING.sm,
  },
  helper: { marginBottom: SPACING.md },
  payButton: { marginTop: SPACING.xs },
  waitBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  waitText: { flex: 1, lineHeight: 18 },
  cancelLink: {
    alignSelf: "center",
    paddingVertical: SPACING.md,
  },
  cancelText: {
    color: COLORS.danger,
    fontWeight: "700",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xl,
  },
  stateIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.md,
  },
  stateTitle: {
    textAlign: "center",
    marginTop: SPACING.xs,
  },
  stateText: {
    textAlign: "center",
    marginTop: SPACING.sm,
    lineHeight: 22,
  },
  stateButton: {
    alignSelf: "stretch",
    marginTop: SPACING.lg,
  },
});
