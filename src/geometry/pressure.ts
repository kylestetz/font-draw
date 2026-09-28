/** Fraction of the full brush width drawn at the lightest touch. */
const MIN_RATIO = 0.12;

/** Maps stylus pressure (0–1) to a multiplier of the brush's full width. */
export function pressureScale(pressure: number) {
  const p = Math.min(1, Math.max(0, pressure));
  // A gentle curve so normal handwriting pressure (≈0.3–0.6) lands mid-range.
  return MIN_RATIO + (1 - MIN_RATIO) * Math.pow(p, 0.8);
}
