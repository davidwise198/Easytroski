import React, { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";

import { COLORS, COLORS_DARK, type ColorPalette } from "../theme/colors";

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
