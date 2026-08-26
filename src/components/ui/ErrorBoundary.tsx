import React from "react";
import { StyleSheet, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import AppText from "./AppText";
import PrimaryButton from "./PrimaryButton";
import AppBackground from "./AppBackground";
import { COLORS, SPACING } from "../../theme";

type Props = {
  children: React.ReactNode;
  /** Optional: called when the user taps "Try again". */
  onRetry?: () => void;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

/**
 * Global error boundary — catches any unhandled render error and shows a
 * friendly recovery screen instead of crashing the app.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // In production you'd send this to a crash reporter (Sentry, Bugsnag…)
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <AppBackground>
          <View style={styles.container}>
            <View style={styles.iconContainer}>
              <MaterialCommunityIcons
                name="cloud-alert-outline"
                size={56}
                color={COLORS.primary}
              />
            </View>

            <AppText variant="heading" style={styles.title}>
              Something went wrong
            </AppText>

            <AppText variant="body" style={styles.subtitle}>
              The app ran into an unexpected problem. Don't worry — your data
              is safe.
            </AppText>

            {__DEV__ && this.state.error ? (
              <View style={styles.debugBox}>
                <AppText variant="caption" style={styles.debugText}>
                  {this.state.error.message}
                </AppText>
              </View>
            ) : null}

            <PrimaryButton
              title="Try again"
              onPress={this.handleRetry}
              variant="primary"
              style={styles.retryButton}
            />
          </View>
        </AppBackground>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.xl,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.blueWash,
    marginBottom: SPACING.lg,
  },
  title: {
    color: COLORS.navy,
    fontSize: 24,
    lineHeight: 30,
    textAlign: "center",
  },
  subtitle: {
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: SPACING.md,
    maxWidth: 300,
    lineHeight: 20,
  },
  debugBox: {
    marginTop: SPACING.lg,
    padding: SPACING.md,
    borderRadius: 12,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    maxWidth: 340,
  },
  debugText: {
    color: "#991B1B",
    fontSize: 12,
    lineHeight: 16,
  },
  retryButton: {
    marginTop: SPACING.xl,
    minWidth: 180,
  },
});
