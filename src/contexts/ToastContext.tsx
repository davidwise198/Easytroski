import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { registerToastShow } from "../utils/toast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastType = "error" | "success" | "info" | "warning";

type ToastMessage = {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms — defaults to 4 000
};

type ToastContextValue = {
  /** Show a short-lived banner at the top of the screen. */
  showToast: (
    type: ToastType,
    title: string,
    message?: string,
    duration?: number
  ) => void;
  /** Convenience: show an error toast from any error object. */
  showError: (error: unknown, fallbackTitle?: string) => void;
  /** Convenience: show a success toast. */
  showSuccess: (title: string, message?: string) => void;
  /** Convenience: show an info toast. */
  showInfo: (title: string, message?: string) => void;
  /** Dismiss a specific toast by id. */
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
  showError: () => {},
  showSuccess: () => {},
  showInfo: () => {},
  dismiss: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let toastCounter = 0;
function nextId() {
  return `toast-${++toastCounter}-${Date.now()}`;
}

function getFriendlyMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const msg = String((error as { message: unknown }).message);
    // Don't leak internal Firebase details
    if (/firebase|internal|stack/i.test(msg)) {
      return "Something went wrong. Please try again.";
    }
    return msg;
  }
  return "Something went wrong. Please try again.";
}

const ICON_MAP: Record<
  ToastType,
  { name: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; color: string }
> = {
  error: { name: "alert-circle", color: "#DC2626" },
  success: { name: "check-circle", color: "#16A34A" },
  warning: { name: "alert", color: "#D97706" },
  info: { name: "information", color: "#2563EB" },
};

const BG_MAP: Record<ToastType, string> = {
  error: "#FEF2F2",
  success: "#F0FDF4",
  warning: "#FFFBEB",
  info: "#EFF6FF",
};

const BORDER_MAP: Record<ToastType, string> = {
  error: "#FECACA",
  success: "#BBF7D0",
  warning: "#FDE68A",
  info: "#BFDBFE",
};

// ---------------------------------------------------------------------------
// Single toast item
// ---------------------------------------------------------------------------

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-20)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        friction: 8,
        tension: 60,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -20,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => onDismiss(toast.id));
    }, toast.duration ?? 4000);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, opacity, translateY, onDismiss]);

  const icon = ICON_MAP[toast.type];

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          opacity,
          transform: [{ translateY }],
          backgroundColor: BG_MAP[toast.type],
          borderColor: BORDER_MAP[toast.type],
        },
      ]}
    >
      <MaterialCommunityIcons
        name={icon.name}
        size={22}
        color={icon.color}
        style={styles.toastIcon}
      />
      <View style={styles.toastContent}>
        <Text style={[styles.toastTitle, { color: icon.color }]}>
          {toast.title}
        </Text>
        {toast.message ? (
          <Text style={styles.toastMessage}>{toast.message}</Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => onDismiss(toast.id)}
        style={styles.closeButton}
        hitSlop={8}
      >
        <MaterialCommunityIcons
          name="close"
          size={16}
          color="#9CA3AF"
        />
      </Pressable>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Register with the standalone toast helper so alert()-replacement works
  useEffect(() => {
    registerToastShow((type, title, message) => {
      const id = nextId();
      setToasts((prev) => {
        const next = prev.length >= 3 ? prev.slice(1) : prev;
        return [...next, { id, type, title, message, duration: 4000 }];
      });
    });
  }, []);

  const showToast = useCallback(
    (
      type: ToastType,
      title: string,
      message?: string,
      duration?: number
    ) => {
      const id = nextId();
      const toast: ToastMessage = { id, type, title, message, duration };
      setToasts((prev) => {
        // Keep at most 3 toasts visible at once
        const next = prev.length >= 3 ? prev.slice(1) : prev;
        return [...next, toast];
      });
    },
    []
  );

  const showError = useCallback(
    (error: unknown, fallbackTitle = "Error") => {
      showToast("error", fallbackTitle, getFriendlyMessage(error));
    },
    [showToast]
  );

  const showSuccess = useCallback(
    (title: string, message?: string) => {
      showToast("success", title, message);
    },
    [showToast]
  );

  const showInfo = useCallback(
    (title: string, message?: string) => {
      showToast("info", title, message, 3000);
    },
    [showToast]
  );

  return (
    <ToastContext.Provider
      value={{ showToast, showError, showSuccess, showInfo, dismiss }}
    >
      {children}
      {/* Toast overlay — rendered above everything */}
      <View style={styles.overlay} pointerEvents="box-none">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingTop: Platform.OS === "ios" ? 56 : 40,
    paddingHorizontal: 16,
    // Don't block touches on the rest of the screen
    pointerEvents: "box-none",
  },
  toast: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
    // Shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  toastIcon: {
    marginRight: 10,
    marginTop: 1,
  },
  toastContent: {
    flex: 1,
  },
  toastTitle: {
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  toastMessage: {
    fontSize: 13,
    color: "#4B5563",
    lineHeight: 18,
    marginTop: 2,
  },
  closeButton: {
    marginLeft: 8,
    padding: 4,
  },
});
