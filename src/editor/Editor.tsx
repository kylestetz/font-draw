import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BrushShape, Font, Glyph, PathNode, PenShape, Shape, Vec } from '../types';
import type { Prefs } from '../prefs';
import { brushCenterSvg, glyphSvgPath, penPathSvg } from '../geometry/outline';
import { cleanStroke } from '../geometry/simplify';
import { pressureScale } from '../geometry/pressure';
import { uid } from '../store';
import { setHandle, toggleNodeSmooth, translateShape, updateNode } from './shapes';

export type Selection = { shapeId: string; node: number | null } | null;
export type View = { s: number; ox: number; oy: number };

type Drag =
  | { type: 'pan'; sx: number; sy: number; view: View }
  | { type: 'brush' }
  | { type: 'pen-handle'; index: number }
  | { type: 'move-shape'; id: string; start: Vec; base: Glyph; moved: boolean }
  | { type: 'node'; id: string; index: number; start: Vec; base: Glyph }
  | { type: 'handle'; id: string; index: number; which: 'in' | 'out'; base: Glyph }
  | { type: 'advance'; base: Glyph };

export type EditorProps = {
  font: Font;
  char: string;
  glyph: Glyph;
  /** Another glyph to show faintly behind this one (the default when drawing an alternate). */
  guide?: Glyph;
  prefs: Prefs;
  selection: Selection;
  setSelection: (s: Selection) => void;
  penDraft: PathNode[] | null;
  setPenDraft: (nodes: PathNode[] | null) => void;
  finishPen: () => void;
  /** Update the glyph without recording history (mid-gesture). */
  apply: (g: Glyph) => void;
  /** Record the current glyph as an undo step, then update. */
  commit: (g: Glyph) => void;
  /** Record `base` as an undo step if the glyph changed since. */
  endGesture: (base: Glyph) => void;
  spaceHeld: boolean;
  view: View | null;
  setView: (v: View) => void;
  fitKey: number;
};

const GRID = 50;
const SNAP = 10;

