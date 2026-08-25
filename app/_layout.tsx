import React, { useEffect, useState } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";

import AuthProvider, { useAuth } from "../src/contexts/AuthContext";
import AppIntro from "../src/components/ui/AppIntro";

SplashScreen.preventAutoHideAsync().catch(() => {
  // The native splash may already be hidden in Expo Go.
});

function RootLayoutNav() {
  const { loading } = useAuth();
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
      {showIntro && <AppIntro onComplete={() => setShowIntro(false)} />}
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}