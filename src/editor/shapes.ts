import type { PathNode, Shape, Vec } from '../types';

export function translateShape(shape: Shape, dx: number, dy: number): Shape {
  if (shape.kind === 'pen') {
    return { ...shape, nodes: shape.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })) };
  }
  return { ...shape, points: shape.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
}

export function updateNode(nodes: PathNode[], index: number, fn: (n: PathNode) => PathNode) {
  return nodes.map((n, i) => (i === index ? fn(n) : n));
}

const len = (v: Vec) => Math.hypot(v.x, v.y);

/** Whether the node's two handles point in opposite directions (i.e. a smooth point). */
export function isSmooth(n: PathNode) {
  if (!n.in || !n.out) return false;
  const a = len(n.in);
  const b = len(n.out);
  if (a < 1e-6 || b < 1e-6) return false;
  const cross = (n.in.x * n.out.y - n.in.y * n.out.x) / (a * b);
  const dot = (n.in.x * n.out.x + n.in.y * n.out.y) / (a * b);
  return Math.abs(cross) < 0.02 && dot < 0;
}

/** Sets one handle; on smooth nodes the opposite handle keeps its length but mirrors the angle. */
export function setHandle(n: PathNode, which: 'in' | 'out', v: Vec, breakSymmetry: boolean): PathNode {
  const other = which === 'in' ? 'out' : 'in';
  const next: PathNode = { ...n, [which]: v };
  const o = n[other];
  if (!breakSymmetry && o && isSmooth(n)) {
    const l = len(v);
    if (l > 1e-6) {
      const ol = len(o);
      next[other] = { x: (-v.x / l) * ol, y: (-v.y / l) * ol };
    }
  }
  return next;
}

/** Double-click on a node: corner ⇄ smooth. */
export function toggleNodeSmooth(nodes: PathNode[], index: number): PathNode[] {
  const n = nodes[index];
  if (n.in || n.out) return updateNode(nodes, index, (m) => ({ ...m, in: null, out: null }));
  const prev = nodes[(index - 1 + nodes.length) % nodes.length];
  const next = nodes[(index + 1) % nodes.length];
  let dx = next.x - prev.x;
  let dy = next.y - prev.y;
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  const lenIn = Math.hypot(n.x - prev.x, n.y - prev.y) / 3;
  const lenOut = Math.hypot(next.x - n.x, next.y - n.y) / 3;
  return updateNode(nodes, index, (m) => ({
    ...m,
    in: { x: -dx * lenIn, y: -dy * lenIn },
    out: { x: dx * lenOut, y: dy * lenOut },
  }));
}
