import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  User,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

import { auth, db } from "./firebase";

export type UserRole = "passenger" | "driver";

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

const createUserProfile = async (user: User, profileData: UserProfileData) => {
  await setDoc(
    doc(db, "users", user.uid),
    {
      ...profileData,
      createdAt: new Date().toISOString(),
    },
    { merge: true }
  );
};

export const getUserRole = async (user: User): Promise<UserRole> => {
  const profileDoc = await getDoc(doc(db, "users", user.uid));

  if (profileDoc.exists()) {
    const role = profileDoc.data().role;

    if (role === "driver") {
      return "driver";
    }
  }

  return "passenger";
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

// Google Login
export const loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider();

  const result = await signInWithPopup(
    auth,
    provider
  );

  return result.user;
};

// Logout
export const logoutUser = async () => {
  await signOut(auth);
};