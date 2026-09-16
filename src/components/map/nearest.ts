/** A point in map-container (screen) pixels. */
export type PixelPoint = { x: number; y: number };

/**
 * Index of the point closest to `tap`, or null when nothing is within `slopPx`.
 * Ties resolve to the earlier index so repeated taps stay on the same target.
 */
export function nearestIndexWithin(
  tap: PixelPoint,
  points: PixelPoint[],
  slopPx: number,
): number | null {
  let bestIndex: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - tap.x;
    const dy = points[i].y - tap.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex != null && bestDistance <= slopPx ? bestIndex : null;
}
