import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  User,
} from "firebase/auth";

import { auth } from "./firebase";


// Register with email and password
export const registerUser = async (
  email: string,
  password: string
) => {
  const userCredential = await createUserWithEmailAndPassword(
    auth,
    email,
    password
  );

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