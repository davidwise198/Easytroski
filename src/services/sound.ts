import { Audio } from "expo-av";

// ---------------------------------------------------------------------------
// Local booking sounds for EasyTroski
//
// Plays short tones via expo-av for key booking events. No asset files are
// required — tones are synthesized as tiny base64-encoded WAV files so the
// app works even in Expo Go and without any bundled MP3s.
//
// Sounds are best-effort: if audio is unavailable (e.g. device muted, Expo Go
// quirks) the app must still show toasts/banners — sound is additive, never
// the only signal.
// ---------------------------------------------------------------------------

/** Small inline WAV (mono, 8kHz, 16-bit) containing a short beep at `freq`. */
function beepWav(freq: number, durationSec: number): string {
  const sampleRate = 8000;
  const numSamples = Math.round(sampleRate * durationSec);
  const bytesPerSample = 2;
  const byteRate = sampleRate * bytesPerSample;
  const dataSize = numSamples * bytesPerSample;
  const bufferSize = 44 + dataSize;
  const buf = new Uint8Array(bufferSize);

  const writeU16 = (offset: number, v: number) => {
    buf[offset] = v & 0xff;
    buf[offset + 1] = (v >> 8) & 0xff;
  };
  const writeU32 = (offset: number, v: number) => {
    buf[offset] = v & 0xff;
    buf[offset + 1] = (v >> 8) & 0xff;
    buf[offset + 2] = (v >> 16) & 0xff;
    buf[offset + 3] = (v >> 24) & 0xff;
  };

  // RIFF header
  buf.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  writeU32(4, bufferSize - 8);
  buf.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"

  // fmt chunk
  buf.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  writeU32(16, 16); // chunk size
  writeU16(20, 1); // PCM
  writeU16(22, 1); // mono
  writeU32(24, sampleRate);
  writeU32(28, byteRate);
  writeU16(32, bytesPerSample);
  writeU16(34, 16); // bits per sample

  // data chunk
  buf.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  writeU32(40, dataSize);

  for (let i = 0; i < numSamples; i++) {
    const t = (i / sampleRate) * freq * 2 * Math.PI;
    // short fade in/out to avoid clicks
    const envelope = Math.min(1, (i / 40), (numSamples - i) / 40);
    const sample = Math.round(32767 * 0.3 * envelope * Math.sin(t));
    const off = 44 + i * 2;
    writeU16(off, Math.max(-32768, Math.min(32767, sample)));
  }

  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  const base64 = btoa(binary);
  return `data:audio/wav;base64,${base64}`;
}

// Prebuilt tone definitions — short distinct sounds for each event.
const WAV_BEEP220_300MS = beepWav(220, 0.3);
const WAV_BEEP440_200MS = beepWav(440, 0.2);
const WAV_BEEP880_150MS = beepWav(880, 0.15);
const WAV_BEEP660_250MS = beepWav(660, 0.25);

// Cached sound objects so we don't re-parse the blob each time.
let soundConfirmed: Audio.Sound | null = null;
let soundDeclined: Audio.Sound | null = null;
let soundNewBooking: Audio.Sound | null = null;
let soundTripEnded: Audio.Sound | null = null;

async function ensureSound(
  target: Audio.Sound | null,
  wavUri: string,
  factory: () => Promise<Audio.Sound>
): Promise<Audio.Sound> {
  if (target) return target;
  try {
    const s = await factory();
    return s;
  } catch {
    // Creating the sound failed — return a dummy and let playback fail silently.
    return target as unknown as Audio.Sound;
  }
}

async function loadSound(wavUri: string): Promise<Audio.Sound> {
  const { sound, status } = await Audio.Sound.createAsync(
    { uri: wavUri },
    { shouldPlay: false, volume: 1 }
  );
  // status is AVPlaybackStatus (union of error/success).
  // AVPlaybackStatusSuccess has isLoaded: true; AVPlaybackStatusError has isLoaded: false.
  if (!status.isLoaded) {
    throw new Error(`Sound failed to load`);
  }
  return sound;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type BookingSound =
  | "confirmed"
  | "declined"
  | "newBooking"
  | "tripEnded";

/**
 * Play a short sound for a booking event.
 * Best-effort — never throws; failures are logged.
 */
export async function playBookingSound(type: BookingSound): Promise<void> {
  try {
    const { setAudioModeAsync } = Audio;
    await setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});

    let sound: Audio.Sound | null = null;
    let wav: string;

    switch (type) {
      case "confirmed":
        wav = WAV_BEEP880_150MS;
        sound = await ensureSound(soundConfirmed, wav, () => loadSound(wav));
        break;
      case "declined":
        wav = WAV_BEEP220_300MS;
        sound = await ensureSound(soundDeclined, wav, () => loadSound(wav));
        break;
      case "newBooking":
        wav = WAV_BEEP660_250MS;
        sound = await ensureSound(soundNewBooking, wav, () => loadSound(wav));
        break;
      case "tripEnded":
        wav = WAV_BEEP440_200MS;
        sound = await ensureSound(soundTripEnded, wav, () => loadSound(wav));
        break;
    }

    if (sound) {
      await sound.replayAsync().catch(() => {
        // If replay fails, try loading and playing once more (first time use).
        loadSound(wav).then((s) => {
          s.playAsync().catch(() => {});
          // Keep the new sound for next time.
          if (type === "confirmed") soundConfirmed = s;
          else if (type === "declined") soundDeclined = s;
          else if (type === "newBooking") soundNewBooking = s;
          else if (type === "tripEnded") soundTripEnded = s;
        }).catch(() => {});
      });
    }
  } catch (err) {
    // Best-effort only — audio failures should never break the app.
    console.warn("Booking sound failed to play:", err);
  }
}

/** Clean up any loaded sounds on app exit / logout. */
export async function unloadBookingSounds(): Promise<void> {
  const all = [soundConfirmed, soundDeclined, soundNewBooking, soundTripEnded];
  for (const s of all) {
    if (s) {
      try {
        await s.unloadAsync();
      } catch {
        // ignore cleanup errors
      }
    }
  }
  soundConfirmed = null;
  soundDeclined = null;
  soundNewBooking = null;
  soundTripEnded = null;
}
