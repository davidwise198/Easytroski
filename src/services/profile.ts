import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import * as ImagePicker from "expo-image-picker";
import { updateProfile } from "firebase/auth";

import { auth, db, storage } from "./firebase";

// ---------------------------------------------------------------------------
// Default avatar for email signups (no Google photo)
// ---------------------------------------------------------------------------

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
 * Pick an image from gallery or camera, upload to Firebase Storage,
 * and update the user's Firestore profile + Auth profile.
 * Returns the download URL of the uploaded image.
 */
export async function pickAndUploadPhoto(userId: string): Promise<string | null> {
  // Request media library permission
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Permission to access photos is required.");
  }

  // Launch image picker
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

  // Upload to Firebase Storage
  const response = await fetch(asset.uri);
  const blob = await response.blob();

  const storageRef = ref(storage, `profile-photos/${userId}.jpg`);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });

  // Get download URL
  const downloadURL = await getDownloadURL(storageRef);

  // Update Firestore user document
  await setDoc(
    doc(db, "users", userId),
    { photoURL: downloadURL, updatedAt: serverTimestamp() },
    { merge: true }
  );

  // Update Firebase Auth profile (if available)
  if (auth.currentUser) {
    try {
      await updateProfile(auth.currentUser, { photoURL: downloadURL });
    } catch {
      // Some auth providers don't allow profile updates
    }
  }

  // Also update driver profile if they're a driver
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

  return downloadURL;
}

/**
 * Take a photo with the camera, upload, and update profile.
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

  const response = await fetch(asset.uri);
  const blob = await response.blob();

  const storageRef = ref(storage, `profile-photos/${userId}.jpg`);
  await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });

  const downloadURL = await getDownloadURL(storageRef);

  await setDoc(
    doc(db, "users", userId),
    { photoURL: downloadURL, updatedAt: serverTimestamp() },
    { merge: true }
  );

  if (auth.currentUser) {
    try {
      await updateProfile(auth.currentUser, { photoURL: downloadURL });
    } catch {
      // ignore
    }
  }

  // Update driver profile if they're a driver
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
