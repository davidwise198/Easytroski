// ---------------------------------------------------------------------------
// Money math (server)
//
// All amounts are integer pesewas. Rounding always favours the driver's net
// being exactly gross - commission so the ledger always balances.
// ---------------------------------------------------------------------------

import { COMMISSION_RATE } from "./env.ts";

export const PESEWAS_PER_CEDI = 100;
export const CURRENCY = "GHS";

export type Split = {
  grossPesewas: number;
  commissionPesewas: number;
  netPesewas: number;
  currency: string;
};

/** Split a gross fare into EasyTroski's commission and the driver's net. */
export function splitFare(grossPesewas: number, rate: number = COMMISSION_RATE): Split {
  const gross = Math.max(0, Math.round(grossPesewas));
  const commissionPesewas = Math.round(gross * rate);
  return {
    grossPesewas: gross,
    commissionPesewas,
    netPesewas: gross - commissionPesewas,
    currency: CURRENCY,
  };
}

/** Fare per seat × seats, computed from trusted route data only. */
export function computeTotal(farePerSeatPesewas: number, seats: number): number {
  return Math.max(0, Math.round(farePerSeatPesewas)) * Math.max(1, Math.round(seats));
}

/**
 * Normalise a Ghana mobile money number to the 0-prefixed local format
 * Paystack expects (024XXXXXXX). Returns null when the number can't be a
 * Ghana mobile number.
 */
export function normaliseGhanaPhone(raw: string): string | null {
  const digits = (raw || "").replace(/[^\d]/g, "");
  if (!digits) return null;

  let local: string;
  if (digits.startsWith("233") && digits.length === 12) {
    local = `0${digits.slice(3)}`;
  } else if (digits.startsWith("0") && digits.length === 10) {
    local = digits;
  } else if (digits.length === 9) {
    local = `0${digits}`;
  } else {
    return null;
  }

  return /^0[235]\d{8}$/.test(local) ? local : null;
}

/** Paystack accepts only these provider codes for Ghana mobile money. */
export const MOMO_PROVIDERS = ["mtn", "vod", "atl"] as const;
export type MomoProvider = (typeof MOMO_PROVIDERS)[number];

export function isMomoProvider(value: unknown): value is MomoProvider {
  return typeof value === "string" && (MOMO_PROVIDERS as readonly string[]).includes(value);
}

/** Human label used in notifications and audit entries. */
export function momoProviderLabel(provider: string): string {
  switch (provider) {
    case "mtn":
      return "MTN Mobile Money";
    case "vod":
      return "Telecel Cash";
    case "atl":
      return "AirtelTigo Money";
    default:
      return "Mobile Money";
  }
}
