// ---------------------------------------------------------------------------
// Money helpers
//
// Every amount in EasyTroski is stored as an INTEGER number of pesewas
// (1 GHS = 100 pesewas), which is exactly what Paystack expects. Floating point
// is never used for money: GHS 10.50 is 1050, never 10.5.
// ---------------------------------------------------------------------------

/** The only currency this app charges in. */
export const CURRENCY = "GHS" as const;

/** Commission EasyTroski keeps from each fare (10%). Backend is authoritative. */
export const DEFAULT_COMMISSION_RATE = 0.1;

/** Paystack's smallest unit per Ghana Cedi. */
export const PESEWAS_PER_CEDI = 100;

export function ghsToPesewas(cedis: number): number {
  return Math.round(cedis * PESEWAS_PER_CEDI);
}

export function pesewasToGhs(pesewas: number): number {
  return pesewas / PESEWAS_PER_CEDI;
}

/**
 * Format pesewas for display. Whole amounts drop the decimals so fares read as
 * "GH₵10" rather than "GH₵10.00", matching how trotro fares are spoken.
 */
export function formatPesewas(pesewas: number | null | undefined, opts?: { alwaysDecimals?: boolean }): string {
  const value = Number.isFinite(pesewas as number) ? (pesewas as number) : 0;
  const cedis = value / PESEWAS_PER_CEDI;
  const isWhole = Math.abs(cedis % 1) < 0.005;
  const text = isWhole && !opts?.alwaysDecimals
    ? cedis.toFixed(0)
    : cedis.toFixed(2);
  return `GH₵${text.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Split a gross amount into the platform commission and the driver's net. */
export function splitCommission(grossPesewas: number, rate: number = DEFAULT_COMMISSION_RATE) {
  const commissionPesewas = Math.round(grossPesewas * rate);
  return {
    grossPesewas,
    commissionPesewas,
    netPesewas: grossPesewas - commissionPesewas,
  };
}

/**
 * Normalise a Ghana mobile money number to the 0-prefixed local format Paystack
 * expects (024XXXXXXX). Accepts +233244000000, 233244000000 and 0244000000.
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

  // Ghana mobile prefixes are 02x, 03x, 05x.
  return /^0[235]\d{8}$/.test(local) ? local : null;
}
