import React, { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import AsyncStorage from "@react-native-async-storage/async-storage";

import AuthProvider, { useAuth } from "../src/contexts/AuthContext";
import LocationProvider from "../src/contexts/LocationContext";
import ThemeProvider from "../src/contexts/ThemeContext";
import { ToastProvider } from "../src/contexts/ToastContext";
import ErrorBoundary from "../src/components/ui/ErrorBoundary";
import AppIntro from "../src/components/ui/AppIntro";
import OnboardingCarousel from "../src/components/ui/OnboardingCarousel";
import UpdateChecker from "../src/components/UpdateChecker";

// First-launch onboarding shows exactly once, ever — the flag is
// permanent so returning users go straight to the app.
const ONBOARDING_SEEN_KEY = "easytroski.onboarding_seen_v1";

SplashScreen.preventAutoHideAsync().catch(() => {
  // The native splash may already be hidden in Expo Go.
});

function RootLayoutNav() {
  const { loading } = useAuth();
  const [showIntro, setShowIntro] = useState(true);
  // null = still checking AsyncStorage; undefined = checked, not first launch
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDING_SEEN_KEY)
      .then((seen) => {
        if (!cancelled) setShowOnboarding(seen == null);
      })
      .catch(() => {
        // Storage failure must never trap the user in onboarding.
        if (!cancelled) setShowOnboarding(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const completeOnboarding = React.useCallback(() => {
    setShowOnboarding(false);
    AsyncStorage.setItem(ONBOARDING_SEEN_KEY, "1").catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  // The carousel renders above the brand intro; both must finish before
  // the app content takes over. It only ever shows on first launch.
  const introDone = !showIntro;

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
      {/* Wait until auth finishes so the native splash is hidden first —
          otherwise the intro animation plays underneath it and the user
          misses it entirely. */}
      {!loading && showIntro && <AppIntro onComplete={() => setShowIntro(false)} />}
      {!loading && introDone && showOnboarding === true && (
        <OnboardingCarousel onComplete={completeOnboarding} />
      )}
      {/* While the first-launch check is pending, block interaction so the
          carousel can't be missed — resolves in milliseconds. */}
      {!loading && introDone && showOnboarding === null && (
        <View style={styles.holdScreen} />
      )}
    </>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <LocationProvider>
            <ToastProvider>
              <UpdateChecker>
                <RootLayoutNav />
              </UpdateChecker>
            </ToastProvider>
          </LocationProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  holdScreen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    backgroundColor: "transparent",
  },
});