/**
 * Turns a glyph's shape stack into clean outlines.
 *
 * Every shape becomes a filled region: pen paths directly (keeping their Béziers), brush strokes by
 * expanding the centerline with Clipper and fitting curves to the result. Regions are then combined in
 * order with boolean ops — 'add' unites, 'cut' subtracts — so what the editor shows is exactly what
 * ends up in the font file.
 */
import paper from 'paper/dist/paper-core';
import ClipperLib from 'clipper-lib';
import type { BrushShape, PathNode, PenShape, Shape } from '../types';

const scope = new paper.PaperScope();
scope.setup(new scope.Size(1, 1));

/** A contour segment: anchor plus handle offsets relative to it. */
export type Seg = { x: number; y: number; ix: number; iy: number; ox: number; oy: number };
export type Contour = Seg[];
export type Bounds = { x: number; y: number; width: number; height: number };
export type Outline = { contours: Contour[]; bounds: Bounds | null };

const CLIPPER_SCALE = 16;
const ARC_TOLERANCE = 0.2;
const FIT_TOLERANCE = 0.8;

function penItem(shape: PenShape): paper.PathItem | null {
  if (shape.nodes.length < 2) return null;
  return new scope.Path({
    segments: shape.nodes.map(
      (n) =>
        new scope.Segment(
          new scope.Point(n.x, n.y),
          n.in ? new scope.Point(n.in.x, n.in.y) : undefined,
          n.out ? new scope.Point(n.out.x, n.out.y) : undefined,
        ),
    ),
    closed: true,
    insert: false,
  });
}

function brushItem(shape: BrushShape): paper.PathItem | null {
  const { points, width } = shape;
  if (points.length < 2 || width <= 0) return null;
  const src = [];
  for (let i = 0; i < points.length; i += 2) {
    src.push({ X: Math.round(points[i] * CLIPPER_SCALE), Y: Math.round(points[i + 1] * CLIPPER_SCALE) });
  }
  const offset = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE * CLIPPER_SCALE);
  offset.AddPath(src, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound);
  const solution: { X: number; Y: number }[][] = [];
  offset.Execute(solution, (width / 2) * CLIPPER_SCALE);
  const children = solution
    .filter((poly) => poly.length >= 3)
    .map((poly) => {
      const path = new scope.Path({
        segments: poly.map((p) => [p.X / CLIPPER_SCALE, p.Y / CLIPPER_SCALE]),
        closed: true,
        insert: false,
      });
      path.simplify(FIT_TOLERANCE);
      return path;
    });
  if (!children.length) return null;
  if (children.length === 1) return children[0];
  return new scope.CompoundPath({ children, insert: false });
}

const itemCache = new WeakMap<Shape, paper.PathItem | null>();
function shapeItem(shape: Shape) {
  if (!itemCache.has(shape)) {
    itemCache.set(shape, shape.kind === 'pen' ? penItem(shape) : brushItem(shape));
  }
  return itemCache.get(shape)!;
}

function toContours(item: paper.PathItem): Contour[] {
  const paths = item instanceof scope.CompoundPath ? (item.children as paper.Path[]) : [item as paper.Path];
  const out: Contour[] = [];
  for (const path of paths) {
    if (path.segments.length < 2 || Math.abs(path.area) < 0.5) continue;
    out.push(
      path.segments.map((s) => ({
        x: s.point.x,
        y: s.point.y,
        ix: s.handleIn.x,
        iy: s.handleIn.y,
        ox: s.handleOut.x,
        oy: s.handleOut.y,
      })),
    );
  }
  return out;
}

const EMPTY: Outline = { contours: [], bounds: null };
const outlineCache = new WeakMap<Shape[], Outline>();