export function Editor(props: EditorProps) {
  const { font, char, glyph, prefs, selection, setSelection, penDraft, setPenDraft, view, setView } = props;
  const { metrics } = font;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<Drag | null>(null);
  const strokeRef = useRef<number[]>([]);
  /** Per-point stylus pressure for the stroke in progress; null when pressure isn't in use. */
  const pressureRef = useRef<number[] | null>(null);
  const [liveStroke, setLiveStroke] = useState<{ points: number[]; pressures: number[] | null } | null>(null);
  const [hover, setHover] = useState<Vec | null>(null);
  const [panning, setPanning] = useState(false);

  // ---------- view ----------
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const advanceRef = useRef(glyph.advance);
  advanceRef.current = glyph.advance;
  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const advance = advanceRef.current;
    const top = metrics.ascender + 120;
    const bottom = metrics.descender - 120;
    const s = Math.min((size.h * 0.92) / (top - bottom), (size.w * 0.9) / (advance + 300));
    setView({ s, ox: size.w / 2 - (advance / 2) * s, oy: size.h / 2 + ((top + bottom) / 2) * s });
  }, [size.w, size.h, metrics.ascender, metrics.descender, setView]);

  // Refit when the glyph changes, the canvas resizes, or "fit" is requested.
  useLayoutEffect(fit, [fit, char, props.fitKey]);

  const v = view ?? { s: 1, ox: 0, oy: 0 };
  const toFont = useCallback(
    (clientX: number, clientY: number): Vec => {
      const r = svgRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left - v.ox) / v.s, y: (v.oy - (clientY - r.top)) / v.s };
    },
    [v.ox, v.oy, v.s],
  );
  const sx = (x: number) => v.ox + x * v.s;
  const sy = (y: number) => v.oy - y * v.s;

  // Zoom with ctrl/cmd + wheel (and trackpad pinch), pan with plain wheel.
  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!view) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const factor = Math.exp(-e.deltaY * 0.01);
        const s = Math.min(8, Math.max(0.05, view.s * factor));
        const k = s / view.s;
        setView({ s, ox: px - (px - view.ox) * k, oy: py - (py - view.oy) * k });
      } else {
        setView({ ...view, ox: view.ox - e.deltaX, oy: view.oy - e.deltaY });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view, setView]);

  // ---------- snapping ----------
  const guides = useMemo(
    () => [
      { y: metrics.ascender, label: 'Ascender' },
      { y: metrics.capHeight, label: 'Cap height' },
      { y: metrics.xHeight, label: 'x-height' },
      { y: 0, label: 'Baseline' },
      { y: metrics.descender, label: 'Descender' },
    ],
    [metrics],
  );

  const snap = useCallback(
    (p: Vec, force = false): Vec => {
      if (!prefs.snap && !force) return p;
      const tol = 6 / v.s;
      let { x, y } = p;
      const gy = guides.find((g) => Math.abs(g.y - y) < tol);
      y = gy ? gy.y : Math.round(y / SNAP) * SNAP;
      const gx = [0, glyph.advance].find((gx) => Math.abs(gx - x) < tol);
      x = gx !== undefined ? gx : Math.round(x / SNAP) * SNAP;
      return { x, y };
    },
    [prefs.snap, v.s, guides, glyph.advance],
  );

  const constrain = (from: Vec, p: Vec): Vec => {
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const d = Math.hypot(dx, dy);
    return { x: from.x + Math.cos(angle) * d, y: from.y + Math.sin(angle) * d };
  };

  // ---------- helpers ----------
  const shapeById = (id: string) => glyph.shapes.find((s) => s.id === id);
  const replaceShape = (g: Glyph, id: string, fn: (s: Shape) => Shape): Glyph => ({
    ...g,
    shapes: g.shapes.map((s) => (s.id === id ? fn(s) : s)),
  });
  const selectedShape = selection ? shapeById(selection.shapeId) : undefined;

  // ---------- pointer handling ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as Element;
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = toFont(e.clientX, e.clientY);

    if (e.button === 1 || props.spaceHeld) {
      dragRef.current = { type: 'pan', sx: e.clientX, sy: e.clientY, view: v };
      setPanning(true);
      return;
    }

    if (target.closest('[data-advance]')) {
      dragRef.current = { type: 'advance', base: glyph };
      return;
    }

    const tool = prefs.tool;
    if (tool === 'brush' || tool === 'eraser') {
      strokeRef.current = [p.x, p.y];
      // Pressure only means something for a real stylus (mice report a constant 0.5).
      const usePressure = tool === 'brush' && prefs.usePressure && e.pointerType === 'pen';
      pressureRef.current = usePressure ? [e.pressure] : null;
      setLiveStroke({ points: [p.x, p.y], pressures: pressureRef.current && [...pressureRef.current] });
      dragRef.current = { type: 'brush' };
      return;
    }

    if (tool === 'pen') {
      const nodes = penDraft ?? [];
      const first = nodes[0];
      if (first && nodes.length >= 2 && Math.hypot(sx(first.x) - sx(p.x), sy(first.y) - sy(p.y)) < 9) {
        props.finishPen();
        return;
      }
      let q = snap(p);
      if (e.shiftKey && nodes.length) q = constrain(nodes[nodes.length - 1], q);
      setPenDraft([...nodes, { x: q.x, y: q.y, in: null, out: null }]);
      dragRef.current = { type: 'pen-handle', index: nodes.length };
      return;
    }

    // select tool
    const handleEl = target.closest('[data-handle]') as SVGElement | null;
    const nodeEl = target.closest('[data-node]') as SVGElement | null;
    const shapeEl = target.closest('[data-shape]') as SVGElement | null;
    if (handleEl && selection) {
      const index = Number(handleEl.dataset.index);
      setSelection({ shapeId: selection.shapeId, node: index });
      dragRef.current = {
        type: 'handle',
        id: selection.shapeId,
        index,
        which: handleEl.dataset.handle as 'in' | 'out',
        base: glyph,
      };
      return;
    }
    if (nodeEl && selection) {
      const index = Number(nodeEl.dataset.node);
      if (e.detail === 2) {
        props.commit(
          replaceShape(glyph, selection.shapeId, (s) =>
            s.kind === 'pen' ? { ...s, nodes: toggleNodeSmooth(s.nodes, index) } : s,
          ),
        );
        return;
      }
      setSelection({ shapeId: selection.shapeId, node: index });
      dragRef.current = { type: 'node', id: selection.shapeId, index, start: p, base: glyph };
      return;
    }
    if (shapeEl) {
      const id = shapeEl.dataset.shape!;
      if (selection?.shapeId !== id) setSelection({ shapeId: id, node: null });
      else if (selection.node !== null) setSelection({ shapeId: id, node: null });
      dragRef.current = { type: 'move-shape', id, start: p, base: glyph, moved: false };
      return;
    }
    setSelection(null);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toFont(e.clientX, e.clientY);
    setHover(p);
    const drag = dragRef.current;
    if (!drag) return;

    switch (drag.type) {
      case 'pan':
        setView({
          ...drag.view,
          ox: drag.view.ox + e.clientX - drag.sx,
          oy: drag.view.oy + e.clientY - drag.sy,
        });
        break;
      case 'brush': {
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        const pts = strokeRef.current;
        const pressures = pressureRef.current;
        for (const ev of events) {
          const q = toFont(ev.clientX, ev.clientY);
          const lx = pts[pts.length - 2];
          const ly = pts[pts.length - 1];
          if (Math.hypot(q.x - lx, q.y - ly) * v.s >= 1.5) {
            pts.push(q.x, q.y);
            pressures?.push(ev.pressure);
          } else if (pressures) {
            // Pressing harder without moving should still thicken the line.
            pressures[pressures.length - 1] = Math.max(pressures[pressures.length - 1], ev.pressure);
          }
        }
        setLiveStroke({ points: [...pts], pressures: pressures && [...pressures] });
        break;
      }
      case 'pen-handle': {
        if (!penDraft) break;
        const n = penDraft[drag.index];
        if (!n) break;
        const d = { x: p.x - n.x, y: p.y - n.y };
        if (Math.hypot(d.x, d.y) * v.s < 3) break;
        setPenDraft(
          updateNode(penDraft, drag.index, (m) => ({
            ...m,
            out: d,
            in: e.altKey ? m.in : { x: -d.x, y: -d.y },
          })),
        );
        break;
      }
      case 'move-shape': {
        let dx = p.x - drag.start.x;
        let dy = p.y - drag.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (prefs.snap) {
          dx = Math.round(dx / SNAP) * SNAP;
          dy = Math.round(dy / SNAP) * SNAP;
        }
        if (!drag.moved && Math.hypot(dx, dy) * v.s < 2) break;
        drag.moved = true;
        props.apply(replaceShape(drag.base, drag.id, (s) => translateShape(s, dx, dy)));
        break;
      }
      case 'node': {
        const base = drag.base.shapes.find((s) => s.id === drag.id);
        if (!base || base.kind !== 'pen') break;
        const orig = base.nodes[drag.index];
        let q = { x: orig.x + p.x - drag.start.x, y: orig.y + p.y - drag.start.y };
        q = snap(q);
        if (e.shiftKey) q = constrain(orig, q);
        props.apply(
          replaceShape(drag.base, drag.id, (s) =>
            s.kind === 'pen' ? { ...s, nodes: updateNode(s.nodes, drag.index, (n) => ({ ...n, x: q.x, y: q.y })) } : s,
          ),
        );
        break;
      }
      case 'handle': {
        const base = drag.base.shapes.find((s) => s.id === drag.id);
        if (!base || base.kind !== 'pen') break;
        const n = base.nodes[drag.index];
        let q = p;
        if (e.shiftKey) q = constrain(n, q);
        const hv = { x: q.x - n.x, y: q.y - n.y };
        props.apply(
          replaceShape(drag.base, drag.id, (s) =>
            s.kind === 'pen'
              ? { ...s, nodes: updateNode(s.nodes, drag.index, (m) => setHandle(m, drag.which, hv, e.altKey)) }
              : s,
          ),
        );
        break;
      }
      case 'advance': {
        const x = Math.max(0, Math.round(p.x / (prefs.snap ? SNAP : 1)) * (prefs.snap ? SNAP : 1));
        props.apply({ ...drag.base, advance: x });
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    if (!drag) return;
    switch (drag.type) {
      case 'pan':
        setPanning(false);
        break;
      case 'brush': {
        const eraser = prefs.tool === 'eraser';
        const width = eraser ? prefs.eraserWidth : prefs.brushWidth;
        const { points, pressures } = cleanStroke(
          strokeRef.current,
          pressureRef.current ?? undefined,
          width,
          // Never move the line by more than half a screen pixel.
          0.5 / v.s,
        );
        const shape: BrushShape = {
          id: uid(),
          kind: 'brush',
          op: eraser ? 'cut' : 'add',
          width,
          points,
          ...(pressures && { pressures }),
        };
        setLiveStroke(null);
        strokeRef.current = [];
        pressureRef.current = null;
        if (eraser && !glyph.shapes.length) break;
        props.commit({ ...glyph, shapes: [...glyph.shapes, shape] });
        break;
      }
      case 'move-shape':
      case 'node':
      case 'handle':
      case 'advance':
        props.endGesture(drag.base);
        break;
    }
  };

  // ---------- rendering ----------
  const W = size.w;
  const H = size.h;
  // Visible area in font units.
  const x0 = -v.ox / v.s;
  const x1 = (W - v.ox) / v.s;
  const y0 = (v.oy - H) / v.s;
  const y1 = v.oy / v.s;

  const gridPath = useMemo(() => {
    if (!prefs.showGrid || !view) return '';
    let step = GRID;
    while (step * v.s < 8) step *= 2;
    let d = '';
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) d += `M${x} ${y0}V${y1}`;
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) d += `M${x0} ${y}H${x1}`;
    return d;
  }, [prefs.showGrid, view, v.s, x0, x1, y0, y1]);

  const outline = glyphSvgPath(glyph.shapes);
  const transform = `matrix(${v.s} 0 0 ${-v.s} ${v.ox} ${v.oy})`;

  const cursor = panning
    ? 'grabbing'
    : props.spaceHeld
      ? 'grab'
      : prefs.tool === 'pen'
        ? 'crosshair'
        : prefs.tool === 'brush' || prefs.tool === 'eraser'
          ? 'none'
          : 'default';

  const brushR = ((prefs.tool === 'eraser' ? prefs.eraserWidth : prefs.brushWidth) / 2) * v.s;
  const lastDraft = penDraft?.[penDraft.length - 1];

  return (
    <div className="editor" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="editor-svg"
        width={W}
        height={H}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        {view && (
          <>
            <g transform={transform}>
              {/* em box */}
              <rect
                className="em-box"
                x={0}
                y={metrics.descender}
                width={Math.max(glyph.advance, 0)}
                height={metrics.ascender - metrics.descender}
              />
              {gridPath && <path className="grid" d={gridPath} />}
              {prefs.showGuides &&
                guides.map((g) => (
                  <line
                    key={g.label}
                    className={g.y === 0 ? 'guide baseline' : 'guide'}
                    x1={x0}
                    x2={x1}
                    y1={g.y}
                    y2={g.y}
                  />
                ))}
              <line className="sidebearing" x1={0} x2={0} y1={y0} y2={y1} />
              <line className="sidebearing" x1={glyph.advance} x2={glyph.advance} y1={y0} y2={y1} />

              {prefs.showReference && (
                <ReferenceGlyph
                  char={char}
                  family={prefs.referenceFont}
                  capHeight={metrics.capHeight}
                  advance={glyph.advance}
                  opacity={prefs.referenceOpacity}
                />
              )}

              {props.guide && (
                <path className="guide-glyph" d={glyphSvgPath(props.guide.shapes)} />
              )}

              <path className="glyph-fill" d={outline} />

              {/* hit targets for selection */}
              {prefs.tool === 'select' &&
                glyph.shapes.map((s) =>
                  s.kind === 'pen' ? (
                    <path key={s.id} data-shape={s.id} className="hit" d={penPathSvg(s.nodes, true)} />
                  ) : (
                    <path
                      key={s.id}
                      data-shape={s.id}
                      className="hit hit-stroke"
                      d={brushCenterSvg(s.points)}
                      strokeWidth={s.width}
                    />
                  ),
                )}

              {/* selected shape outline */}
              {prefs.tool === 'select' && selectedShape && (
                <SelectedOutline shape={selectedShape} />
              )}

              {/* live brush stroke */}
              {liveStroke &&
                (liveStroke.pressures ? (
                  <PressureStroke points={liveStroke.points} pressures={liveStroke.pressures} width={prefs.brushWidth} />
                ) : (
                  <path
                    className={prefs.tool === 'eraser' ? 'live-stroke eraser' : 'live-stroke'}
                    d={brushCenterSvg(liveStroke.points)}
                    strokeWidth={prefs.tool === 'eraser' ? prefs.eraserWidth : prefs.brushWidth}
                  />
                ))}

              {/* pen draft */}
              {penDraft && penDraft.length > 0 && (
                <>
                  <path
                    className={prefs.penOp === 'cut' ? 'pen-draft-fill cut' : 'pen-draft-fill'}
                    d={penPathSvg(penDraft, true)}
                  />
                  <path className="pen-draft" d={penPathSvg(penDraft, false)} />
                  {lastDraft && hover && !dragRef.current && (
                    <path
                      className="pen-rubber"
                      d={penPathSvg(
                        [lastDraft, { ...(prefs.snap ? snap(hover) : hover), in: null, out: null }],
                        false,
                      )}
                    />
                  )}
                </>
              )}
            </g>

            {/* screen-space overlays */}
            {prefs.showGuides &&
              guides.map((g) => (
                <text key={g.label} className="guide-label" x={8} y={sy(g.y) - 4}>
                  {g.label} <tspan className="guide-value">{g.y}</tspan>
                </text>
              ))}

            <g data-advance className="advance-handle" transform={`translate(${sx(glyph.advance)} ${sy(metrics.descender) + 14})`}>
              <rect x={-7} y={-7} width={14} height={14} />
              <path d="M-3 -3 L-5.5 0 L-3 3 M3 -3 L5.5 0 L3 3" />
            </g>
            <text className="advance-label" x={sx(glyph.advance) + 12} y={sy(metrics.descender) + 18}>
              {Math.round(glyph.advance)}
            </text>

            {prefs.tool === 'select' && selectedShape?.kind === 'pen' && (
              <NodeHandles shape={selectedShape} activeNode={selection?.node ?? null} sx={sx} sy={sy} />
            )}

            {penDraft && (
              <g className="nodes">
                {penDraft.map((n, i) => (
                  <g key={i}>
                    {n.in && <HandleLine n={n} which="in" sx={sx} sy={sy} />}
                    {n.out && <HandleLine n={n} which="out" sx={sx} sy={sy} />}
                    <rect
                      className={i === 0 && penDraft.length >= 2 ? 'node close-target' : 'node'}
                      x={sx(n.x) - 4}
                      y={sy(n.y) - 4}
                      width={8}
                      height={8}
                    />
                  </g>
                ))}
              </g>
            )}

            {hover && (prefs.tool === 'brush' || prefs.tool === 'eraser') && !panning && !props.spaceHeld && (
              <circle className="brush-cursor" cx={sx(hover.x)} cy={sy(hover.y)} r={Math.max(brushR, 1)} />
            )}
          </>
        )}
      </svg>
    </div>
  );
}

