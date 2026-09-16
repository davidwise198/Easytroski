// ---------------------------------------------------------------------------
// Email validation — three layers:
//   1. Format check (practical RFC-ish regex).
//   2. Disposable-domain blocklist (offline, instant).
//   3. Domain deliverability probe — MX/A lookup via Google DNS-over-HTTPS,
//      so "someone@asdfkjhsd.com" is rejected before an account is created.
// The probe is cached for 24h per domain and fails OPEN: if the network
// lookup can't run, we accept the email rather than block a real user.
// The hard gate for dummy addresses is still Firebase's own verification
// email — a fake mailbox can never receive it, so it can never pass AuthGate.
// ---------------------------------------------------------------------------

import AsyncStorage from "@react-native-async-storage/async-storage";

const CACHE_KEY = "email-domain-check-cache-v1";
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

type DomainCache = Record<string, { ok: boolean; at: number }>;

let cachePromise: Promise<DomainCache> | null = null;

const loadCache = (): Promise<DomainCache> => {
  if (!cachePromise) {
    cachePromise = AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => (raw ? (JSON.parse(raw) as DomainCache) : {}))
      .catch(() => ({} as DomainCache));
  }
  return cachePromise;
};

const saveCache = async (cache: DomainCache) => {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Cache is best-effort — never surface storage failures.
  }
};

// Domains that exist only for throwaway sign-ups — instant offline block.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "sharklasers.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "fakeinbox.com",
  "throwawaymail.com",
  "mailnesia.com",
  "tempinbox.com",
  "emailondeck.com",
  "mohmal.com",
  "spam4.me",
  "grr.la",
  "bccto.me",
  "chacuo.net",
  "harakirimail.com",
  "tempmailo.com",
  "burnermail.io",
  "33mail.com",
  "altmails.com",
  "droppmail.com",
  "droppmail.io",
  "test.com",
  "test.org",
  "example.com",
  "example.org",
  "example.net",
  // throwaway identity generators commonly used for fake accounts
  "armyspy.com",
  "cuvox.de",
  "dayrep.com",
  "einrot.com",
  "fleckens.hu",
  "gustr.com",
  "jourrapide.com",
  "rhyta.com",
  "superrito.com",
  "teleworm.us",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface EmailCheckResult {
  valid: boolean;
  reason?: "format" | "disposable" | "undeliverable";
}

/**
 * Synchronous format check — used for button gating.
 * The full async `validateEmail` is the real gate at submit time.
 */
export const isEmailFormatValid = (email: string) =>
  EMAIL_RE.test(email.trim().toLowerCase());

/**
 * Full validation: format → disposable blocklist → domain deliverability
 * probe (24h cache per domain). Network failures fail open so real users
 * are never blocked by an outage.
 */
export async function validateEmail(email: string): Promise<EmailCheckResult> {
  const value = email.trim().toLowerCase();

  if (!EMAIL_RE.test(value) || value.length > 254) {
    return { valid: false, reason: "format" };
  }

  const domain = value.split("@")[1];

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, reason: "disposable" };
  }

  // Cached verdict for this domain?
  const cache = await loadCache();
  const hit = cache[domain];
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return hit.ok ? { valid: true } : { valid: false, reason: "undeliverable" };
  }

  try {
    const ok = await domainCanReceiveMail(domain);
    cache[domain] = { ok, at: Date.now() };
    void saveCache(cache);
    return ok ? { valid: true } : { valid: false, reason: "undeliverable" };
  } catch {
    // Lookup unreachable — accept. Never block a real user on a failed check.
    return { valid: true };
  }
}

/**
 * Does this domain have mail servers? Checks MX first (the proper answer),
 * then falls back to an A record — RFC 5321 says a domain with no MX but an
 * address record still accepts mail for the host itself.
 */
async function domainCanReceiveMail(domain: string): Promise<boolean> {
  const lookup = async (type: "MX" | "A") => {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`
    );
    const data = (await res.json()) as { Answer?: unknown[]; Status?: number };
    return Array.isArray(data.Answer) && data.Answer.length > 0;
  };

  if (await lookup("MX")) return true;
  return lookup("A");
}
