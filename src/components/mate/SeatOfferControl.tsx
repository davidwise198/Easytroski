// ---------------------------------------------------------------------------
// Seats on offer — the mate's control
//
// A trotro fills up and moves on, and a mate sells the seats that are free at
// that moment. This is that one number, and nothing else: it decides how many
// seats a new passenger can take, never how many the vehicle holds.
//
// Every change goes to the backend, which checks it against the seats already
// held or paid for and refuses anything that would sell a seat twice. When the
// backend answers, its numbers replace what this screen is showing — so the
// figure on screen is always the figure a new passenger would be offered.
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "../ui/AppText";
import { useThemeColors } from "../../contexts/ThemeContext";
import { mateActionError, setSeatsOffered, type SeatUsage } from "../../services/mates";
import { COLORS, SPACING } from "../../theme";
import { showToast } from "../../utils/toast";

type Props = {
  /** Seats a new passenger can take right now (the backend counter). */
  offered: number;
  /** Vehicle capacity. */
  capacity: number;
  /** Seats already held, paid for or occupied — not available to offer again. */
  committed: number;
  /** The highest number this vehicle may offer right now. */
  maxOffer: number;
  /** Authoritative numbers, so the screen stops guessing after a change. */
  onUsage: (usage: SeatUsage) => void;
};

const BUTTON = 46;

export default function SeatOfferControl({ offered, capacity, committed, maxOffer, onUsage }: Props) {
  const { colors } = useThemeColors();
  const ds = useMemo(
    () => ({
      card: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
      text: { color: colors.text },
      secondary: { color: colors.textSecondary },
      stepButton: { backgroundColor: colors.veryLightBlue, borderColor: colors.glassBorder },
      icon: { backgroundColor: colors.veryLightBlue },
    }),
    [colors]
  );

  const [shown, setShown] = useState(offered);
  const [busy, setBusy] = useState(false);

  // The backend (or another device, or a booking landing) moves the counter —
  // follow it whenever we are not mid-change.
  useEffect(() => {
    if (!busy) setShown(offered);
  }, [offered, busy]);

  const change = async (next: number) => {
    if (busy || next === shown) return;
    const previous = shown;
    setShown(next);
    setBusy(true);
    try {
      const usage = await setSeatsOffered(next);
      setShown(usage.offered);
      onUsage(usage);
      if (usage.maxOffer <= 0) {
        showToast("info", "Vehicle full", "No seats left to offer on this trip.");
      }
    } catch (error) {
      setShown(previous);
      showToast("error", "Couldn't change seats", mateActionError(error));
    } finally {
      setBusy(false);
    }
  };

  const atFloor = shown <= 0;
  const atCeiling = shown >= maxOffer;

  return (
    <View style={[styles.card, ds.card]}>
      <View style={styles.topRow}>
        <View style={[styles.icon, ds.icon]}>
          <MaterialCommunityIcons name="seat-passenger" size={20} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          <AppText variant="heading" style={[styles.title, ds.text]}>
            Seats on offer
          </AppText>
          <AppText variant="caption" style={[styles.sub, ds.secondary]}>
            What a new passenger can book right now.
          </AppText>
        </View>
      </View>

      <View style={styles.stepperRow}>
        <Pressable
          accessibilityLabel="Offer one seat fewer"
          accessibilityRole="button"
          disabled={busy || atFloor}
          onPress={() => change(shown - 1)}
          style={({ pressed }) => [
            styles.stepButton,
            ds.stepButton,
            (busy || atFloor) && styles.stepDisabled,
            pressed && !busy && !atFloor && { opacity: 0.7 },
          ]}
        >
          <MaterialCommunityIcons name="minus" size={22} color={colors.primary} />
        </Pressable>

        <View style={styles.valueBox}>
          <AppText variant="title" style={[styles.value, ds.text]}>
            {shown}
          </AppText>
          <AppText variant="caption" style={[styles.valueLabel, ds.secondary]}>
            {shown === 1 ? "seat" : "seats"}
          </AppText>
        </View>

        <Pressable
          accessibilityLabel="Offer one more seat"
          accessibilityRole="button"
          disabled={busy || atCeiling}
          onPress={() => change(shown + 1)}
          style={({ pressed }) => [
            styles.stepButton,
            ds.stepButton,
            (busy || atCeiling) && styles.stepDisabled,
            pressed && !busy && !atCeiling && { opacity: 0.7 },
          ]}
        >
          <MaterialCommunityIcons name="plus" size={22} color={colors.primary} />
        </Pressable>
      </View>

      <AppText variant="caption" style={[styles.help, ds.secondary]}>
        {committed > 0
          ? `Vehicle holds ${capacity} · ${committed} seat${
              committed > 1 ? "s" : ""
            } already taken · up to ${maxOffer} can be offered.`
          : `Vehicle holds ${capacity} · all ${capacity} can be offered.`}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  title: { fontSize: 17, lineHeight: 24 },
  sub: { marginTop: 2 },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.lg,
    marginTop: SPACING.md,
  },
  stepButton: {
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDisabled: { opacity: 0.4 },
  valueBox: { alignItems: "center", minWidth: 72 },
  value: { fontSize: 30, lineHeight: 36, color: COLORS.primary },
  valueLabel: { marginTop: -2 },
  help: { marginTop: SPACING.md, textAlign: "center" },
});