/** Cheap live preview of a pressure stroke: one round-capped line per segment. */
function PressureStroke({ points, pressures, width }: { points: number[]; pressures: number[]; width: number }) {
  const w = (i: number) => width * pressureScale(pressures[i]);
  const n = points.length / 2;
  if (n === 1) return <circle className="live-dot" cx={points[0]} cy={points[1]} r={w(0) / 2} />;
  const lines = [];
  for (let i = 0; i < n - 1; i++) {
    lines.push(
      <line
        key={i}
        x1={points[i * 2]}
        y1={points[i * 2 + 1]}
        x2={points[i * 2 + 2]}
        y2={points[i * 2 + 3]}
        strokeWidth={(w(i) + w(i + 1)) / 2}
      />,
    );
  }
  return <g className="live-stroke">{lines}</g>;
}

function SelectedOutline({ shape }: { shape: Shape }) {
  if (shape.kind === 'pen') {
    return <path className={shape.op === 'cut' ? 'selected-outline cut' : 'selected-outline'} d={penPathSvg(shape.nodes, true)} />;
  }
  return (
    <>
      <path className="selected-stroke-halo" d={brushCenterSvg(shape.points)} strokeWidth={shape.width} />
      <path className="selected-outline" d={brushCenterSvg(shape.points)} />
    </>
  );
}

