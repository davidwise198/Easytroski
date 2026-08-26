import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  limit,
} from "firebase/firestore";

import AppBackground from "../src/components/ui/AppBackground";
import AppText from "../src/components/ui/AppText";
import GlassInput from "../src/components/ui/GlassInput";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import StatCard from "../src/components/ui/StatCard";
import { db } from "../src/services/firebase";
import { COLORS, SPACING } from "../src/theme";
import { showToast } from "../src/utils/toast";
import { Route } from "../src/types/models";

type Tab = "stats" | "drivers" | "users" | "vehicles" | "bookings" | "trips" | "routes";

// ---------------------------------------------------------------------------
// Edit modal component
// ---------------------------------------------------------------------------

function EditModal({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHeader}>
            <AppText variant="heading" style={styles.modalTitle}>{title}</AppText>
            <Pressable onPress={onClose} style={styles.modalClose}>
              <MaterialCommunityIcons name="close" size={20} color={COLORS.textSecondary} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main admin dashboard
// ---------------------------------------------------------------------------

export default function AdminDashboardScreen() {
  const [activeTab, setActiveTab] = useState<Tab>("stats");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Data
  const [routes, setRoutes] = useState<Route[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);

  // Route form
  const [showAddForm, setShowAddForm] = useState(false);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [stopsText, setStopsText] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editItem, setEditItem] = useState<any>(null);
  const [editType, setEditType] = useState<string>("");
  const [editField, setEditField] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const loadAllData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [routesSnap, driversSnap, vehiclesSnap, bookingsSnap, usersSnap, tripsSnap] =
        await Promise.all([
          getDocs(collection(db, "routes")),
          getDocs(collection(db, "drivers")),
          getDocs(collection(db, "vehicles")),
          getDocs(query(collection(db, "bookings"), limit(100))),
          getDocs(query(collection(db, "users"), limit(100))),
          getDocs(query(collection(db, "trips"), limit(100))),
        ]);

      setRoutes(routesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Route[]);
      setDrivers(driversSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setVehicles(vehiclesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setBookings(bookingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setUsers(usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setTrips(tripsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (error) {
      console.error("Failed to load admin data:", error);
      showToast("error", "Load failed", "Could not load admin data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAllData();
  }, [loadAllData]);

  // Stats
  const totalDrivers = drivers.length;
  const onlineDrivers = drivers.filter((d) => d.online).length;
  const totalVehicles = vehicles.length;
  const activeBookings = bookings.filter(
    (b) => b.status === "pending" || b.status === "confirmed"
  ).length;
  const totalBookings = bookings.length;
  const totalUsers = users.length;
  const totalRoutes = routes.length;
  const activeRoutes = routes.filter((r) => r.active).length;
  const activeTrips = trips.filter(
    (t) => t.status === "in_progress" || t.status === "online" || t.status === "boarding"
  ).length;

  // Driver name lookup for trips tab
  const driverNameMap: Record<string, string> = {};
  drivers.forEach((d) => {
    driverNameMap[d.id] = d.name || d.userId?.slice(0, 8) + "..." || "Driver";
  });

  // ── Route CRUD ──

  const handleAddRoute = async () => {
    if (!origin.trim() || !destination.trim()) {
      showToast("warning", "Missing fields", "Origin and destination are required.");
      return;
    }
    const stops = stopsText.split(",").map((s) => s.trim()).filter(Boolean);
    const slug = `${origin.trim().toLowerCase().replace(/\s+/g, "-")}-${destination.trim().toLowerCase().replace(/\s+/g, "-")}`;

    setSaving(true);
    try {
      await setDoc(doc(db, "routes", slug), {
        origin: origin.trim(),
        destination: destination.trim(),
        stops,
        active: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast("success", "Route added", `${origin.trim()} → ${destination.trim()}`);
      setOrigin("");
      setDestination("");
      setStopsText("");
      setShowAddForm(false);
      void loadAllData();
    } catch (error) {
      console.error("Failed to add route:", error);
      showToast("error", "Add failed", "Could not add route. It may already exist.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRoute = async (routeId: string, label: string) => {
    Alert.alert("Delete route", `Are you sure you want to delete ${label}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "routes", routeId));
            showToast("info", "Route deleted", label);
            void loadAllData();
          } catch (error) {
            showToast("error", "Delete failed", "Could not delete route.");
          }
        },
      },
    ]);
  };

  const handleToggleActive = async (route: Route) => {
    try {
      await updateDoc(doc(db, "routes", route.id), {
        active: !route.active,
        updatedAt: serverTimestamp(),
      });
      void loadAllData();
    } catch (error) {
      showToast("error", "Update failed", "Could not update route.");
    }
  };

  // ── Driver CRUD ──

  const handleToggleDriverOnline = async (driver: any) => {
    try {
      await updateDoc(doc(db, "drivers", driver.id), {
        online: !driver.online,
        status: driver.online ? "offline" : "online",
      });
      showToast("success", "Updated", `Driver set to ${driver.online ? "offline" : "online"}`);
      void loadAllData();
    } catch (error) {
      showToast("error", "Update failed", "Could not update driver.");
    }
  };

  const handleDeleteDriver = async (driverId: string) => {
    Alert.alert("Delete driver profile", "This will remove the driver profile. The user account still exists.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "drivers", driverId));
            showToast("info", "Driver deleted", "Driver profile removed.");
            void loadAllData();
          } catch (error) {
            showToast("error", "Delete failed", "Could not delete driver.");
          }
        },
      },
    ]);
  };

  // ── User CRUD ──

  const handleChangeRole = async (userId: string, newRole: string) => {
    try {
      await updateDoc(doc(db, "users", userId), { role: newRole });
      showToast("success", "Role updated", `User role changed to ${newRole}.`);
      setEditItem(null);
      void loadAllData();
    } catch (error) {
      showToast("error", "Update failed", "Could not change role.");
    }
  };

  // ── Vehicle CRUD ──

  const handleDeleteVehicle = async (vehicleId: string, plate: string) => {
    Alert.alert("Delete vehicle", `Remove vehicle ${plate}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "vehicles", vehicleId));
            showToast("info", "Vehicle deleted", plate);
            void loadAllData();
          } catch (error) {
            showToast("error", "Delete failed", "Could not delete vehicle.");
          }
        },
      },
    ]);
  };

  // ── Booking CRUD ──

  const handleUpdateBookingStatus = async (bookingId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, "bookings", bookingId), {
        status: newStatus,
        updatedAt: new Date().toISOString(),
      });
      showToast("success", "Booking updated", `Status changed to ${newStatus}.`);
      setEditItem(null);
      void loadAllData();
    } catch (error) {
      showToast("error", "Update failed", "Could not update booking.");
    }
  };

  // ── Trip CRUD ──

  const handleUpdateTripStatus = async (tripId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, "trips", tripId), {
        status: newStatus,
        updatedAt: new Date().toISOString(),
      });
      showToast("success", "Trip updated", `Status changed to ${newStatus}.`);
      setEditItem(null);
      void loadAllData();
    } catch (error) {
      showToast("error", "Update failed", "Could not update trip.");
    }
  };

  const handleDeleteTrip = async (tripId: string) => {
    Alert.alert("Delete trip", "This will permanently remove this trip.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteDoc(doc(db, "trips", tripId));
            showToast("info", "Trip deleted", "Trip removed.");
            void loadAllData();
          } catch (error) {
            showToast("error", "Delete failed", "Could not delete trip.");
          }
        },
      },
    ]);
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "stats", label: "Overview", icon: "chart-bar" },
    { key: "drivers", label: "Drivers", icon: "steering" },
    { key: "users", label: "Users", icon: "account-group" },
    { key: "vehicles", label: "Vehicles", icon: "car" },
    { key: "bookings", label: "Bookings", icon: "book-check" },
    { key: "trips", label: "Trips", icon: "map-marker-distance" },
    { key: "routes", label: "Routes", icon: "map-marker-path" },
  ];

  // Helper for status color
  const statusColor = (status: string) => {
    switch (status) {
      case "confirmed": case "in_progress": return COLORS.success;
      case "pending": case "online": case "boarding": return COLORS.warning;
      case "cancelled": case "completed": return COLORS.primary;
      default: return COLORS.textSecondary;
    }
  };

  return (
    <AppBackground>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadAllData(true)}
            tintColor={COLORS.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.primary} />
        </Pressable>
        <AppText variant="caption" style={styles.eyebrow}>ADMIN DASHBOARD</AppText>
        <AppText variant="title" style={styles.title}>EasyTroski Admin</AppText>

        {/* Tab bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabBar}
        >
          {tabs.map((tab) => (
            <Pressable
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <MaterialCommunityIcons
                name={tab.icon as any}
                size={16}
                color={activeTab === tab.key ? COLORS.white : COLORS.textSecondary}
              />
              <AppText
                variant="caption"
                style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}
              >
                {tab.label}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} style={{ marginTop: 60 }} />
        ) : (
          <>
            {/* ══════ Stats ══════ */}
            {activeTab === "stats" && (
              <View>
                <View style={styles.statsGrid}>
                  <StatCard icon="account-group" value={totalUsers} label="Users" delay={100} />
                  <StatCard icon="steering" value={totalDrivers} label="Drivers" delay={200} color={COLORS.success} />
                  <StatCard icon="wifi" value={onlineDrivers} label="Online" delay={300} color={COLORS.accent} />
                </View>
                <View style={styles.statsGrid}>
                  <StatCard icon="car" value={totalVehicles} label="Vehicles" delay={400} />
                  <StatCard icon="book-check" value={activeBookings} label="Active bookings" delay={500} color={COLORS.warning} />
                  <StatCard icon="map-marker-path" value={activeRoutes} label="Routes" delay={600} color={COLORS.primary} />
                </View>
                <View style={styles.statsGrid}>
                  <StatCard icon="map-marker-distance" value={trips.length} label="Total trips" delay={700} />
                  <StatCard icon="bus" value={activeTrips} label="Active trips" delay={800} color={COLORS.success} />
                </View>
              </View>
            )}

            {/* ══════ Drivers ══════ */}
            {activeTab === "drivers" && (
              <View style={styles.list}>
                {drivers.length === 0 ? (
                  <View style={styles.emptyState}>
                    <MaterialCommunityIcons name="steering" size={36} color={COLORS.textSecondary} />
                    <AppText variant="body" style={styles.emptyText}>No drivers registered yet.</AppText>
                  </View>
                ) : (
                  drivers.map((driver) => (
                    <View key={driver.id} style={styles.listCard}>
                      <View style={styles.listIcon}>
                        <MaterialCommunityIcons
                          name={driver.online ? "wifi" : "wifi-off"}
                          size={18}
                          color={driver.online ? COLORS.success : COLORS.textSecondary}
                        />
                      </View>
                      <View style={styles.listCopy}>
                        <AppText variant="heading" style={styles.listTitle}>
                          {driver.name || driver.userId?.slice(0, 8) + "..."}
                        </AppText>
                        <AppText variant="caption" style={styles.listSubtitle}>
                          {driver.online ? "Online" : "Offline"} · {driver.availableSeats ?? 0} seats · {driver.vehicleRegistration || driver.vehicleId || "No vehicle"}
                          {driver.phone ? ` · ${driver.phone}` : ""}
                        </AppText>
                      </View>
                      <View style={styles.rowActions}>
                        <Pressable
                          style={[styles.actionBtn, { backgroundColor: driver.online ? COLORS.warning : COLORS.success }]}
                          onPress={() => void handleToggleDriverOnline(driver)}
                        >
                          <MaterialCommunityIcons name={driver.online ? "wifi-off" : "wifi"} size={14} color={COLORS.white} />
                        </Pressable>
                        <Pressable
                          style={[styles.actionBtn, { backgroundColor: COLORS.danger }]}
                          onPress={() => void handleDeleteDriver(driver.id)}
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={14} color={COLORS.white} />
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* ══════ Users ══════ */}
            {activeTab === "users" && (
              <View style={styles.list}>
                {users.length === 0 ? (
                  <View style={styles.emptyState}>
                    <MaterialCommunityIcons name="account-group" size={36} color={COLORS.textSecondary} />
                    <AppText variant="body" style={styles.emptyText}>No users yet.</AppText>
                  </View>
                ) : (
                  users.map((user) => (
                    <View key={user.id} style={styles.listCard}>
                      <View style={styles.listIcon}>
                        <MaterialCommunityIcons
                          name={user.role === "admin" ? "shield-crown" : user.role === "driver" ? "steering" : "account"}
                          size={18}
                          color={user.role === "admin" ? COLORS.accent : user.role === "driver" ? COLORS.primary : COLORS.textSecondary}
                        />
                      </View>
                      <View style={styles.listCopy}>
                        <AppText variant="heading" style={styles.listTitle}>{user.name || "—"}</AppText>
                        <AppText variant="caption" style={styles.listSubtitle}>
                          {user.email || "—"} · <AppText variant="caption" style={{ color: user.role === "admin" ? COLORS.accent : COLORS.primary, fontWeight: "700" }}>{user.role || "passenger"}</AppText>
                        </AppText>
                      </View>
                      <View style={styles.rowActions}>
                        <Pressable
                          style={[styles.actionBtn, { backgroundColor: COLORS.primary }]}
                          onPress={() => { setEditItem(user); setEditType("role"); setEditField(user.role || "passenger"); }}
                        >
                          <MaterialCommunityIcons name="pencil" size={14} color={COLORS.white} />
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* ══════ Vehicles ══════ */}
            {activeTab === "vehicles" && (
              <View style={styles.list}>
                {vehicles.length === 0 ? (
                  <View style={styles.emptyState}>
                    <MaterialCommunityIcons name="car" size={36} color={COLORS.textSecondary} />
                    <AppText variant="body" style={styles.emptyText}>No vehicles registered yet.</AppText>
                  </View>
                ) : (
                  vehicles.map((vehicle) => (
                    <View key={vehicle.id} style={styles.listCard}>
                      <View style={styles.listIcon}>
                        <MaterialCommunityIcons name="car" size={18} color={COLORS.primary} />
                      </View>
                      <View style={styles.listCopy}>
                        <AppText variant="heading" style={styles.listTitle}>{vehicle.numberPlate || "—"}</AppText>
                        <AppText variant="caption" style={styles.listSubtitle}>
                          {vehicle.color || "—"} · {vehicle.capacity || "—"} seats · {vehicle.brand || "—"}
                        </AppText>
                      </View>
                      <View style={styles.rowActions}>
                        <Pressable
                          style={[styles.actionBtn, { backgroundColor: COLORS.primary }]}
                          onPress={() => { setEditItem(vehicle); setEditType("vehicle"); setEditField(vehicle.numberPlate || ""); }}
                        >
                          <MaterialCommunityIcons name="pencil" size={14} color={COLORS.white} />
                        </Pressable>
                        <Pressable
                          style={[styles.actionBtn, { backgroundColor: COLORS.danger }]}
                          onPress={() => void handleDeleteVehicle(vehicle.id, vehicle.numberPlate || "—")}
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={14} color={COLORS.white} />
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* ══════ Bookings ══════ */}
            {activeTab === "bookings" && (
              <View style={styles.list}>
                {bookings.length === 0 ? (
                  <View style={styles.emptyState}>
                    <MaterialCommunityIcons name="book-check" size={36} color={COLORS.textSecondary} />
                    <AppText variant="body" style={styles.emptyText}>No bookings yet.</AppText>
                  </View>
                ) : (
                  bookings.map((booking) => (
                    <View key={booking.id} style={styles.listCard}>
                      <View style={styles.listIcon}>
                        <MaterialCommunityIcons
                          name={booking.status === "confirmed" ? "check-circle" : booking.status === "cancelled" ? "close-circle" : booking.status === "completed" ? "flag-checkered" : "clock-outline"}
                          size={18}
                          color={statusColor(booking.status)}
                        />
                      </View>
                      <View style={styles.listCopy}>
                        <AppText variant="heading" style={styles.listTitle}>
                          {booking.pickupLocation?.address || "Pickup"} → {booking.dropOffLocation?.address || "Drop-off"}
                        </AppText>
                        <AppText variant="caption" style={styles.listSubtitle}>
                          {booking.seats || 1} seat · <AppText variant="caption" style={{ color: statusColor(booking.status), fontWeight: "700" }}>{booking.status}</AppText>
                        </AppText>
                      </View>
                      <View style={styles.rowActions}>
                        <Pressable
                          style={[styles.actionBtn, { backgroundColor: COLORS.primary }]}
                          onPress={() => { setEditItem(booking); setEditType("booking"); setEditField(booking.status || "pending"); }}
                        >
                          <MaterialCommunityIcons name="pencil" size={14} color={COLORS.white} />
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* ══════ Trips ══════ */}
            {activeTab === "trips" && (
              <View style={styles.list}>
                {trips.length === 0 ? (
                  <View style={styles.emptyState}>
                    <MaterialCommunityIcons name="map-marker-distance" size={36} color={COLORS.textSecondary} />
                    <AppText variant="body" style={styles.emptyText}>No trips yet.</AppText>
                  </View>
                ) : (
                  trips.map((trip) => (
                    <View key={trip.id} style={styles.listCard}>
                      <View style={styles.listIcon}>
                        <MaterialCommunityIcons
                          name={trip.status === "in_progress" ? "bus" : trip.status === "completed" ? "flag-checkered" : "clock-outline"}
                          size={18}
                          color={statusColor(trip.status)}
                        />
                      </View>
                      <View style={styles.listCopy}>
                        <AppText variant="heading" style={styles.listTitle}>
                          Trip {trip.id.slice(0, 8)}...
                        </AppText>
                        <AppText variant="caption" style={styles.listSubtitle}>
                          Driver: {driverNameMap[trip.driverId] || trip.driverId?.slice(0, 8) + "..."} · <AppText variant="caption" style={{ color: statusColor(trip.status), fontWeight: "700" }}>{trip.status}</AppText>
                        </AppText>
                        {trip.startTime && (
                          <AppText variant="caption" style={styles.listSubtitle}>
                            Started: {new Date(trip.startTime).toLocaleString()}
                          </AppText>
                        )}
                      </View>
                      <View style={styles.rowActions}>
                        <Pressable
                          style={[styles.actionBtn, { backgroundColor: COLORS.primary }]}
                          onPress={() => { setEditItem(trip); setEditType("trip"); setEditField(trip.status || "in_progress"); }}
                        >
                          <MaterialCommunityIcons name="pencil" size={14} color={COLORS.white} />
                        </Pressable>
                        <Pressable
                          style={[styles.actionBtn, { backgroundColor: COLORS.danger }]}
                          onPress={() => void handleDeleteTrip(trip.id)}
                        >
                          <MaterialCommunityIcons name="trash-can-outline" size={14} color={COLORS.white} />
                        </Pressable>
                      </View>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* ══════ Routes ══════ */}
            {activeTab === "routes" && (
              <View>
                <Pressable style={styles.addBtn} onPress={() => setShowAddForm(!showAddForm)}>
                  <MaterialCommunityIcons name={showAddForm ? "close" : "plus"} size={20} color={COLORS.white} />
                  <AppText variant="caption" style={styles.addBtnText}>{showAddForm ? "Cancel" : "Add route"}</AppText>
                </Pressable>

                {showAddForm && (
                  <View style={styles.addForm}>
                    <GlassInput placeholder="Origin (e.g. Omanjor)" icon="map-marker-account" value={origin} onChangeText={setOrigin} />
                    <GlassInput placeholder="Destination (e.g. Lapaz (Race Course))" icon="map-marker" value={destination} onChangeText={setDestination} />
                    <GlassInput placeholder="Stops (comma separated)" icon="map-marker-path" value={stopsText} onChangeText={setStopsText} />
                    <PrimaryButton title={saving ? "Adding..." : "Add route"} onPress={() => void handleAddRoute()} disabled={saving || !origin.trim() || !destination.trim()} />
                  </View>
                )}

                <View style={styles.list}>
                  {routes.map((route) => (
                    <View key={route.id} style={[styles.listCard, !route.active && { opacity: 0.5 }]}>
                      <View style={styles.listIcon}>
                        <MaterialCommunityIcons name="transit-connection-variant" size={18} color={COLORS.primary} />
                      </View>
                      <View style={styles.listCopy}>
                        <AppText variant="heading" style={styles.listTitle}>{route.origin} → {route.destination}</AppText>
                        <AppText variant="caption" style={styles.listSubtitle}>{route.stops?.length || 0} stops · {route.active ? "Active" : "Inactive"}</AppText>
                      </View>
                      <View style={styles.rowActions}>
                        <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.success }]} onPress={() => void handleToggleActive(route)}>
                          <MaterialCommunityIcons name={route.active ? "eye-off" : "eye"} size={14} color={COLORS.white} />
                        </Pressable>
                        <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.danger }]} onPress={() => void handleDeleteRoute(route.id, `${route.origin} → ${route.destination}`)}>
                          <MaterialCommunityIcons name="trash-can-outline" size={14} color={COLORS.white} />
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ══════ Edit Modal ══════ */}
      {editType === "role" && editItem && (
        <EditModal visible title="Change Role" onClose={() => setEditItem(null)}>
          <AppText variant="body" style={{ marginBottom: SPACING.md, color: COLORS.textSecondary }}>
            Change role for {editItem.name || editItem.email || editItem.id}
          </AppText>
          {["passenger", "driver", "admin"].map((role) => (
            <Pressable
              key={role}
              style={[styles.roleOption, editField === role && styles.roleOptionActive]}
              onPress={() => setEditField(role)}
            >
              <MaterialCommunityIcons
                name={role === "admin" ? "shield-crown" : role === "driver" ? "steering" : "account"}
                size={18}
                color={editField === role ? COLORS.white : COLORS.primary}
              />
              <AppText variant="heading" style={[styles.roleText, editField === role && { color: COLORS.white }]}>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </AppText>
            </Pressable>
          ))}
          <PrimaryButton
            title="Save role"
            onPress={() => void handleChangeRole(editItem.id, editField)}
            style={{ marginTop: SPACING.md }}
          />
        </EditModal>
      )}

      {editType === "vehicle" && editItem && (
        <EditModal visible title="Edit Vehicle" onClose={() => setEditItem(null)}>
          <VehicleEditForm
            vehicle={editItem}
            onSave={async (fields) => {
              setEditSaving(true);
              try {
                await updateDoc(doc(db, "vehicles", editItem.id), { ...fields, updatedAt: new Date().toISOString() });
                showToast("success", "Vehicle updated", "Changes saved.");
                setEditItem(null);
                void loadAllData();
              } catch {
                showToast("error", "Update failed", "Could not save changes.");
              } finally {
                setEditSaving(false);
              }
            }}
            saving={editSaving}
          />
        </EditModal>
      )}

      {editType === "booking" && editItem && (
        <EditModal visible title="Edit Booking Status" onClose={() => setEditItem(null)}>
          <AppText variant="body" style={{ marginBottom: SPACING.md, color: COLORS.textSecondary }}>
            Booking: {editItem.pickupLocation?.address || "Pickup"} → {editItem.dropOffLocation?.address || "Drop-off"}
          </AppText>
          {["pending", "confirmed", "completed", "cancelled"].map((status) => (
            <Pressable
              key={status}
              style={[styles.roleOption, editField === status && styles.roleOptionActive]}
              onPress={() => setEditField(status)}
            >
              <MaterialCommunityIcons
                name={status === "confirmed" ? "check-circle" : status === "cancelled" ? "close-circle" : status === "completed" ? "flag-checkered" : "clock-outline"}
                size={18}
                color={editField === status ? COLORS.white : statusColor(status)}
              />
              <AppText variant="heading" style={[styles.roleText, editField === status && { color: COLORS.white }]}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </AppText>
            </Pressable>
          ))}
          <PrimaryButton
            title="Save status"
            onPress={() => void handleUpdateBookingStatus(editItem.id, editField)}
            style={{ marginTop: SPACING.md }}
          />
        </EditModal>
      )}

      {editType === "trip" && editItem && (
        <EditModal visible title="Edit Trip Status" onClose={() => setEditItem(null)}>
          <AppText variant="body" style={{ marginBottom: SPACING.md, color: COLORS.textSecondary }}>
            Trip {editItem.id.slice(0, 8)}...
          </AppText>
          {["online", "boarding", "in_progress", "completed", "cancelled"].map((status) => (
            <Pressable
              key={status}
              style={[styles.roleOption, editField === status && styles.roleOptionActive]}
              onPress={() => setEditField(status)}
            >
              <MaterialCommunityIcons
                name={status === "in_progress" ? "bus" : status === "completed" ? "flag-checkered" : status === "cancelled" ? "close-circle" : "clock-outline"}
                size={18}
                color={editField === status ? COLORS.white : statusColor(status)}
              />
              <AppText variant="heading" style={[styles.roleText, editField === status && { color: COLORS.white }]}>
                {status === "in_progress" ? "In Progress" : status.charAt(0).toUpperCase() + status.slice(1)}
              </AppText>
            </Pressable>
          ))}
          <PrimaryButton
            title="Save status"
            onPress={() => void handleUpdateTripStatus(editItem.id, editField)}
            style={{ marginTop: SPACING.md }}
          />
        </EditModal>
      )}
    </AppBackground>
  );
}

// ---------------------------------------------------------------------------
// Vehicle edit sub-form
// ---------------------------------------------------------------------------

function VehicleEditForm({
  vehicle,
  onSave,
  saving,
}: {
  vehicle: any;
  onSave: (fields: Record<string, any>) => void;
  saving: boolean;
}) {
  const [numberPlate, setNumberPlate] = useState(vehicle.numberPlate || "");
  const [color, setColor] = useState(vehicle.color || "");
  const [brand, setBrand] = useState(vehicle.brand || "");
  const [capacity, setCapacity] = useState(String(vehicle.capacity || ""));

  return (
    <View style={{ gap: SPACING.sm }}>
      <GlassInput placeholder="Number plate" icon="car" value={numberPlate} onChangeText={setNumberPlate} />
      <GlassInput placeholder="Color" icon="palette" value={color} onChangeText={setColor} />
      <GlassInput placeholder="Brand" icon="factory" value={brand} onChangeText={setBrand} />
      <GlassInput placeholder="Capacity (seats)" icon="seat" value={capacity} onChangeText={setCapacity} keyboardType="numeric" />
      <PrimaryButton
        title={saving ? "Saving..." : "Save changes"}
        onPress={() => onSave({ numberPlate, color, brand, capacity: parseInt(capacity) || 0 })}
        disabled={saving || !numberPlate.trim()}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 56,
    paddingBottom: SPACING.xxl + 20,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.blueWash, marginBottom: SPACING.md,
  },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: SPACING.xs },
  title: { color: COLORS.navy, fontSize: 28, lineHeight: 34, marginBottom: SPACING.lg },

  /* Tabs */
  tabBar: { gap: SPACING.sm, marginBottom: SPACING.xl },
  tab: {
    flexDirection: "row", alignItems: "center", gap: SPACING.xs,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm,
    borderRadius: 20, backgroundColor: COLORS.glass,
    borderWidth: 1, borderColor: COLORS.glassBorder,
  },
  tabActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { color: COLORS.textSecondary, fontSize: 12, fontWeight: "600" },
  tabTextActive: { color: COLORS.white },

  /* Stats */
  statsGrid: { flexDirection: "row", gap: SPACING.sm, marginBottom: SPACING.sm },

  /* Lists */
  list: { gap: SPACING.sm },
  listCard: {
    flexDirection: "row", alignItems: "center", padding: SPACING.md,
    borderRadius: 16, backgroundColor: COLORS.glass,
    borderWidth: 1, borderColor: COLORS.glassBorder,
  },
  listIcon: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.blueWash, marginRight: SPACING.md,
  },
  listCopy: { flex: 1 },
  listTitle: { color: COLORS.navy, fontSize: 14, lineHeight: 19 },
  listSubtitle: { color: COLORS.textSecondary, marginTop: 2 },
  rowActions: { flexDirection: "row", gap: SPACING.xs },
  actionBtn: {
    width: 30, height: 30, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },

  /* Add form */
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: SPACING.xs, padding: SPACING.md, borderRadius: 14,
    backgroundColor: COLORS.primary, marginBottom: SPACING.md,
  },
  addBtnText: { color: COLORS.white, fontWeight: "700" },
  addForm: {
    marginBottom: SPACING.md, padding: SPACING.md,
    borderRadius: 18, backgroundColor: COLORS.glass,
    borderWidth: 1, borderColor: COLORS.glassBorder,
  },

  /* Empty */
  emptyState: { alignItems: "center", paddingVertical: SPACING.xl },
  emptyText: { color: COLORS.textSecondary, textAlign: "center", marginTop: SPACING.sm },

  /* Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: SPACING.lg,
    paddingBottom: 40,
    maxHeight: "70%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.lg,
  },
  modalTitle: { color: COLORS.navy, fontSize: 20 },
  modalClose: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.blueWash,
  },

  /* Role picker */
  roleOption: {
    flexDirection: "row", alignItems: "center", gap: SPACING.md,
    padding: SPACING.md, borderRadius: 14, marginBottom: SPACING.sm,
    backgroundColor: COLORS.glass, borderWidth: 1, borderColor: COLORS.glassBorder,
  },
  roleOptionActive: {
    backgroundColor: COLORS.primary, borderColor: COLORS.primary,
  },
  roleText: { color: COLORS.navy, fontSize: 16, fontWeight: "600" },
});
