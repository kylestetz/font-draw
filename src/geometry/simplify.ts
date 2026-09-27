/** Freehand point processing: light smoothing followed by Ramer–Douglas–Peucker simplification. */

type Pt = [number, number];

function toPairs(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

function smooth(pts: Pt[], passes = 2): Pt[] {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    if (cur.length < 3) return cur;
    const next: Pt[] = [cur[0]];
    for (let i = 1; i < cur.length - 1; i++) {
      next.push([
        (cur[i - 1][0] + cur[i][0] * 2 + cur[i + 1][0]) / 4,
        (cur[i - 1][1] + cur[i][1] * 2 + cur[i + 1][1]) / 4,
      ]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

function perpDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
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
      const d = perpDist(pts[i], pts[s], pts[e]);
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

export function cleanStroke(flat: number[], tolerance = 1.2): number[] {
  const pts = rdp(smooth(toPairs(flat)), tolerance);
  return pts.flatMap(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
}
