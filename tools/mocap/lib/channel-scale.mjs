// Put a non-angle channel (weight ∈ [−1,1], depth ∈ [−1,1]) on the angle
// channels' scale before it enters a distance next to them (17.6 addendum):
// factor = median spread of the angle channels / the channel's own spread,
// so one typical angle swing and one typical weight swing count the same.
// Used by the stitch seam search and the extractor's parity guard.

const std = (xs) => {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};

/**
 * @param angleSeries  arrays of angle samples (rad), one per channel
 * @param series       samples of the channel to normalize
 * @returns multiplier for `series`; 0 when the channel does not move (it
 *          then carries no evidence and must not dominate a distance)
 */
export function scaleToAngles(angleSeries, series) {
  const sd = std(series.filter((v) => v != null && Number.isFinite(v)));
  if (sd < 1e-3) return 0;
  const a = angleSeries.map((s) => std(s)).filter((v) => v > 1e-3).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[a.length >> 1] / sd;
}
