import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { COLORS, COLORS_DARK, type ColorPalette } from "../theme/colors";

// ---------------------------------------------------------------------------
// Theme mode: "system" | "light" | "dark"
// ---------------------------------------------------------------------------

export type ThemeMode = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "@easytroski/theme-mode";

// ---------------------------------------------------------------------------
// Sync the mutable COLORS object in-place when the theme changes.
// This fixes ALL runtime references to COLORS.navy, COLORS.textSecondary, etc.
// across every screen — no per-component overrides needed for inline styles.
// ---------------------------------------------------------------------------

const LIGHT_SNAPSHOT: Record<string, string> = { ...COLORS };

function syncColors(isDark: boolean) {
  const source = isDark ? COLORS_DARK : LIGHT_SNAPSHOT;
  for (const key of Object.keys(source)) {
    (COLORS as Record<string, any>)[key] = (source as Record<string, any>)[key];
  }
}

// ---------------------------------------------------------------------------
// Determine system dark mode
// ---------------------------------------------------------------------------

function getSystemIsDark(): boolean {
  return Appearance.getColorScheme() === "dark";
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type ThemeContextValue = {
  colors: ColorPalette;
  isDark: boolean;
  /** Current theme mode preference: "system" | "light" | "dark" */
  themeMode: ThemeMode;
  /** Set the theme mode preference */
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  colors: COLORS,
  isDark: false,
  themeMode: "system",
  setThemeMode: () => {},
});

export function useThemeColors() {
  return useContext(ThemeContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [systemIsDark, setSystemIsDark] = useState<boolean>(getSystemIsDark);

  // Load saved theme preference on mount
  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((saved) => {
      if (saved === "light" || saved === "dark" || saved === "system") {
        setThemeModeState(saved);
      }
    });
  }, []);

  // Listen for system appearance changes (critical for Android)
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemIsDark(colorScheme === "dark");
    });
    return () => subscription?.remove();
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
  }, []);

  // Resolve actual dark mode from preference
  const isDark = useMemo(() => {
    switch (themeMode) {
      case "dark":
        return true;
      case "light":
        return false;
      case "system":
      default:
        return systemIsDark;
    }
  }, [themeMode, systemIsDark]);

  // Mutate COLORS in-place so every import sees the current palette
  useEffect(() => {
    syncColors(isDark);
    // Also set the native Appearance for Android system UI
    if (Platform.OS === "android") {
      Appearance.setColorScheme(isDark ? "dark" : "light");
    }
  }, [isDark]);

  const value = useMemo(
    () => ({
      // Always return a stable snapshot — never the mutable COLORS object.
      // COLORS gets mutated by syncColors for inline JSX references, but
      // returning it here causes ds hooks to compute with stale values
      // during the frame between theme switch and useEffect sync.
      colors: isDark ? COLORS_DARK : (LIGHT_SNAPSHOT as ColorPalette),
      isDark,
      themeMode,
      setThemeMode,
    }),
    [isDark, themeMode, setThemeMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
