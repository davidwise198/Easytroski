import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";

import AppBackground from "../src/components/ui/AppBackground";
import AppText from "../src/components/ui/AppText";
import GlassInput from "../src/components/ui/GlassInput";
import PrimaryButton from "../src/components/ui/PrimaryButton";
import { useAuth } from "../src/contexts/AuthContext";
import { useThemeColors } from "../src/contexts/ThemeContext";
import ThemeToggle from "../src/components/ui/ThemeToggle";
import { useMemo } from "react";
import {
  getUserProfile,
  getPhotoURL,
  pickAndUploadPhoto,
  takeAndUploadPhoto,
  updateDisplayName,
} from "../src/services/profile";
import { COLORS, SPACING } from "../src/theme";
import { showToast } from "../src/utils/toast";

export default function ProfileScreen() {
  const { user } = useAuth();
  const { colors } = useThemeColors();
  const ds = useMemo(() => ({
    title: { color: colors.text },
    fieldLabel: { color: colors.text },
    fieldValue: { color: colors.textSecondary },
    photoHint: { color: colors.textSecondary },
    backBtn: { backgroundColor: colors.blueWash },
    avatarLarge: { backgroundColor: colors.blueWash },
    photoPlaceholder: { backgroundColor: colors.blueWash },
    fieldCard: { backgroundColor: colors.glass, borderColor: colors.glassBorder },
    divider: { backgroundColor: colors.veryLightBlue },
  }), [colors]);
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    if (user?.uid) {
      getUserProfile(user.uid)
        .then((p) => {
          setProfile(p);
          setName(p?.name || user?.displayName || "");
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  }, [user?.uid]);

  const photoURL = getPhotoURL(user, profile);
  const isGoogleUser = Boolean(user?.photoURL);

  const handlePickPhoto = async () => {
    Alert.alert("Change photo", "Choose a source", [
      {
        text: "Gallery",
        onPress: async () => {
          try {
            setSaving(true);
            const url = await pickAndUploadPhoto(user!.uid);
            if (url) {
              setProfile((prev) => ({ ...prev, photoURL: url }));
              showToast("success", "Photo updated", "Your profile photo has been changed.");
            }
          } catch (err: any) {
            showToast("error", "Upload failed", err.message || "Could not update photo.");
          } finally {
            setSaving(false);
          }
        },
      },
      {
        text: "Camera",
        onPress: async () => {
          try {
            setSaving(true);
            const url = await takeAndUploadPhoto(user!.uid);
            if (url) {
              setProfile((prev) => ({ ...prev, photoURL: url }));
              showToast("success", "Photo updated", "Your profile photo has been changed.");
            }
          } catch (err: any) {
            showToast("error", "Upload failed", err.message || "Could not update photo.");
          } finally {
            setSaving(false);
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const handleSaveName = async () => {
    if (!name.trim() || !user?.uid) return;
    setSaving(true);
    try {
      await updateDisplayName(user.uid, name.trim());
      setProfile((prev) => ({ ...prev, name: name.trim() }));
      setEditingName(false);
      showToast("success", "Name updated", "Your display name has been changed.");
    } catch {
      showToast("error", "Update failed", "Could not update name.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppBackground>
        <View style={styles.center}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      </AppBackground>
    );
  }

  return (
    <AppBackground>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Back */}
        <Pressable style={[styles.backBtn, ds.backBtn]} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.primary} />
        </Pressable>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View>
            <AppText variant="caption" style={styles.eyebrow}>PROFILE</AppText>
            <AppText variant="title" style={[styles.title, ds.title]}>My Account</AppText>
          </View>
          <ThemeToggle />
        </View>

        {/* Photo */}
        <View style={styles.photoSection}>
          <Pressable onPress={() => void handlePickPhoto()}>
            <View style={styles.photoContainer}>
              {photoURL ? (
                <Image source={{ uri: photoURL }} style={styles.photo} resizeMode="cover" />
              ) : (
                <View style={[styles.photoPlaceholder, ds.photoPlaceholder]}>
                  <MaterialCommunityIcons name="account" size={48} color={COLORS.primary} />
                </View>
              )}
              <View style={styles.photoEditBadge}>
                {saving ? (
                  <ActivityIndicator size="small" color={COLORS.white} />
                ) : (
                  <MaterialCommunityIcons name="camera" size={14} color={COLORS.white} />
                )}
              </View>
            </View>
          </Pressable>
          <AppText variant="caption" style={[styles.photoHint, ds.photoHint]}>
            {isGoogleUser && !photoURL
              ? "Using Google profile photo"
              : photoURL
                ? "Tap to change photo"
                : "Tap to add a photo"}
          </AppText>
        </View>

        {/* Name */}
        <View style={[styles.fieldCard, ds.fieldCard]}>
          <View style={styles.fieldHeader}>
            <AppText variant="heading" style={[styles.fieldLabel, ds.fieldLabel]}>Name</AppText>
            {!editingName ? (
              <Pressable onPress={() => setEditingName(true)}>
                <MaterialCommunityIcons name="pencil" size={18} color={COLORS.primary} />
              </Pressable>
            ) : (
              <Pressable onPress={() => { setEditingName(false); setName(profile?.name || ""); }}>
                <MaterialCommunityIcons name="close" size={18} color={COLORS.textSecondary} />
              </Pressable>
            )}
          </View>
          {editingName ? (
            <View style={styles.editSection}>
              <GlassInput
                placeholder="Enter your name"
                icon="account"
                value={name}
                onChangeText={setName}
                autoFocus
              />
              <View style={styles.editActions}>
                <PrimaryButton
                  title={saving ? "Saving..." : "Save"}
                  onPress={() => void handleSaveName()}
                  disabled={saving || !name.trim()}
                  style={styles.saveBtn}
                />
              </View>
            </View>
          ) : (
            <AppText variant="body" style={[styles.fieldValue, ds.fieldValue]}>
              {profile?.name || user?.displayName || "Not set"}
            </AppText>
          )}
        </View>

        {/* Email */}
        <View style={[styles.fieldCard, ds.fieldCard]}>
          <AppText variant="heading" style={[styles.fieldLabel, ds.fieldLabel]}>Email</AppText>
          <AppText variant="body" style={[styles.fieldValue, ds.fieldValue]}>
            {user?.email || "Not set"}
          </AppText>
        </View>

        {/* Phone */}
        <View style={[styles.fieldCard, ds.fieldCard]}>
          <AppText variant="heading" style={[styles.fieldLabel, ds.fieldLabel]}>Phone</AppText>
          <AppText variant="body" style={[styles.fieldValue, ds.fieldValue]}>
            {profile?.phone || "Not set"}
          </AppText>
        </View>

        {/* Role */}
        <View style={[styles.fieldCard, ds.fieldCard]}>
          <AppText variant="heading" style={[styles.fieldLabel, ds.fieldLabel]}>Role</AppText>
          <View style={styles.roleBadge}>
            <MaterialCommunityIcons
              name={profile?.role === "driver" ? "steering" : "account"}
              size={14}
              color={COLORS.white}
            />
            <AppText variant="caption" style={styles.roleBadgeText}>
              {profile?.role || "passenger"}
            </AppText>
          </View>
        </View>

        {/* Sign up method */}
        <View style={[styles.fieldCard, ds.fieldCard]}>
          <AppText variant="heading" style={[styles.fieldLabel, ds.fieldLabel]}>Sign-in method</AppText>
          <AppText variant="body" style={[styles.fieldValue, ds.fieldValue]}>
            {isGoogleUser ? "Google" : "Email & password"}
          </AppText>
        </View>
      </ScrollView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: 56,
    paddingBottom: SPACING.xxl + 20,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.blueWash, marginBottom: SPACING.md,
  },
  eyebrow: { color: COLORS.primary, fontSize: 10, fontWeight: "800", letterSpacing: 1.1, marginBottom: SPACING.xs },
  title: { color: COLORS.navy, fontSize: 28, lineHeight: 34, marginBottom: SPACING.xl },

  /* Photo */
  photoSection: {
    alignItems: "center",
    marginBottom: SPACING.xl,
  },
  photoContainer: {
    position: "relative",
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
  photoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.blueWash,
    alignItems: "center",
    justifyContent: "center",
  },
  photoEditBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: COLORS.white,
  },
  photoHint: {
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    textAlign: "center",
  },

  /* Fields */
  fieldCard: {
    padding: SPACING.md,
    borderRadius: 16,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    marginBottom: SPACING.sm,
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: SPACING.xs,
  },
  fieldLabel: {
    color: COLORS.navy,
    fontSize: 14,
  },
  fieldValue: {
    color: COLORS.textSecondary,
  },
  editSection: {
    marginTop: SPACING.xs,
  },
  editActions: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  saveBtn: {
    height: 44,
    flex: 1,
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignSelf: "flex-start",
    marginTop: SPACING.xs,
  },
  roleBadgeText: {
    color: COLORS.white,
    fontWeight: "700",
    textTransform: "capitalize",
  },
});
