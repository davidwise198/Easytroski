import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import * as ImagePicker from "expo-image-picker";
import { updateProfile } from "firebase/auth";

import { auth, db } from "./firebase";
import { supabase, ensureSupabaseSession } from "./supabase";

// ---------------------------------------------------------------------------
// Profile photo storage — Supabase Storage (bucket: profile-photos).
// The URL is still saved to Firestore so all display code stays unchanged.
// ---------------------------------------------------------------------------

const PROFILE_BUCKET = "profile-photos";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/** The user's profile photo URL, or null if using default avatar. */
export async function getUserProfile(userId: string) {
  try {
    const docSnap = await getDoc(doc(db, "users", userId));
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as Record<string, any>;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Photo upload
// ---------------------------------------------------------------------------

/**
 * Upload a blob to Supabase Storage and return its public URL.
 * Throws friendly, actionable errors on failure.
 */
async function uploadProfilePhoto(userId: string, blob: Blob): Promise<string> {
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is too large. Please choose a smaller photo (under 5 MB).");
  }

  await ensureSupabaseSession();

  // Unique filename (timestamp) busts the image cache when re-uploading.
  const fileName = `${userId}/${Date.now()}.jpg`;

  const { error } = await supabase.storage
    .from(PROFILE_BUCKET)
    .upload(fileName, blob, { contentType: "image/jpeg", upsert: true });

  if (error) {
    const message = `${error.message || ""} ${error.status || ""}`.toLowerCase();
    if (/permission|unauthorized|policy|row.?level|forbidden/.test(message)) {
      throw new Error(
        "Permission denied. Please check that the Supabase storage policies allow profile photo uploads."
      );
    }
    if (/bucket|not found|does not exist/.test(message)) {
      throw new Error(
        "Storage is not configured correctly. Please check the profile-photos bucket exists."
      );
    }
    if (/size|large|limit/.test(message)) {
      throw new Error("Image is too large. Please choose a smaller photo.");
    }
    throw new Error("Upload failed. Check your internet connection and try again.");
  }

  const { data } = supabase.storage.from(PROFILE_BUCKET).getPublicUrl(fileName);

  // Best-effort cleanup of older photos for this user (non-fatal).
  try {
    const { data: existing } = await supabase.storage
      .from(PROFILE_BUCKET)
      .list(userId, { limit: 50 });
    const currentName = fileName.split("/").pop() as string;
    const stale = (existing || [])
      .filter((f) => f.name && f.name !== currentName)
      .map((f) => `${userId}/${f.name}`);
    if (stale.length) {
      await supabase.storage.from(PROFILE_BUCKET).remove(stale);
    }
  } catch {
    // Orphaned old photos are harmless — ignore cleanup failures.
  }

  return data.publicUrl;
}

/**
 * Persist the photo URL to Firestore + Firebase Auth + the driver doc.
 */
async function savePhotoURL(userId: string, downloadURL: string) {
  await setDoc(
    doc(db, "users", userId),
    { photoURL: downloadURL, updatedAt: serverTimestamp() },
    { merge: true }
  );

  if (auth.currentUser) {
    try {
      await updateProfile(auth.currentUser, { photoURL: downloadURL });
    } catch {
      // Some auth providers don't allow profile updates
    }
  }

  try {
    const driverDoc = await getDoc(doc(db, "drivers", userId));
    if (driverDoc.exists()) {
      await setDoc(
        doc(db, "drivers", userId),
        { photoURL: downloadURL, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
  } catch {
    // Best-effort
  }
}

/**
 * Pick an image from the gallery, upload to Supabase Storage,
 * and update the user's Firestore profile + Auth profile.
 * Returns the public URL of the uploaded image.
 */
export async function pickAndUploadPhoto(userId: string): Promise<string | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Permission to access photos is required.");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }

  const asset = result.assets[0];

  let blob: Blob;
  try {
    const response = await fetch(asset.uri);
    blob = await response.blob();
  } catch {
    throw new Error("Failed to read image file. Please try again.");
  }

  const downloadURL = await uploadProfilePhoto(userId, blob);
  await savePhotoURL(userId, downloadURL);
  return downloadURL;
}

/**
 * Take a photo with the camera, upload to Supabase Storage,
 * and update the user's Firestore profile + Auth profile.
 * Returns the public URL of the uploaded image.
 */
export async function takeAndUploadPhoto(userId: string): Promise<string | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Permission to access camera is required.");
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });

  if (result.canceled || !result.assets?.[0]) {
    return null;
  }

  const asset = result.assets[0];

  let blob: Blob;
  try {
    const response = await fetch(asset.uri);
    blob = await response.blob();
  } catch {
    throw new Error("Failed to read camera image. Please try again.");
  }

  const downloadURL = await uploadProfilePhoto(userId, blob);
  await savePhotoURL(userId, downloadURL);
  return downloadURL;
}

/**
 * Update the user's display name.
 */
export async function updateDisplayName(userId: string, name: string) {
  await setDoc(
    doc(db, "users", userId),
    { name, updatedAt: serverTimestamp() },
    { merge: true }
  );

  if (auth.currentUser) {
    try {
      await updateProfile(auth.currentUser, { displayName: name });
    } catch {
      // ignore
    }
  }

  // Also update driver profile if they're a driver
  try {
    const driverDoc = await getDoc(doc(db, "drivers", userId));
    if (driverDoc.exists()) {
      await setDoc(
        doc(db, "drivers", userId),
        { name, updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
  } catch {
    // Best-effort
  }
}

/**
 * Get the photo URL for a user — from Firestore, Firebase Auth, or null.
 * For Google signups: user.photoURL is set by Google.
 * For email signups: user.photoURL is null → caller shows default avatar.
 */
export function getPhotoURL(user: any, profile: Record<string, any> | null): string | null {
  // Priority: Firestore profile > Firebase Auth > null
  if (profile?.photoURL) return profile.photoURL;
  if (user?.photoURL) return user.photoURL;
  return null;
}