function HandleLine({
  n,
  which,
  sx,
  sy,
  index,
  interactive,
}: {
  n: PathNode;
  which: 'in' | 'out';
  sx: (x: number) => number;
  sy: (y: number) => number;
  index?: number;
  interactive?: boolean;
}) {
  const h = n[which]!;
  const hx = sx(n.x + h.x);
  const hy = sy(n.y + h.y);
  return (
    <>
      <line className="handle-line" x1={sx(n.x)} y1={sy(n.y)} x2={hx} y2={hy} />
      <circle
        className="handle"
        cx={hx}
        cy={hy}
        r={interactive ? 4 : 3}
        data-handle={interactive ? which : undefined}
        data-index={index}
      />
    </>
  );
}

function NodeHandles({
  shape,
  activeNode,
  sx,
  sy,
}: {
  shape: PenShape;
  activeNode: number | null;
  sx: (x: number) => number;
  sy: (y: number) => number;
}) {
  return (
    <g className="nodes interactive">
      {shape.nodes.map((n, i) => (
        <g key={i}>
          {n.in && <HandleLine n={n} which="in" sx={sx} sy={sy} index={i} interactive />}
          {n.out && <HandleLine n={n} which="out" sx={sx} sy={sy} index={i} interactive />}
        </g>
      ))}
      {shape.nodes.map((n, i) => (
        <rect
          key={i}
          data-node={i}
          className={i === activeNode ? 'node active' : 'node'}
          x={sx(n.x) - 4.5}
          y={sy(n.y) - 4.5}
          width={9}
          height={9}
        />
      ))}
    </g>
  );
}

// ---------- reference glyph ----------

let measureCtx: CanvasRenderingContext2D | null = null;

function measure(family: string, char: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `100px ${family}`;
  const cap = measureCtx.measureText('H').actualBoundingBoxAscent || 72;
  const m = measureCtx.measureText(char);
  return { capRatio: cap / 100, left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight };
}

function ReferenceGlyph({
  char,
  family,
  capHeight,
  advance,
  opacity,
}: {
  char: string;
  family: string;
  capHeight: number;
  advance: number;
  opacity: number;
}) {
  const [, setLoaded] = useState(0);
  useEffect(() => {
    let alive = true;
    document.fonts
      .load(`100px ${family}`, char)
      .then(() => alive && setLoaded((n) => n + 1))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [family, char]);

  if (char === ' ') return null;
  const { capRatio, left, right } = measure(family, char);
  const k = capHeight / capRatio / 100;
  const x = advance / 2 - ((right - left) / 2) * k;
  return (
    <g transform="scale(1,-1)" className="reference" opacity={opacity}>
      <text x={x} y={0} fontSize={100 * k} style={{ fontFamily: family }}>
        {char}
      </text>
    </g>
  );
}
