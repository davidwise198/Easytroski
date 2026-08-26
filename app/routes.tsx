import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../src/components/ui/AppBackground";
import AppText from "../src/components/ui/AppText";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import AuthGate from "../src/components/AuthGate";
import { getActiveRoutes } from "../src/services/transport";
import { COLORS, SPACING } from "../src/theme";
import { Route } from "../src/types/models";

export default function RoutesScreen() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);

  const loadRoutes = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      setRoutes(await getActiveRoutes());
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
            <AppText variant="caption" style={styles.eyebrow}>PLAN YOUR JOURNEY</AppText>
            <AppText variant="title" style={styles.title}>Find a route</AppText>
            <AppText variant="body" style={styles.subtitle}>Choose where you are going today.</AppText>
          </View>
          <View style={styles.headerIcon}>
            <MaterialCommunityIcons name="map-search-outline" size={25} color={COLORS.primary} />
          </View>
        </View>

        {loading ? (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <AppText variant="body" style={styles.stateText}>Finding active routes...</AppText>
          </View>
        ) : error ? (
          <View style={styles.stateContainer}>
            <MaterialCommunityIcons name="cloud-alert-outline" size={42} color={COLORS.accent} />
            <AppText variant="heading" style={styles.stateTitle}>Routes unavailable</AppText>
            <AppText variant="body" style={styles.stateText}>{error}</AppText>
            <PrimaryButton title="Try again" onPress={() => void loadRoutes()} style={styles.retryButton} />
          </View>
        ) : routes.length === 0 ? (
          <View style={styles.stateContainer}>
            <MaterialCommunityIcons name="map-marker-path" size={44} color={COLORS.primary} />
            <AppText variant="heading" style={styles.stateTitle}>No active routes yet</AppText>
            <AppText variant="body" style={styles.stateText}>
              Routes will appear here as EasyTroski operators bring vehicles online.
            </AppText>
          </View>
        ) : (
          <View style={styles.routeList}>
            {routes.map((route) => {
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
                      <MaterialCommunityIcons name="transit-connection-variant" size={24} color={COLORS.secondary} />
                    </View>
                    <View style={styles.routeCopy}>
                      <AppText variant="heading" style={styles.routeTitle}>
                        {route.origin} → {route.destination}
                      </AppText>
                      <AppText variant="caption" style={styles.stopsHint}>
                        {route.stops.length} {route.stops.length === 1 ? "stop" : "stops"} along the way
                      </AppText>
                    </View>
                    <MaterialCommunityIcons
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={20}
                      color="rgba(255,255,255,0.5)"
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

        <PrimaryButton title="Back to dashboard" onPress={() => router.back()} variant="outline" style={styles.backButton} />
      </ScrollView>
    </AppBackground>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xl,
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
  routeList: {
    gap: SPACING.md,
  },
  routeCard: {
    borderRadius: 20,
    backgroundColor: COLORS.navy,
    overflow: "hidden",
    shadowColor: COLORS.navy,
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
    color: COLORS.secondary,
    fontSize: 16,
    lineHeight: 22,
  },
  stopsHint: {
    color: "rgba(255,255,255,0.55)",
    marginTop: 2,
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
    backgroundColor: COLORS.secondary,
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
    color: COLORS.secondary,
    fontWeight: "600",
  },

  viewMapButton: {
    borderColor: COLORS.secondary,
    backgroundColor: "rgba(255,255,255,0.15)",
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
