import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  GoogleAuthProvider,
  signInWithCredential,
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

import { auth, db } from "./firebase";

export type UserRole = "passenger" | "driver" | "admin";

export interface UserProfileData {
  fullName: string;
  email: string;
  phoneNumber: string;
  role: UserRole;
  driverLicenseNumber?: string;
  vehicleRegistrationNumber?: string;
  vehicleColor?: string;
  vehicleSeatingCapacity?: string;
  preferredRoute?: string;
}

export interface GoogleUserProfileData {
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  role?: UserRole;
}

export interface DriverProfileData {
  driverLicenseNumber: string;
  vehicleRegistrationNumber: string;
  vehicleColor: string;
  vehicleSeatingCapacity: number;
  preferredRoute?: string;
}

const createUserProfile = async (user: User, profileData: UserProfileData) => {
  const userData: Record<string, unknown> = {
    uid: user.uid,
    name: profileData.fullName,
    email: profileData.email,
    role: profileData.role,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (profileData.phoneNumber) {
    userData.phone = profileData.phoneNumber;
  }

  if (user.photoURL) {
    userData.photoURL = user.photoURL;
  }

  await setDoc(doc(db, "users", user.uid), userData, { merge: true });

  // Create driver profile if role is driver
  if (profileData.role === "driver" && profileData.driverLicenseNumber) {
    await createDriverProfile(user.uid, {
      driverLicenseNumber: profileData.driverLicenseNumber,
      vehicleRegistrationNumber: profileData.vehicleRegistrationNumber || "",
      vehicleColor: profileData.vehicleColor || "",
      vehicleSeatingCapacity: parseInt(profileData.vehicleSeatingCapacity || "0", 10),
      preferredRoute: profileData.preferredRoute,
    });
  }
};

const createDriverProfile = async (userId: string, driverData: DriverProfileData) => {
  await setDoc(
    doc(db, "drivers", userId),
    {
      userId,
      licenseNumber: driverData.driverLicenseNumber,
      vehicleRegistration: driverData.vehicleRegistrationNumber,
      vehicleColor: driverData.vehicleColor,
      vehicleCapacity: driverData.vehicleSeatingCapacity,
      preferredRoute: driverData.preferredRoute,
      online: false,
      status: "offline",
      availableSeats: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const getUserProfile = async (userId: string) => {
  const profileDoc = await getDoc(doc(db, "users", userId));
  return profileDoc.exists() ? profileDoc.data() : null;
};

export const getUserRole = async (user: User): Promise<UserRole | null> => {
  const profileDoc = await getDoc(doc(db, "users", user.uid));

  if (profileDoc.exists()) {
    const role = profileDoc.data().role;

    if (role === "driver" || role === "passenger" || role === "admin") {
      return role as UserRole;
    }
  }

  return null;
};

// Register with email and password
export const registerUser = async (
  email: string,
  password: string,
  profileData: UserProfileData
) => {
  const userCredential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

  await createUserProfile(userCredential.user, profileData);

  return userCredential.user;
};

// Login with email and password
export const loginUser = async (
  email: string,
  password: string
) => {
  const userCredential = await signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  return userCredential.user;
};

// Login with Google (for existing users or new users)
export const loginWithGoogle = async (
  idToken: string,
  accessToken?: string
) => {
  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  const userCredential = await signInWithCredential(auth, credential);
  return userCredential.user;
};

// Register with Google (creates profile with minimal info)
export const registerWithGoogle = async (
  idToken: string,
  accessToken: string | undefined,
  profileData: GoogleUserProfileData
) => {
  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  const userCredential = await signInWithCredential(auth, credential);
  const user = userCredential.user;

  // Only create/update profile if role is provided
  if (profileData.role) {
    const userData: Record<string, unknown> = {
      uid: user.uid,
      name: profileData.fullName || user.displayName || "User",
      email: profileData.email || user.email || "",
      role: profileData.role,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (profileData.phoneNumber) {
      userData.phone = profileData.phoneNumber;
    }

    if (user.photoURL) {
      userData.photoURL = user.photoURL;
    }

    await setDoc(doc(db, "users", user.uid), userData, { merge: true });
  }

  return user;
};

// Update user profile with role
export const updateUserProfile = async (
  userId: string,
  updates: Partial<GoogleUserProfileData>
) => {
  const existingDoc = await getDoc(doc(db, "users", userId));
  const existing = existingDoc.exists() ? existingDoc.data() : {};

  // If the existing document is incomplete (missing essential fields),
  // fill them in from Firebase Auth so we never end up with a broken doc.
  const currentUser = auth.currentUser;
  const baseData: Record<string, unknown> = {};

  if (!existing.uid && currentUser) {
    baseData.uid = currentUser.uid;
  }
  if (!existing.name && currentUser) {
    baseData.name = currentUser.displayName || "User";
  }
  if (!existing.email && currentUser) {
    baseData.email = currentUser.email || "";
  }
  if (!existing.createdAt) {
    baseData.createdAt = serverTimestamp();
  }

  const updateData: Record<string, unknown> = {
    ...baseData,
    ...updates,
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "users", userId), updateData, { merge: true });
};

// Complete driver profile
export const completeDriverProfile = async (
  userId: string,
  driverData: DriverProfileData
) => {
  await createDriverProfile(userId, driverData);
  await updateUserProfile(userId, { role: "driver" });
};

// Send password reset email
export const resetPassword = async (email: string) => {
  await sendPasswordResetEmail(auth, email);
};

// Logout
export const logoutUser = async () => {
  await signOut(auth);
};