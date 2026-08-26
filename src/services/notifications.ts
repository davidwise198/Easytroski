import { doc, setDoc, getDoc } from "firebase/firestore";

import { db } from "./firebase";

// ---------------------------------------------------------------------------
// Push notifications for EasyTroski
//
// NOTE: expo-notifications is not used in this file because it crashes in
// Expo Go SDK 53+. Push token registration and local display are handled
// by a development build (eas build). This file only handles:
//   1. Saving push tokens to Firestore (from a dev build)
//   2. Sending push notifications via Expo's HTTP push API (works anywhere)
//
// When you build a dev build with `eas build --platform android`, you can
// re-add expo-notifications for token registration and local display.
// ---------------------------------------------------------------------------

/**
 * Save the push token to the user's Firestore document so we can send them
 * notifications later.
 */
export async function savePushToken(userId: string, token: string) {
  try {
    await setDoc(
      doc(db, "users", userId),
      { pushToken: token, pushTokenUpdatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (error) {
    console.error("Failed to save push token:", error);
  }
}

/**
 * Get a user's push token from Firestore.
 */
export async function getUserPushToken(userId: string): Promise<string | null> {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (userDoc.exists()) {
      return userDoc.data().pushToken || null;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sending notifications via Expo push API (pure HTTP — no native module)
// ---------------------------------------------------------------------------

/**
 * Send a push notification to a single Expo push token.
 */
async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: expoPushToken,
        title,
        body,
        data: data || {},
        sound: "default",
        priority: "high",
      }),
    });
  } catch (error) {
    console.error("Failed to send push notification:", error);
  }
}

/**
 * Send a push notification to a user by their Firestore user ID.
 * Looks up their push token and sends it.
 */
export async function notifyUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  const token = await getUserPushToken(userId);
  if (token) {
    await sendPushNotification(token, title, body, data);
  }
}

// ---------------------------------------------------------------------------
// Convenience: pre-built notifications for EasyTroski events
// ---------------------------------------------------------------------------

/** Notify the driver when a passenger books. */
export async function notifyDriverOfBooking(
  driverId: string,
  passengerName: string,
  routeLabel: string
) {
  await notifyUser(
    driverId,
    "New booking! 🚌",
    `${passengerName} just booked a seat on ${routeLabel}.`,
    { type: "new_booking" }
  );
}

/** Notify the passenger when the driver confirms. */
export async function notifyPassengerOfConfirmation(
  passengerId: string,
  routeLabel: string
) {
  await notifyUser(
    passengerId,
    "Booking confirmed ✅",
    `Your seat on ${routeLabel} has been confirmed.`,
    { type: "booking_confirmed" }
  );
}

/** Notify the passenger when the driver rejects. */
export async function notifyPassengerOfRejection(
  passengerId: string,
  routeLabel: string
) {
  await notifyUser(
    passengerId,
    "Booking declined",
    `Your booking on ${routeLabel} was declined by the driver.`,
    { type: "booking_rejected" }
  );
}

/** Notify the passenger when the trip ends. */
export async function notifyPassengerTripEnded(
  passengerId: string,
  routeLabel: string
) {
  await notifyUser(
    passengerId,
    "Trip ended",
    `Your trip on ${routeLabel} has ended. Safe travels!`,
    { type: "trip_ended" }
  );
}
