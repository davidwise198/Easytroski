// ---------------------------------------------------------------------------
// Formatting helpers (server, used in notification copy)
// ---------------------------------------------------------------------------

/** 2050 → "GH₵20.50", 1000 → "GH₵10". */
export function formatPesewas(pesewas: number | null | undefined): string {
  const value = Number.isFinite(pesewas as number) ? (pesewas as number) : 0;
  const cedis = value / 100;
  const isWhole = Math.abs(cedis % 1) < 0.005;
  return `GH₵${isWhole ? cedis.toFixed(0) : cedis.toFixed(2)}`;
}
