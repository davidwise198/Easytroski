// ---------------------------------------------------------------------------
// Public identifiers: Driver ID and Mate ID
//
//   ET-DV-48291   driver
//   ET-MT-18432   mate
//
// These are meant to be read aloud in a crowded tro-tro, so they are short,
// uppercase, free of ambiguous characters and carry no personal information.
//
// They are NOT credentials. A code only lets somebody REQUEST a connection,
// which the driver must approve — so a leaked code costs nothing. The real
// guard against two people holding the same number is `idCodes/{code}`: the
// document is created with a create-only write, so a collision fails the write
// and the caller simply draws another number.
// ---------------------------------------------------------------------------

export type IdKind = "driver" | "mate";

const PREFIX: Record<IdKind, string> = { driver: "ET-DV", mate: "ET-MT" };

/** Digits only: they survive being read out over a noisy engine. */
const MIN_CODE = 10_000;
const CODE_SPAN = 90_000;

/** Which profile field a code is stored in. */
export function codeField(kind: IdKind): "driverCode" | "mateCode" {
  return kind === "driver" ? "driverCode" : "mateCode";
}

/**
 * Draw a fresh code. `random` is injectable so the format can be tested
 * without touching the ledger.
 */
export function generateCode(kind: IdKind, random: () => number = Math.random): string {
  const value = MIN_CODE + Math.floor(random() * CODE_SPAN);
  return `${PREFIX[kind]}-${String(value).padStart(5, "0")}`;
}

/**
 * Accept whatever the mate typed and return the canonical code, or null.
 *
 * Forgiving on purpose: spaces, lowercase, missing dashes and a missing prefix
 * are all common when someone is copying from a screenshot or a WhatsApp
 * message, and none of them indicate a different driver.
 */
export function normaliseCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/^ET(?:DV|MT)(\d{5})$/);
  if (match) {
    const kind: IdKind = compact.startsWith("ETDV") ? "driver" : "mate";
    return `${PREFIX[kind]}-${match[1]}`;
  }
  // A bare 5-digit number is ambiguous between kinds, so it is rejected rather
  // than guessed at.
  return null;
}

/** Canonical kind of an already-normalised code. */
export function codeKind(code: string): IdKind | null {
  if (code.startsWith("ET-DV-")) return "driver";
  if (code.startsWith("ET-MT-")) return "mate";
  return null;
}

/** Human-facing label, used in toasts and audit records. */
export function codeLabel(kind: IdKind): string {
  return kind === "driver" ? "Driver ID" : "Mate ID";
}
