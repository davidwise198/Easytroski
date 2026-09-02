import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useColorScheme } from "react-native";

import { COLORS, COLORS_DARK, type ColorPalette } from "../theme/colors";

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

type ThemeContextValue = {
  colors: ColorPalette;
  isDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  colors: COLORS,
  isDark: false,
});

export function useThemeColors() {
  return useContext(ThemeContext);
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";

  // Mutate COLORS in-place so every import sees the current palette
  useEffect(() => {
    syncColors(isDark);
  }, [isDark]);

  const value = useMemo(
    () => ({
      colors: isDark ? COLORS_DARK : COLORS,
      isDark,
    }),
    [isDark],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
