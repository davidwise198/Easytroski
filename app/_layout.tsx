import React, { useEffect, useState } from "react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";

import AppIntro from "../src/components/ui/AppIntro";

SplashScreen.preventAutoHideAsync().catch(() => {
  // The native splash may already be hidden in Expo Go.
});

export default function RootLayout() {
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

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