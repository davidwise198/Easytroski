import React, { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { useAuth } from "../contexts/AuthContext";
import { UserRole } from "../types/models";
import { useThemeColors } from "../contexts/ThemeContext";

type AuthGateProps = {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
};

export default function AuthGate({ children, allowedRoles }: AuthGateProps) {
  const { user, userRole, loading } = useAuth();
  const { colors } = useThemeColors();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace("/auth/login");
      return;
    }

    if (!userRole) {
      router.replace("/auth/role-selection");
      return;
    }

    if (allowedRoles && !allowedRoles.includes(userRole)) {
      if (userRole === "admin") {
        router.replace("/admin-routes");
      } else {
        router.replace(userRole === "driver" ? "/driver-dashboard" : "/passenger-dashboard");
      }
      return;
    }
  }, [loading, user, userRole, allowedRoles]);

  if (loading) {
    return (
      <View style={[styles.loader, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // While navigation is in progress, show a loader
  if (!user || !userRole || (allowedRoles && !allowedRoles.includes(userRole))) {
    return (
      <View style={[styles.loader, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
