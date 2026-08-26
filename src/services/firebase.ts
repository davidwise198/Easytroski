import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// ---------------------------------------------------------------------------
// Firebase configuration — loaded from environment variables.
//
// EXPO_PUBLIC_* variables are embedded in the client bundle at build time.
// This is the standard Expo pattern and is safe for client-side code since
// Firebase security rules enforce access control server-side.
// ---------------------------------------------------------------------------

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Validate that critical config values are present
const missingKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingKeys.length > 0 && __DEV__) {
  console.warn(
    `[Firebase] Missing environment variables: ${missingKeys.join(", ")}. ` +
      "Check your .env file."
  );
}

const app = initializeApp(firebaseConfig);

// Firebase Auth — getAuth() persists state automatically in SDK v12+
// on React Native when @react-native-async-storage is installed.
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);