// ---------------------------------------------------------------------------
// Install sessions — one account, one device
//
// Each signed-in device writes a session id into install-sessions/{uid}.
// The newest device to sign in overwrites the doc; every other device
// watching the doc sees the mismatch and force-signs itself out.
// ---------------------------------------------------------------------------

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "./firebase";

const SESSION_ID_KEY = "easytroski.installSessionId";
const HEARTBEAT_MS = 60_000;

let currentSessionId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/** Stable per-install session id, persisted in AsyncStorage. */
async function getOrCreateSessionId(): Promise<string> {
  if (currentSessionId) return currentSessionId;

  const stored = await AsyncStorage.getItem(SESSION_ID_KEY);
  if (stored) {
    currentSessionId = stored;
    return stored;
  }

  const fresh =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(SESSION_ID_KEY, fresh);
  currentSessionId = fresh;
  return fresh;
}

/**
 * Claim the account for this device. Overwrites install-sessions/{uid},
 * which kicks any previously signed-in device. Also subscribes this device
 * to the doc so a *future* sign-in elsewhere kicks *this* device.
 * Returns nothing; the kick handler is handled internally via `onForcedOut`.
 */
export function beginSession(
  uid: string,
  onForcedOut: () => void,
  logTag = "[session]"
): () => void {
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  // Prevents the kick handler from firing on our own first snapshot.
  let claimed = false;

  void (async () => {
    const sessionId = await getOrCreateSessionId();
    if (cancelled) return;

    try {
      await setDoc(
        doc(db, "install-sessions", uid),
        {
          sessionId,
          lastActiveAt: serverTimestamp(),
        },
        { merge: false }
      );
    } catch (error) {
      // Rules problem or offline — single-device enforcement is best-effort.
      console.warn(`${logTag} could not claim session:`, error);
      return;
    }

    if (cancelled) return;
    claimed = true;

    // Watch the doc: if it stops matching our sessionId, someone else signed in.
    unsubscribe = onSnapshot(
      doc(db, "install-sessions", uid),
      (snapshot) => {
        if (cancelled) return;
        if (!snapshot.exists()) return; // cleaned up on sign-out
        const remote = snapshot.data()?.sessionId;
        if (claimed && remote && remote !== sessionId) {
          console.warn(`${logTag} session taken over on another device — signing out`);
          if (heartbeat) clearInterval(heartbeat);
          onForcedOut();
        }
      },
      (error) => {
        // Permission errors here mean the rules deploy hasn't landed yet.
        console.warn(`${logTag} session listener error:`, error);
      }
    );

    // Heartbeat keeps lastActiveAt fresh for support/debugging.
    heartbeat = setInterval(() => {
      if (cancelled) return;
      setDoc(
        doc(db, "install-sessions", uid),
        { sessionId, lastActiveAt: serverTimestamp() },
        { merge: true }
      ).catch(() => {});
    }, HEARTBEAT_MS);
  })();

  return () => {
    cancelled = true;
    if (heartbeat) clearInterval(heartbeat);
    if (heartbeatTimer === heartbeat) heartbeatTimer = null;
    unsubscribe?.();
  };
}

/**
 * Deliberate sign-out cleanup. Skipped when `kicked` — a kicked device must
 * not delete the doc that the *new* device just wrote.
 */
export async function endSession(uid: string, kicked = false): Promise<void> {
  heartbeatTimer = null;
  if (kicked) return;
  try {
    await setDoc(
      doc(db, "install-sessions", uid),
      { sessionId: null, lastActiveAt: null },
      { merge: true }
    );
  } catch {
    // Best-effort
  }
}
