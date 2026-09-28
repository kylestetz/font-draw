/**
 * Freehand point processing. Positions are kept exactly as drawn: the only change is dropping points
 * that sit (almost) on a straight line between their neighbours (Ramer–Douglas–Peucker). Smoothing
 * positions would pull corners inward, badly so for fast strokes whose samples are far apart.
 * Pressure, when present, is lightly smoothed (it's noisy) and treated as a third dimension so width
 * changes survive simplification.
 */

type Pt = [number, number, number];

function smoothPressure(values: number[]): number[] {
  if (values.length < 3) return values;
  return values.map((v, i) =>
    i === 0 || i === values.length - 1 ? v : (values[i - 1] + v * 2 + values[i + 1]) / 4,
  );
}

/** Distance from p to the segment a–b in 3D. */
function segDist(p: Pt, a: Pt, b: Pt) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  let t = len2 ? ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t, p[2] - a[2] - d[2] * t);
}

function rdp(pts: Pt[], tolerance: number): Pt[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Cleans a raw freehand stroke. `pressures` (one per point) are optional; `width` scales pressure
 * into font units so a width change is weighed like a positional one during simplification.
 * `tolerance` is the furthest (in font units) any point may end up from the drawn line.
 */
export function cleanStroke(
  flat: number[],
  pressures?: number[],
  width = 0,
  tolerance = 0.5,
): { points: number[]; pressures?: number[] } {
  const zScale = pressures ? width / 2 : 0;
  const pz = pressures ? smoothPressure(pressures) : null;
  const pts: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1], (pz?.[i / 2] ?? 0) * zScale]);
  const out = rdp(pts, tolerance);
  return {
    points: out.flatMap(([x, y]) => [r1(x), r1(y)]),
    pressures: pressures ? out.map(([, , z]) => r3(zScale ? z / zScale : 0)) : undefined,
  };
}
