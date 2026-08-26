import { initializeApp } from "firebase/app";
import { getAuth, initializeAuth, type Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

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

// ---------------------------------------------------------------------------
// Auth persistence — wraps AsyncStorage to keep the user logged in across
// app restarts. The Firebase JS SDK does not include a built-in React Native
// persistence adapter, so we provide a thin one backed by AsyncStorage.
// ---------------------------------------------------------------------------

const reactNativePersistence = {
  type: "LOCAL" as const,
  async get(key: string) {
    try {
      const value = await AsyncStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  },
  async set(key: string, value: object) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage failure — auth still works in memory this session
    }
  },
  async remove(key: string) {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Best-effort
    }
  },
};

let auth: Auth;
try {
  auth = initializeAuth(app, { persistence: reactNativePersistence as any });
} catch {
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);
export const storage = getStorage(app);