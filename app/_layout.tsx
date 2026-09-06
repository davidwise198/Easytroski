import React, { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";

import AuthProvider, { useAuth } from "../src/contexts/AuthContext";
import LocationProvider from "../src/contexts/LocationContext";
import ThemeProvider from "../src/contexts/ThemeContext";
import { ToastProvider } from "../src/contexts/ToastContext";
import ErrorBoundary from "../src/components/ui/ErrorBoundary";
import AppIntro from "../src/components/ui/AppIntro";
import UpdateChecker from "../src/components/UpdateChecker";

SplashScreen.preventAutoHideAsync().catch(() => {
  // The native splash may already be hidden in Expo Go.
});

function RootLayoutNav() {
  const { loading } = useAuth();
  const [showIntro, setShowIntro] = useState(true);
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  // Replay the intro whenever the app returns to the foreground. Without
  // this, Android keeps the process alive and reopening the app from
  // recents simply resumes it — so the intro would only ever play once
  // on a true cold start.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      if (
        nextState === "active" &&
        (prevState === "background" || prevState === "inactive")
      ) {
        setShowIntro(true);
      }
    });
    return () => subscription.remove();
  }, []);

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