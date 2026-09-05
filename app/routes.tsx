import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../src/components/ui/AppBackground";
import AppText from "../src/components/ui/AppText";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import AuthGate from "../src/components/AuthGate";
import { getActiveRoutes } from "../src/services/transport";
import { getRouteAvailableSeats } from "../src/services/map";
import { COLORS, SPACING } from "../src/theme";
import { useThemeColors } from "../src/contexts/ThemeContext";
import { useMemo as useM } from "react";
import { Route } from "../src/types/models";

export default function RoutesScreen() {
  const { colors } = useThemeColors();
  const ds = useM(() => ({
    title: { color: colors.text },
    subtitle: { color: colors.textSecondary },
    stateTitle: { color: colors.text },
    stateText: { color: colors.textSecondary },
    searchInput: { color: colors.text },
    searchBar: { backgroundColor: colors.veryLightBlue, borderColor: colors.blueWash },
    headerIcon: { backgroundColor: colors.blueWash },
    eyebrow: { color: colors.primary },
  }), [colors]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [seatData, setSeatData] = useState<Record<string, { totalSeats: number; totalCapacity: number; tripCount: number }>>({});

  const loadRoutes = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const activeRoutes = await getActiveRoutes();
      setRoutes(activeRoutes);

      // Load seat availability for each route
      const seatMap: Record<string, { totalSeats: number; totalCapacity: number; tripCount: number }> = {};
      await Promise.all(
        activeRoutes.map(async (route) => {
          try {
            seatMap[route.id] = await getRouteAvailableSeats(route.id);
          } catch { /* best-effort */ }
        })
      );
      setSeatData(seatMap);
    } catch (loadError) {
      console.error("Route loading error:", loadError);
      setError("We could not load routes right now. Please try again.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const toggleRoute = (routeId: string) => {
    setExpandedRouteId(expandedRouteId === routeId ? null : routeId);
  };

  // Live search filtering
  const filteredRoutes = useMemo(() => {
    if (!searchQuery.trim()) return routes;
    const q = searchQuery.toLowerCase().trim();
    return routes.filter(
      (route) =>
        route.origin.toLowerCase().includes(q) ||
        route.destination.toLowerCase().includes(q) ||
        route.stops.some((stop) => stop.toLowerCase().includes(q))
    );
  }, [routes, searchQuery]);

  return (
    <AuthGate>
    <AppBackground>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void loadRoutes(true)} tintColor={COLORS.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <AppText variant="caption" style={[styles.eyebrow, ds.eyebrow]}>PLAN YOUR JOURNEY</AppText>
            <AppText variant="title" style={[styles.title, ds.title]}>Find a route</AppText>
            <AppText variant="body" style={[styles.subtitle, ds.subtitle]}>Choose where you are going today.</AppText>
          </View>
          <View style={[styles.headerIcon, ds.headerIcon]}>
            <MaterialCommunityIcons name="map-search-outline" size={25} color={COLORS.primary} />
          </View>
        </View>

        {loading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <AppText variant="body" style={[styles.stateText, ds.stateText]}>Finding active routes...</AppText>
          </View>
        ) : error ? (
          <View style={styles.stateContainer}>
            <MaterialCommunityIcons name="cloud-alert-outline" size={42} color={COLORS.accent} />
            <AppText variant="heading" style={[styles.stateTitle, ds.stateTitle]}>Routes unavailable</AppText>
            <AppText variant="body" style={[styles.stateText, ds.stateText]}>{error}</AppText>
            <PrimaryButton title="Try again" onPress={() => void loadRoutes()} style={styles.retryButton} />
          </View>
        ) : routes.length === 0 ? (
          <View style={styles.stateContainer}>
            <MaterialCommunityIcons name="map-marker-path" size={44} color={COLORS.primary} />
            <AppText variant="heading" style={[styles.stateTitle, ds.stateTitle]}>No active routes yet</AppText>
            <AppText variant="body" style={[styles.stateText, ds.stateText]}>
              Routes will appear here as EasyTroski operators bring vehicles online.
            </AppText>
          </View>
        ) : (
          <>
          {/* Search bar */}
          <View style={[styles.searchBar, ds.searchBar]}>
            <MaterialCommunityIcons name="magnify" size={20} color={COLORS.textSecondary} />
            <TextInput
              style={[styles.searchInput, ds.searchInput]}
              placeholder="Search routes..."
              placeholderTextColor={COLORS.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery("")}>
                <MaterialCommunityIcons name="close-circle" size={18} color={COLORS.textSecondary} />
              </Pressable>
            )}
          </View>

          {filteredRoutes.length === 0 ? (
            <View style={styles.stateContainer}>
              <MaterialCommunityIcons name="magnify-close" size={38} color={COLORS.textSecondary} />
              <AppText variant="heading" style={[styles.stateTitle, ds.stateTitle]}>No routes found</AppText>
              <AppText variant="body" style={[styles.stateText, ds.stateText]}>
                Try a different search term.
              </AppText>
            </View>
          ) : (
          <View style={styles.routeList}>
            {filteredRoutes.map((route) => {
              const isExpanded = expandedRouteId === route.id;
              const allStops = [route.origin, ...route.stops, route.destination];

              return (
                <View key={route.id} style={styles.routeCard}>
                  {/* ─── Route header (tappable) ─── */}
                  <Pressable
                    style={({ pressed }) => [
                      styles.routeHeader,
                      pressed && styles.routeHeaderPressed,
                    ]}
                    onPress={() => toggleRoute(route.id)}
                  >
                    <View style={styles.routeIcon}>
                      <MaterialCommunityIcons name="transit-connection-variant" size={24} color="#FFFFFF" />
                    </View>
                    <View style={styles.routeCopy}>
                      <AppText variant="heading" style={styles.routeTitle}>
                        {route.origin} → {route.destination}
                      </AppText>
                      <View style={styles.routeMetaRow}>
                        <AppText variant="caption" style={styles.stopsHint}>
                          {route.stops.length} {route.stops.length === 1 ? "stop" : "stops"}
                        </AppText>
                        {seatData[route.id] &&
                          (seatData[route.id].tripCount > 0 ? (
                            <AppText variant="caption" style={styles.seatsHint}>
                              {seatData[route.id].totalSeats}/{seatData[route.id].totalCapacity} seats · {seatData[route.id].tripCount} {seatData[route.id].tripCount === 1 ? "driver" : "drivers"}
                            </AppText>
                          ) : (
                            <AppText variant="caption" style={styles.noDriversHint}>
                              No active drivers yet
                            </AppText>
                          ))}
                      </View>
                    </View>
                    <MaterialCommunityIcons
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={20}
                      color="rgba(255,255,255,0.85)"
                    />
                  </Pressable>

                  {/* ─── Expanded: stops list + view button ─── */}
                  {isExpanded && (
                    <View style={styles.routeDetail}>
                      <View style={styles.detailDivider} />

                      <AppText variant="caption" style={styles.detailLabel}>
                        THIS ROUTE STOPS AT
                      </AppText>

                      <View style={styles.stopsList}>
                        {allStops.map((stop, index) => (
                          <View key={`stop-${index}`} style={styles.stopRow}>
                            <View style={styles.stopDot}>
                              <View style={[
                                styles.stopDotInner,
                                (index === 0 || index === allStops.length - 1) && styles.stopDotEndpoint,
                              ]} />
                            </View>
                            {index < allStops.length - 1 && <View style={styles.stopLine} />}
                            <AppText
                              variant="body"
                              style={[
                                styles.stopName,
                                (index === 0 || index === allStops.length - 1) && styles.stopNameEndpoint,
                              ]}
                            >
                              {stop}
                              {index === 0 ? "  (Start)" : index === allStops.length - 1 ? "  (End)" : ""}
                            </AppText>
                          </View>
                        ))}
                      </View>

                      <PrimaryButton
                        title="View drivers on map"
                        onPress={() => router.push(`/passenger-map?routeId=${route.id}`)}
                        variant="outline"
                        style={styles.viewMapButton}
                      />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
          )}
          </>
        )}

        <PrimaryButton title="Back to dashboard" onPress={() => router.back()} variant="outline" style={styles.backButton} />
      </ScrollView>
    </AppBackground>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 60,
    paddingBottom: SPACING.xxl,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: SPACING.xl,
  },
  eyebrow: {
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: SPACING.xs,
  },
  title: {
    color: COLORS.navy,
    fontSize: 32,
    lineHeight: 39,
  },
  subtitle: {
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderRadius: 16,
    backgroundColor: COLORS.veryLightBlue,
    borderWidth: 1,
    borderColor: COLORS.blueWash,
    marginBottom: SPACING.lg,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.navy,
    paddingVertical: SPACING.xs,
  },
  routeList: {
    gap: SPACING.md,
  },
  // Hero card — intentionally a fixed dark-navy surface in BOTH themes.
  // Do NOT use COLORS.navy / COLORS.secondary here: those tokens are
  // redefined in the dark palette (navy -> light, secondary -> dark), so
  // the card inverts to a white slab when dark mode is active.
  routeCard: {
    borderRadius: 20,
    backgroundColor: "#102A43",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
    shadowColor: "#102A43",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 5,
  },

  /* ── Route header ── */
  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.md,
  },
  routeHeaderPressed: {
    opacity: 0.85,
  },
  routeIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    marginRight: SPACING.md,
  },
  routeCopy: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  routeTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 22,
  },
  routeMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    marginTop: 2,
    flexWrap: "wrap",
  },
  stopsHint: {
    color: "rgba(255,255,255,0.55)",
  },
  noDriversHint: {
    color: "rgba(255,255,255,0.55)",
    fontStyle: "italic",
  },
  seatsHint: {
    color: "#F2A93B",
    fontWeight: "600",
  },

  /* ── Expanded detail ── */
  routeDetail: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  detailDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginBottom: SPACING.md,
  },
  detailLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },

  /* ── Stops timeline ── */
  stopsList: {
    marginBottom: SPACING.md,
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 32,
  },
  stopDot: {
    width: 16,
    alignItems: "center",
    paddingTop: 6,
  },
  stopDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  stopDotEndpoint: {
    backgroundColor: "#FFFFFF",
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stopLine: {
    position: "absolute",
    left: 7.5,
    top: 16,
    width: 1,
    height: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  stopName: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    lineHeight: 22,
    marginLeft: SPACING.sm,
  },
  stopNameEndpoint: {
    color: "#FFFFFF",
    fontWeight: "600",
  },

  viewMapButton: {
    borderColor: "rgba(255,255,255,0.85)",
    borderWidth: 2,
    backgroundColor: "rgba(255,255,255,0.16)",
  },

  /* ── States ── */
  stateContainer: {
    minHeight: 250,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.lg,
  },
  stateTitle: {
    color: COLORS.navy,
    textAlign: "center",
    marginTop: SPACING.md,
  },
  stateText: {
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: SPACING.sm,
  },
  retryButton: {
    marginTop: SPACING.lg,
    minWidth: 150,
  },
  backButton: {
    marginTop: SPACING.xl,
  },
});
