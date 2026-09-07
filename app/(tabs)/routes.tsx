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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";

import AppBackground from "../../src/components/ui/AppBackground";
import AppText from "../../src/components/ui/AppText";
import PrimaryButton from "../../src/components/ui/PrimaryButton";
import AuthGate from "../../src/components/AuthGate";
import { getActiveRoutes } from "../../src/services/transport";
import { getRouteAvailableSeats } from "../../src/services/map";
import { COLORS, SPACING } from "../../src/theme";
import { useThemeColors } from "../../src/contexts/ThemeContext";
import { useMemo as useM } from "react";
import { Route } from "../../src/types/models";

const RECENTS_KEY = "easyTroski.recentSearches";
const LAST_ROUTE_KEY = "easyTroski.lastExpandedRoute";

export default function RoutesScreen() {
  const { colors } = useThemeColors();
  const ds = useM(() => ({
    title: { color: colors.text },
    subtitle: { color: colors.textSecondary },
    stateTitle: { color: colors.text },
    stateText: { color: colors.textSecondary },
    searchInput: { color: colors.text },
    searchBar: { backgroundColor: colors.veryLightBlue, borderColor: colors.blueWash },
    suggestBox: { backgroundColor: colors.surface, borderColor: colors.glassBorder },
    recentChip: { backgroundColor: colors.veryLightBlue, borderColor: colors.blueWash },
    recentChipText: { color: colors.text },
    recentsTitle: { color: colors.textSecondary },
    recentsClear: { color: colors.primary },
    headerIcon: { backgroundColor: colors.blueWash },
  }), [colors]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRouteId, setExpandedRouteId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
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

  // Restore the last-selected route once the list loads, so the route the
  // user chose stays selected when they come back to this page.
  useEffect(() => {
    if (routes.length === 0) return;
    AsyncStorage.getItem(LAST_ROUTE_KEY)
      .then((id) => {
        if (id && routes.some((r) => r.id === id)) {
          setExpandedRouteId(id);
        }
      })
      .catch(() => {});
  }, [routes]);

  const toggleRoute = (routeId: string) => {
    setExpandedRouteId((prev) => {
      const next = prev === routeId ? null : routeId;
      if (next) {
        AsyncStorage.setItem(LAST_ROUTE_KEY, next).catch(() => {});
      } else {
        AsyncStorage.removeItem(LAST_ROUTE_KEY).catch(() => {});
      }
      return next;
    });
  };

  // ── Search engine ──────────────────────────────────────────────────────
  // Normalize a search field: lowercase, strip punctuation, collapse spaces.
  const normalizeField = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  // A field matches when EVERY query word appears inside it.
  const fieldMatchesQuery = (field: string, query: string) => {
    if (!query) return false;
    const normalized = normalizeField(field);
    return query.split(" ").every((word) => normalized.includes(word));
  };

  type SearchResult = {
    route: Route;
    direct: boolean;            // matched origin or destination
    matchedStop: string | null; // first matching stop (when not a direct match)
    matchScore: number;         // 0 = direct, 1 = stop match (for ranking)
  };

  const searchResults = useMemo<SearchResult[]>(() => {
    const q = normalizeField(searchQuery);
    if (!q) {
      return routes.map((route) => ({
        route,
        direct: true,
        matchedStop: null,
        matchScore: 0,
      }));
    }

    const results: SearchResult[] = [];
    for (const route of routes) {
      if (
        fieldMatchesQuery(route.origin, q) ||
        fieldMatchesQuery(route.destination, q)
      ) {
        results.push({ route, direct: true, matchedStop: null, matchScore: 0 });
      } else {
        const matchedStop =
          route.stops.find((stop) => fieldMatchesQuery(stop, q)) ?? null;
        if (matchedStop) {
          results.push({ route, direct: false, matchedStop, matchScore: 1 });
        }
      }
    }
    // Direct (origin/destination) matches first, then stop matches, then alphabetical.
    results.sort(
      (a, b) => a.matchScore - b.matchScore || a.route.origin.localeCompare(b.route.origin)
    );
    return results;
  }, [routes, searchQuery]);

  const filteredRoutes = useMemo(() => searchResults.map((r) => r.route), [searchResults]);

  const resultByRoute = useMemo(
    () => new Map(searchResults.map((r) => [r.route.id, r])),
    [searchResults]
  );

  // Live stop suggestions: every matching stop, with the route it belongs to.
  const suggestions = useMemo(() => {
    const q = normalizeField(searchQuery);
    if (!q) return [];
    const out: { label: string; sub: string; routeId: string }[] = [];
    for (const res of searchResults) {
      if (!res.direct && res.matchedStop) {
        out.push({
          label: res.matchedStop,
          sub: `${res.route.origin} → ${res.route.destination}`,
          routeId: res.route.id,
        });
      }
    }
    return out.slice(0, 6);
  }, [searchResults, searchQuery]);

  const activeQuery = normalizeField(searchQuery);

  // ── Recent searches (persisted) ─────────────────────────────────────────
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(RECENTS_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setRecentSearches(parsed.filter((s) => typeof s === "string").slice(0, 6));
          }
        } catch {
          // Corrupt data — ignore.
        }
      })
      .catch(() => {});
  }, []);

  const commitSearch = useCallback((raw: string) => {
    const term = normalizeField(raw);
    if (!term) return;
    setRecentSearches((prev) => {
      const next = [term, ...prev.filter((s) => normalizeField(s) !== term)].slice(0, 6);
      AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const clearRecents = useCallback(() => {
    setRecentSearches([]);
    AsyncStorage.removeItem(RECENTS_KEY).catch(() => {});
  }, []);

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
          <AppText variant="title" style={[styles.title, ds.title]}>Find a ride</AppText>
          <View style={[styles.headerIcon, ds.headerIcon]}>
            <MaterialCommunityIcons name="map-search-outline" size={22} color={COLORS.primary} />
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
              placeholder="Search routes, stops, areas..."
              placeholderTextColor={COLORS.textSecondary}
              value={searchQuery}
              onChangeText={(t) => {
                setSearchQuery(t);
                setSuggestionsOpen(true);
              }}
              onFocus={() => setSuggestionsOpen(true)}
              onSubmitEditing={() => commitSearch(searchQuery)}
              returnKeyType="search"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => {
                  setSearchQuery("");
                  setSuggestionsOpen(false);
                }}
              >
                <MaterialCommunityIcons name="close-circle" size={18} color={COLORS.textSecondary} />
              </Pressable>
            )}
          </View>

          {/* ─── Recent searches ─── */}
          {!activeQuery && recentSearches.length > 0 && (
            <View style={styles.recentsBox}>
              <View style={styles.recentsHeader}>
                <AppText variant="caption" style={[styles.recentsTitle, ds.recentsTitle]}>
                  RECENT SEARCHES
                </AppText>
                <Pressable onPress={clearRecents} hitSlop={8}>
                  <AppText variant="caption" style={[styles.recentsClear, ds.recentsClear]}>
                    Clear all
                  </AppText>
                </Pressable>
              </View>
              <View style={styles.recentsChips}>
                {recentSearches.map((term) => (
                  <Pressable
                    key={term}
                    style={({ pressed }) => [
                      styles.recentChip,
                      ds.recentChip,
                      pressed && styles.recentChipPressed,
                    ]}
                    onPress={() => {
                      setSearchQuery(term);
                      setSuggestionsOpen(true);
                    }}
                  >
                    <MaterialCommunityIcons name="history" size={14} color={colors.textSecondary} />
                    <AppText variant="caption" style={[styles.recentChipText, ds.recentChipText]}>
                      {term}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* ─── Live stop suggestions ─── */}
          {suggestionsOpen && activeQuery && suggestions.length > 0 && (
            <View style={[styles.suggestBox, ds.suggestBox]}>
              {suggestions.map((s) => (
                <Pressable
                  key={`${s.routeId}-${s.label}`}
                  style={({ pressed }) => [styles.suggestRow, pressed && styles.suggestRowPressed]}
                  onPress={() => {
                    setExpandedRouteId(s.routeId);
                    setSuggestionsOpen(false);
                    commitSearch(s.label);
                  }}
                >
                  <MaterialCommunityIcons name="map-marker" size={16} color={colors.primary} />
                  <View style={styles.suggestCopy}>
                    <AppText variant="caption" style={styles.suggestLabel}>{s.label}</AppText>
                    <AppText variant="caption" style={styles.suggestSub}>{s.sub}</AppText>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.textSecondary} />
                </Pressable>
              ))}
            </View>
          )}

          {filteredRoutes.length === 0 ? (
            <View style={styles.stateContainer}>
              <MaterialCommunityIcons name="magnify-close" size={38} color={COLORS.textSecondary} />
              <AppText variant="heading" style={[styles.stateTitle, ds.stateTitle]}>No routes found</AppText>
              <AppText variant="body" style={[styles.stateText, ds.stateText]}>
                No routes serve "{searchQuery.trim()}" yet. Try a different area or search term.
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
                    onPress={() => {
                      if (activeQuery) commitSearch(searchQuery);
                      toggleRoute(route.id);
                    }}
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
                        {activeQuery &&
                          resultByRoute.get(route.id) &&
                          !resultByRoute.get(route.id)!.direct && (
                            <View style={styles.viaChip}>
                              <AppText variant="caption" style={styles.viaChipText}>
                                via {resultByRoute.get(route.id)!.matchedStop}
                              </AppText>
                            </View>
                          )}
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
                                activeQuery && fieldMatchesQuery(stop, activeQuery) && styles.stopNameMatched,
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
                        onPress={() => router.navigate(`/map?routeId=${route.id}`)}
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

        <PrimaryButton title="Back to dashboard" onPress={() => router.navigate("/home")} variant="outline" style={styles.backButton} />
      </ScrollView>
    </AppBackground>
    </AuthGate>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 40,
    paddingBottom: 160,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.md,
  },
  title: {
    color: COLORS.navy,
    fontSize: 28,
    lineHeight: 34,
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
    marginBottom: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: COLORS.navy,
    paddingVertical: SPACING.xs,
  },

  /* ── Search suggestions ── */
  suggestBox: {
    borderRadius: 16,
    borderWidth: 1,
    marginTop: -SPACING.sm,
    marginBottom: SPACING.lg,
    overflow: "hidden",
  },
  suggestRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
  },
  suggestRowPressed: {
    opacity: 0.7,
  },
  suggestCopy: {
    flex: 1,
  },
  suggestLabel: {
    color: COLORS.primary,
    fontWeight: "700",
    fontSize: 14,
  },
  suggestSub: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },

  /* ── Recent searches ── */
  recentsBox: {
    marginTop: -6,
    marginBottom: SPACING.lg,
  },
  recentsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.sm,
  },
  recentsTitle: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  recentsClear: {
    fontSize: 12,
    fontWeight: "600",
  },
  recentsChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  recentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  recentChipPressed: {
    opacity: 0.7,
  },
  recentChipText: {
    fontSize: 13,
    fontWeight: "600",
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
  viaChip: {
    backgroundColor: "rgba(242,169,59,0.14)",
    borderColor: "rgba(242,169,59,0.4)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  viaChipText: {
    color: "#F2A93B",
    fontWeight: "700",
    fontSize: 11,
  },
  stopNameMatched: {
    color: "#F2A93B",
    fontWeight: "700",
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
