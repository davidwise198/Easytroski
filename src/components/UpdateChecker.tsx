import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Updates from "expo-updates";

import AppText from "./ui/AppText";
import { useThemeColors } from "../contexts/ThemeContext";

// ---------------------------------------------------------------------------
// Context so any screen can trigger a manual update check
// ---------------------------------------------------------------------------

type UpdateContextValue = {
  /** Manually trigger an update check. */
  checkForUpdate: () => Promise<void>;
  /** Whether an update is currently being downloaded. */
  isDownloading: boolean;
  /** Whether a new update was found and is ready to restart. */
  updateReady: boolean;
};

const UpdateContext = createContext<UpdateContextValue>({
  checkForUpdate: async () => {},
  isDownloading: false,
  updateReady: false,
});

export function useUpdateChecker() {
  return useContext(UpdateContext);
}

// ---------------------------------------------------------------------------
// Provider + Banner
// ---------------------------------------------------------------------------

export default function UpdateChecker({ children }: { children: React.ReactNode }) {
  const { colors } = useThemeColors();
  const [bannerVisible, setBannerVisible] = useState(false);
  const [bannerMessage, setBannerMessage] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const bannerOpacity = useRef(new Animated.Value(0)).current;
  const hasChecked = useRef(false);

  const showBanner = useCallback(
    (msg: string) => {
      setBannerMessage(msg);
      setBannerVisible(true);
      Animated.spring(bannerOpacity, {
        toValue: 1,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }).start();
    },
    [bannerOpacity],
  );

  const hideBanner = useCallback(() => {
    Animated.timing(bannerOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setBannerVisible(false));
  }, [bannerOpacity]);

  const applyUpdate = useCallback(async () => {
    setUpdateReady(false);
    hideBanner();
    try {
      await Updates.reloadAsync();
    } catch {
      // ignore
    }
  }, [hideBanner]);

  const checkForUpdate = useCallback(async () => {
    try {
      if (__DEV__) {
        showBanner("Updates are not checked in development mode.");
        setTimeout(hideBanner, 3000);
        return;
      }

      showBanner("Checking for updates…");

      const update = await Updates.checkForUpdateAsync();

      if (update.isAvailable) {
        showBanner("New version found — downloading…");
        setIsDownloading(true);

        const { isNew } = await Updates.fetchUpdateAsync();
        setIsDownloading(false);

        if (isNew) {
          setUpdateReady(true);
          showBanner("Update ready! Tap to restart.");
        } else {
          showBanner("You're up to date!");
          setTimeout(hideBanner, 2500);
        }
      } else {
        showBanner("You're up to date!");
        setTimeout(hideBanner, 2500);
      }
    } catch (error) {
      setIsDownloading(false);
      showBanner("Could not check for updates.");
      setTimeout(hideBanner, 3000);
    }
  }, [showBanner, hideBanner]);

  // Auto-check on mount (once per session)
  useEffect(() => {
    if (hasChecked.current) return;
    hasChecked.current = true;
    const timer = setTimeout(checkForUpdate, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <UpdateContext.Provider value={{ checkForUpdate, isDownloading, updateReady }}>
      {children}

      {/* ── Update banner ── */}
      {bannerVisible && (
        <Animated.View
          style={[
            styles.banner,
            {
              opacity: bannerOpacity,
              backgroundColor: updateReady ? colors.primary : colors.surface,
              borderColor: updateReady ? colors.primary : colors.glassBorder,
            },
          ]}
        >
          <MaterialCommunityIcons
            name={updateReady ? "rocket-launch" : isDownloading ? "cloud-download" : "information"}
            size={18}
            color={updateReady ? colors.white : colors.primary}
          />
          <AppText
            variant="caption"
            style={[
              styles.bannerText,
              { color: updateReady ? colors.white : colors.text },
            ]}
          >
            {bannerMessage}
          </AppText>
          {updateReady ? (
            <Pressable style={styles.bannerAction} onPress={applyUpdate}>
              <AppText variant="caption" style={styles.bannerActionText}>
                Restart
              </AppText>
            </Pressable>
          ) : (
            <Pressable style={styles.bannerClose} onPress={hideBanner}>
              <MaterialCommunityIcons
                name="close"
                size={16}
                color={colors.textSecondary}
              />
            </Pressable>
          )}
        </Animated.View>
      )}
    </UpdateContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 56 : 40,
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
    zIndex: 9999,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  bannerAction: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  bannerActionText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 12,
  },
  bannerClose: {
    padding: 4,
  },
});
