/**
 * Round half away from zero to `dp` decimals — the same rule as Postgres
 * `round(numeric, int)`, so TS previews match DB-computed values exactly.
 * Uses exponent notation to avoid binary artefacts (1.005 → 1.01, not 1).
 */
export function roundHalfAway(value: number, dp: number): number {
  if (!Number.isFinite(value)) return value;
  const sign = value < 0 ? -1 : 1;
  const shifted = Math.round(Number(`${Math.abs(value)}e${dp}`));
  const result = sign * Number(`${shifted}e-${dp}`);
  return Object.is(result, -0) ? 0 : result;
}
