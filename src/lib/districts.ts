/**
 * Legislative district codes reach us in several shapes: the voter file stores
 * zero-padded values like "032", the region picker stores "32", and hand-typed
 * campaign fields can read "LD 32". Comparisons must normalize both sides.
 */

/** Voter-file key for a legislative district, or null when there is no number. */
export function legislativeDistrictKey(
  value: string | null | undefined,
): string | null {
  const digits = (value ?? "").match(/\d{1,3}/);
  if (!digits) return null;
  return digits[0].replace(/^0+/, "") || null;
}
