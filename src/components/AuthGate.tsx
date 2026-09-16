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

    // Password accounts must verify their mailbox before using the app.
    // Google accounts are verified by Google itself, so they skip this.
    const isPasswordAccount = user.providerData.some(
      (p) => p?.providerId === "password"
    );
    if (isPasswordAccount && user.emailVerified === false) {
      router.replace("/auth/verify-email");
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
        router.replace(userRole === "driver" ? "/driver-home" : "/home");
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
  const isPasswordAccount = user?.providerData.some(
    (p) => p?.providerId === "password"
  );
  const needsVerification =
    !!user && isPasswordAccount && user.emailVerified === false;
  if (
    !user ||
    !userRole ||
    needsVerification ||
    (allowedRoles && !allowedRoles.includes(userRole))
  ) {
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