export function glyphOutline(shapes: Shape[]): Outline {
  if (!shapes.length) return EMPTY;
  const cached = outlineCache.get(shapes);
  if (cached) return cached;

  let result: paper.PathItem | null = null;
  let combined = false;
  for (const shape of shapes) {
    const item = shapeItem(shape);
    if (!item) continue;
    try {
      if (shape.op === 'add') {
        if (result) {
          result = result.unite(item, { insert: false });
          combined = true;
        } else {
          result = item;
        }
      } else if (result) {
        result = result.subtract(item, { insert: false });
        combined = true;
      }
    } catch (err) {
      console.warn('Boolean operation failed; skipping shape', err);
    }
  }

  let outline = EMPTY;
  if (result) {
    if (!combined) {
      // A lone shape never went through a boolean op: resolve self-intersections and orient it the
      // same way boolean results are (outer contours counter-clockwise in y-up font space).
      const any = result.clone({ insert: false }) as unknown as {
        resolveCrossings(): paper.PathItem;
      };
      try {
        result = (any.resolveCrossings() as unknown as { reorient(n: boolean, c: boolean): paper.PathItem }).reorient(
          true,
          true,
        );
      } catch {
        // keep as is
      }
    }
    const b = result.bounds;
    const contours = toContours(result);
    outline = {
      contours,
      bounds: contours.length ? { x: b.x, y: b.y, width: b.width, height: b.height } : null,
    };
  }
  outlineCache.set(shapes, outline);
  return outline;
}

type Sink = {
  move(x: number, y: number): void;
  line(x: number, y: number): void;
  curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  close(): void;
};

export function walkContours(contours: Contour[], sink: Sink) {
  for (const c of contours) {
    sink.move(c[0].x, c[0].y);
    for (let i = 0; i < c.length; i++) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      if (a.ox === 0 && a.oy === 0 && b.ix === 0 && b.iy === 0) {
        if (i < c.length - 1) sink.line(b.x, b.y);
      } else {
        sink.curve(a.x + a.ox, a.y + a.oy, b.x + b.ix, b.y + b.iy, b.x, b.y);
      }
    }
    sink.close();
  }
}

const r = (n: number) => Math.round(n * 100) / 100;

export function contoursToSvg(contours: Contour[]): string {
  let d = '';
  walkContours(contours, {
    move: (x, y) => (d += `M${r(x)} ${r(y)}`),
    line: (x, y) => (d += `L${r(x)} ${r(y)}`),
    curve: (x1, y1, x2, y2, x, y) => (d += `C${r(x1)} ${r(y1)} ${r(x2)} ${r(y2)} ${r(x)} ${r(y)}`),
    close: () => (d += 'Z'),
  });
  return d;
}

const svgCache = new WeakMap<Shape[], string>();
export function glyphSvgPath(shapes: Shape[]): string {
  let d = svgCache.get(shapes);
  if (d === undefined) {
    d = contoursToSvg(glyphOutline(shapes).contours);
    svgCache.set(shapes, d);
  }
  return d;
}

/** SVG path for a pen path in progress or being edited (font units, y-up). */
export function penPathSvg(nodes: PathNode[], closed: boolean): string {
  if (!nodes.length) return '';
  let d = `M${r(nodes[0].x)} ${r(nodes[0].y)}`;
  const count = closed ? nodes.length : nodes.length - 1;
  for (let i = 0; i < count; i++) {
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    if (!a.out && !b.in) d += `L${r(b.x)} ${r(b.y)}`;
    else {
      const c1 = a.out ? { x: a.x + a.out.x, y: a.y + a.out.y } : a;
      const c2 = b.in ? { x: b.x + b.in.x, y: b.y + b.in.y } : b;
      d += `C${r(c1.x)} ${r(c1.y)} ${r(c2.x)} ${r(c2.y)} ${r(b.x)} ${r(b.y)}`;
    }
  }
  if (closed) d += 'Z';
  return d;
}

/** Centerline of a brush stroke as an SVG polyline path. */
export function brushCenterSvg(points: number[]): string {
  if (points.length < 2) return '';
  let d = `M${r(points[0])} ${r(points[1])}`;
  if (points.length === 2) d += `L${r(points[0]) + 0.01} ${r(points[1])}`;
  for (let i = 2; i < points.length; i += 2) d += `L${r(points[i])} ${r(points[i + 1])}`;
  return d;
}
