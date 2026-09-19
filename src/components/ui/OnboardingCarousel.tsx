import React, { useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";

import AppBackground from "./AppBackground";
import AppText from "./AppText";
import { useThemeColors } from "../../contexts/ThemeContext";
import { COLORS, SPACING } from "../../theme";

type OnboardingCarouselProps = {
  onComplete: () => void;
};

type Slide = {
  key: string;
  title: string;
  body: string;
  scene: "welcome" | "book" | "track" | "confidence";
};

const SLIDES: Slide[] = [
  {
    key: "welcome",
    title: "Welcome to EasyTroski",
    body: "Ghana's everyday ride — book a seat on a trotro and pay less for every journey.",
    scene: "welcome",
  },
  {
    key: "book",
    title: "Book your seat in seconds",
    body: "Pick your route, tap a nearby driver and reserve up to three seats. No queue, no guesswork.",
    scene: "book",
  },
  {
    key: "track",
    title: "Track your driver live",
    body: "Watch your trotro move toward your stop in real time and know exactly when it arrives.",
    scene: "track",
  },
  {
    key: "confidence",
    title: "Ride with confidence",
    body: "Verified drivers with visible plate numbers and car colours — and rate every trip you take.",
    scene: "confidence",
  },
];

/** Branded CSS illustration — no image downloads, dark-mode safe. */
function SlideScene({ kind }: { kind: Slide["scene"] }) {
  const { colors } = useThemeColors();

  if (kind === "welcome") {
    return (
      <View style={styles.sceneStage}>
        <View style={[styles.sceneSun, { backgroundColor: colors.blueWash }]} />
        <View style={styles.sceneRoad}>
          <View style={[styles.sceneDash, { backgroundColor: colors.veryLightBlue }]} />
          <View style={[styles.sceneDash, { backgroundColor: colors.veryLightBlue }]} />
          <View style={[styles.sceneDash, { backgroundColor: colors.veryLightBlue }]} />
        </View>
        <View style={[styles.sceneBus, { backgroundColor: COLORS.primary }]}>
          <View style={styles.sceneBusWindow} />
          <View style={styles.sceneWheel} />
          <View style={[styles.sceneWheel, styles.sceneWheelRight]} />
        </View>
      </View>
    );
  }

  if (kind === "book") {
    return (
      <View style={styles.sceneStage}>
        <View style={[styles.sceneCard, { backgroundColor: colors.surface, borderColor: colors.veryLightBlue }]}>
          <MaterialCommunityIcons name="routes" size={26} color={COLORS.primary} />
          <View style={styles.sceneCardLines}>
            <View style={[styles.sceneLine, { backgroundColor: colors.veryLightBlue, width: "70%" }]} />
            <View style={[styles.sceneLine, { backgroundColor: colors.veryLightBlue, width: "45%" }]} />
          </View>
        </View>
        <View style={[styles.sceneChipRow, { borderColor: colors.veryLightBlue }]}>
          <MaterialCommunityIcons name="seat" size={16} color={COLORS.accent} />
          <MaterialCommunityIcons name="seat" size={16} color={COLORS.accent} />
          <MaterialCommunityIcons name="seat" size={16} color={COLORS.accent} />
        </View>
      </View>
    );
  }

  if (kind === "track") {
    return (
      <View style={styles.sceneStage}>
        <View style={[styles.sceneTrackLine, { backgroundColor: colors.veryLightBlue }]}>
          <View style={[styles.sceneTrackProgress, { backgroundColor: COLORS.primary }]} />
        </View>
        <View style={[styles.sceneBusSmall, { backgroundColor: COLORS.primary }]}>
          <MaterialCommunityIcons name="bus" size={18} color={COLORS.white} />
        </View>
        <View style={[styles.sceneStop, { backgroundColor: COLORS.accent }]} />
      </View>
    );
  }

  return (
    <View style={styles.sceneStage}>
      <View style={[styles.sceneBadge, { backgroundColor: colors.blueWash }]}>
        <MaterialCommunityIcons name="shield-check" size={40} color={COLORS.primary} />
      </View>
      <View style={styles.sceneBadgeRow}>
        <MaterialCommunityIcons name="star" size={16} color={COLORS.accent} />
        <MaterialCommunityIcons name="star" size={16} color={COLORS.accent} />
        <MaterialCommunityIcons name="star" size={16} color={COLORS.accent} />
        <MaterialCommunityIcons name="star" size={16} color={COLORS.accent} />
        <MaterialCommunityIcons name="star" size={16} color={COLORS.accent} />
      </View>
    </View>
  );
}

export default function OnboardingCarousel({ onComplete }: OnboardingCarouselProps) {
  const { colors, isDark } = useThemeColors();
  const [page, setPage] = useState(0);
  const width = Dimensions.get("window").width;
  const scrollRef = useRef<ScrollView>(null);

  const ds = useMemo(
    () => ({
      container: { backgroundColor: colors.background },
      title: { color: colors.text },
      body: { color: colors.textSecondary },
      footer: { color: colors.textSecondary },
      skip: { color: colors.textSecondary },
      card: { backgroundColor: colors.surface, borderColor: colors.veryLightBlue },
    }),
    [colors],
  );

  const isLast = page === SLIDES.length - 1;

  const goTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setPage(index);
  };

  return (
    <View style={[styles.overlay, ds.container]}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={styles.scroll}
      >
        {SLIDES.map((slide, index) => (
          <View key={slide.key} style={[styles.page, { width }]}>
            <View style={styles.sceneWrap}>
              <SlideScene kind={slide.scene} />
            </View>
            <AppText variant="title" style={[styles.title, ds.title]}>
              {slide.title}
            </AppText>
            <AppText variant="body" style={[styles.body, ds.body]}>
              {slide.body}
            </AppText>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dotsRow}>
        {SLIDES.map((slide, index) => (
          <Pressable
            key={slide.key}
            onPress={() => goTo(index)}
            accessibilityLabel={`Go to slide ${index + 1}`}
            style={[styles.dot, index === page ? styles.dotActive : styles.dotIdle]}
          />
        ))}
      </View>

      <View style={styles.ctaWrap}>
        <Pressable
          accessibilityLabel={isLast ? "Get started" : "Continue"}
          onPress={() => (isLast ? onComplete() : goTo(page + 1))}
          style={({ pressed }) => [styles.cta, { opacity: pressed ? 0.9 : 1 }]}
        >
          <AppText variant="body" style={styles.ctaText}>
            {isLast ? "Get Started" : "Continue"}
          </AppText>
        </Pressable>

        {!isLast && (
          <Pressable onPress={onComplete} accessibilityLabel="Skip onboarding" style={styles.skipBtn}>
            <AppText variant="body" style={[styles.skip, ds.skip]}>
              Skip
            </AppText>
          </Pressable>
        )}

        <AppText variant="caption" style={[styles.footer, ds.footer]}>
          Swipe to navigate • {page + 1} of {SLIDES.length}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  scroll: {
    flex: 1,
  },
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xxl,
  },
  sceneWrap: {
    width: 280,
    height: 240,
    marginBottom: SPACING.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: COLORS.navy,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: SPACING.md,
    maxWidth: 300,
    lineHeight: 22,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingBottom: SPACING.lg,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
    backgroundColor: COLORS.primary,
  },
  dotIdle: {
    width: 8,
    backgroundColor: COLORS.textSecondary,
    opacity: 0.35,
  },
  ctaWrap: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xxl,
    alignItems: "center",
  },
  cta: {
    width: "100%",
    height: 54,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: COLORS.white,
    fontWeight: "700",
    fontSize: 16,
  },
  skipBtn: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.lg,
  },
  skip: {
    fontWeight: "600",
  },
  footer: {
    marginTop: SPACING.sm,
    fontSize: 11,
  },
  /* ── Scene pieces ── */
  sceneStage: {
    width: 260,
    height: 200,
    alignItems: "center",
    justifyContent: "center",
  },
  sceneSun: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 65,
    top: -6,
  },
  sceneRoad: {
    position: "absolute",
    bottom: 18,
    width: 220,
    height: 4,
    borderRadius: 2,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sceneDash: {
    width: 28,
    height: 4,
    borderRadius: 2,
  },
  sceneBus: {
    width: 120,
    height: 62,
    borderRadius: 18,
    marginTop: 30,
    shadowColor: COLORS.navy,
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  sceneBusWindow: {
    width: 40,
    height: 24,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.75)",
    marginLeft: 14,
    marginTop: 12,
  },
  sceneWheel: {
    position: "absolute",
    bottom: -10,
    left: 22,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.navy,
    borderWidth: 4,
    borderColor: COLORS.secondary,
  },
  sceneWheelRight: {
    left: 78,
  },
  sceneCard: {
    width: 200,
    borderRadius: 16,
    borderWidth: 1,
    padding: SPACING.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.md,
    shadowColor: COLORS.navy,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  sceneCardLines: {
    flex: 1,
    gap: 8,
  },
  sceneLine: {
    height: 8,
    borderRadius: 4,
  },
  sceneChipRow: {
    marginTop: SPACING.lg,
    flexDirection: "row",
    gap: 14,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderColor: COLORS.veryLightBlue,
  },
  sceneTrackLine: {
    width: 210,
    height: 6,
    borderRadius: 3,
    justifyContent: "center",
  },
  sceneTrackProgress: {
    width: "65%",
    height: 6,
    borderRadius: 3,
  },
  sceneBusSmall: {
    position: "absolute",
    left: 118,
    top: -14,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  sceneStop: {
    position: "absolute",
    right: 6,
    top: -7,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 4,
    borderColor: COLORS.white,
  },
  sceneBadge: {
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: "center",
    justifyContent: "center",
  },
  sceneBadgeRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: SPACING.lg,
  },
});
