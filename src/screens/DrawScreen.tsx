import { useCallback, useEffect, useRef, useState } from 'react';
import type { Font, Glyph, PathNode, PenShape } from '../types';
import {
  addAlternate,
  deleteAlternate,
  getGlyph,
  isDrawn,
  setCycleAlternates,
  setGlyph,
  uid,
  variantCount,
} from '../store';
import { navigate, paths } from '../router';
import { ALL_CHARS, codeHex, describeChar, groupOf } from '../glyphs';
import { REFERENCE_FONTS, usePrefs, type Tool } from '../prefs';
import { Editor, type Selection, type View } from '../editor/Editor';
import { GlyphRun, GlyphThumb } from '../components/GlyphSvg';
import { NumberField } from '../components/NumberField';
import { glyphOutline } from '../geometry/outline';
import { translateShape } from '../editor/shapes';
import { Logo } from './Library';
import { pressureScale } from '../geometry/pressure';

type History = { past: Glyph[]; future: Glyph[] };
const HISTORY_LIMIT = 200;

const TOOLS: { id: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  {
    id: 'select',
    label: 'Select',
    key: 'V',
    icon: <path d="M5 3 L5 17 L9 13 L12 19 L14 18 L11 12 L16 12 Z" />,
  },
  {
    id: 'pen',
    label: 'Pen',
    key: 'P',
    icon: (
      <>
        <path d="M10 2 L15 11 L12 17 H8 L5 11 Z" />
        <path d="M10 2 V10" />
        <circle cx="10" cy="11" r="1.4" />
        <path d="M7.5 19.5 H12.5" />
      </>
    ),
  },
  {
    id: 'brush',
    label: 'Brush',
    key: 'B',
    icon: (
      <>
        <path d="M17 3 L9 11" />
        <path d="M9 11 C6 11 5 13 5 15 C5 16.5 4 17 3 17 C5 19 9 19 10.5 17 C11.5 15.5 11 13 9 11 Z" />
      </>
    ),
  },
  {
    id: 'eraser',
    label: 'Eraser',
    key: 'E',
    icon: (
      <>
        <path d="M3 13 L11 5 L17 11 L11 17 H7 Z" />
        <path d="M7 9 L13 15" />
        <path d="M11 17 H18" />
      </>
    ),
  },
];

const SHORTCUTS: [string, string][] = [
  ['V P B E', 'Tools'],
  ['[  ]', 'Brush size'],
  ['← →', 'Previous / next glyph'],
  ['⌘Z  ⇧⌘Z', 'Undo / redo'],
  ['Space + drag', 'Pan'],
  ['⌘ + scroll', 'Zoom'],
  ['Enter', 'Close pen path'],
  ['Shift', 'Constrain angles'],
  ['Alt + drag', 'Break handle symmetry'],
  ['Double-click node', 'Corner ⇄ smooth'],
];

function contextString(char: string) {
  if (/[a-z]/.test(char)) return `nn${char}nono${char}oo`;
  if (/[0-9]/.test(char)) return `00${char}0101${char}11`;
  return `HH${char}HOHO${char}OO`;
}

export function DrawScreen({ font, char, variant }: { font: Font; char: string; variant: number }) {
  const glyph = getGlyph(font, char, variant);
  const variants = variantCount(font, char);
  const historyKey = `${char}:${variant}`;
  const [prefs, setPrefs] = usePrefs();
  const [selection, setSelection] = useState<Selection>(null);
  const [penDraft, setPenDraft] = useState<PathNode[] | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [showKeys, setShowKeys] = useState(false);
  const [penDetected, setPenDetected] = useState(false);
  const histories = useRef(new Map<string, History>());
  const [, bump] = useState(0);

  const history = (c: string) => {
    let h = histories.current.get(c);
    if (!h) histories.current.set(c, (h = { past: [], future: [] }));
    return h;
  };

  // Always operate on the latest glyph inside callbacks.
  const glyphRef = useRef(glyph);
  glyphRef.current = glyph;
  const target = useRef({ char, variant, historyKey });
  target.current = { char, variant, historyKey };

  const apply = useCallback(
    (g: Glyph) => setGlyph(font.id, target.current.char, g, target.current.variant),
    [font.id],
  );

  const pushHistory = (base: Glyph) => {
    const h = history(target.current.historyKey);
    h.past.push(base);
    if (h.past.length > HISTORY_LIMIT) h.past.shift();
    h.future = [];
    bump((n) => n + 1);
  };

  // Rapid edits sharing a merge key (e.g. dragging a slider) collapse into a single undo step.
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const commit = (g: Glyph, mergeKey?: string) => {
    const now = Date.now();
    const merge = mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < 1000;
    if (!merge) pushHistory(glyphRef.current);
    lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
    apply(g);
  };

  const endGesture = (base: Glyph) => {
    if (glyphRef.current !== base) pushHistory(base);
  };

  const undo = () => {
    const h = history(historyKey);
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(glyphRef.current);
    setSelection(null);
    apply(prev);
  };
  const redo = () => {
    const h = history(historyKey);
    const next = h.future.pop();
    if (!next) return;
    h.past.push(glyphRef.current);
    apply(next);
  };

  const penDraftRef = useRef(penDraft);
  penDraftRef.current = penDraft;
  const finishPen = () => {
    const draft = penDraftRef.current;
    if (draft && draft.length >= 2) {
      const shape: PenShape = { id: uid(), kind: 'pen', op: prefs.penOp, nodes: draft };
      commit({ ...glyphRef.current, shapes: [...glyphRef.current.shapes, shape] });
    }
    penDraftRef.current = null;
    setPenDraft(null);
  };

  const setTool = (tool: Tool) => {
    if (tool !== 'pen') finishPen();
    if (tool !== 'select') setSelection(null);
    setPrefs({ tool });
  };

  const index = ALL_CHARS.indexOf(char);
  const goTo = (c: string, v = 0) => {
    finishPen();
    setSelection(null);
    navigate(paths.glyph(font.id, codeHex(c), v), true);
  };

  const newAlternate = (copy: boolean) => {
    finishPen();
    goTo(char, addAlternate(font.id, char, copy ? glyph : undefined));
  };
  const removeAlternate = () => {
    if (variant === 0) return;
    if (glyph.shapes.length && !confirm(`Delete alternate ${variant} of “${char}”?`)) return;
    // Later alternates shift down a slot, so their undo histories no longer line up.
    for (const key of [...histories.current.keys()]) if (key.startsWith(`${char}:`)) histories.current.delete(key);
    deleteAlternate(font.id, char, variant);
    goTo(char, variant - 1);
  };
  const prev = () => goTo(ALL_CHARS[(index - 1 + ALL_CHARS.length) % ALL_CHARS.length]);
  const next = () => goTo(ALL_CHARS[(index + 1) % ALL_CHARS.length]);

  const selectedShape = selection ? glyph.shapes.find((s) => s.id === selection.shapeId) : undefined;

  const deleteSelection = () => {
    if (!selection || !selectedShape) return;
    if (selectedShape.kind === 'pen' && selection.node !== null && selectedShape.nodes.length > 3) {
      const nodes = selectedShape.nodes.filter((_, i) => i !== selection.node);
      commit({ ...glyph, shapes: glyph.shapes.map((s) => (s.id === selectedShape.id ? { ...s, nodes } : s)) });
      setSelection({ shapeId: selectedShape.id, node: null });
      return;
    }
    commit({ ...glyph, shapes: glyph.shapes.filter((s) => s.id !== selection.shapeId) });
    setSelection(null);
  };

  const nudge = (dx: number, dy: number) => {
    if (!selectedShape) return;
    commit({
      ...glyph,
      shapes: glyph.shapes.map((s) => (s.id === selectedShape.id ? translateShape(s, dx, dy) : s)),
    });
  };

  // ---------- keyboard ----------
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod) return;
    if (e.key === ' ') {
      e.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (k === 'v') setTool('select');
    else if (k === 'p') setTool('pen');
    else if (k === 'b') setTool('brush');
    else if (k === 'e') setTool('eraser');
    else if (e.key === '[' || e.key === ']') {
      const d = e.key === ']' ? 10 : -10;
      if (prefs.tool === 'eraser') setPrefs({ eraserWidth: clampWidth(prefs.eraserWidth + d) });
      else setPrefs({ brushWidth: clampWidth(prefs.brushWidth + d) });
    } else if (e.key === 'Enter') {
      if (penDraft) finishPen();
    } else if (e.key === 'Escape') {
      if (penDraft) finishPen();
      else setSelection(null);
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (penDraft) setPenDraft(penDraft.length > 1 ? penDraft.slice(0, -1) : null);
      else deleteSelection();
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      if (selectedShape && prefs.tool === 'select') {
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0;
        nudge(dx, dy);
      } else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    } else if (k === 'r') setPrefs({ showReference: !prefs.showReference });
    else if (k === 'g') setPrefs({ showGrid: !prefs.showGrid });
    else if (k === '0') setFitKey((n) => n + 1);
  };
  useEffect(() => {
    if (penDetected) return;
    const onPointer = (e: PointerEvent) => e.pointerType === 'pen' && setPenDetected(true);
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [penDetected]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => keyHandler.current(e);
    const up = (e: KeyboardEvent) => e.key === ' ' && setSpaceHeld(false);
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Keep the current glyph visible in the bottom strip.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector('.current')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [char]);

  // ---------- metrics ----------
  const bounds = glyphOutline(glyph.shapes).bounds;
  const lsb = bounds ? Math.round(bounds.x) : null;
  const rsb = bounds ? Math.round(glyph.advance - bounds.x - bounds.width) : null;
  const setLsb = (value: number) => {
    if (!bounds) return;
    const dx = value - bounds.x;
    commit({ shapes: glyph.shapes.map((s) => translateShape(s, dx, 0)), advance: Math.round(glyph.advance + dx) });
  };
  const setRsb = (value: number) => {
    if (!bounds) return;
    commit({ ...glyph, advance: Math.max(0, Math.round(bounds.x + bounds.width + value)) });
  };
  const autoFit = () => {
    if (!bounds) return;
    const side = Math.round(font.metrics.unitsPerEm * 0.06);
    const dx = side - bounds.x;
    commit({
      shapes: glyph.shapes.map((s) => translateShape(s, dx, 0)),
      advance: Math.round(bounds.width + side * 2),
    });
  };

  const h = history(historyKey);
  const group = groupOf(char);
  const toolLabel = TOOLS.find((t) => t.id === prefs.tool)!.label;
  const customFont = !REFERENCE_FONTS.some((f) => f.stack === prefs.referenceFont);

  return (
    <div className="screen draw-screen">
      <header className="bar">
        <a className="bar-cell brand" href={paths.library()}>
          <Logo />
        </a>
        <a className="bar-cell bar-button" href={paths.font(font.id)}>
          ← {font.name || 'Untitled'}
        </a>
        <div className="bar-cell glyph-title">
          <span className="glyph-title-char">{char === ' ' ? '␣' : char}</span>
          <span>{describeChar(char)}</span>
          <span className="muted mono small">
            U+{codeHex(char)} · {group.label}
          </span>
        </div>
        <div className="bar-cell variant-tabs">
          {Array.from({ length: variants }, (_, v) => (
            <button
              key={v}
              className={v === variant ? 'active' : ''}
              onClick={() => goTo(char, v)}
              title={v === 0 ? 'Default glyph' : `Alternate ${v}`}
            >
              {v === 0 ? 'Default' : `Alt ${v}`}
            </button>
          ))}
          <button onClick={() => newAlternate(false)} title="New alternate">
            +
          </button>
        </div>
        <div className="bar-spacer" />
        <button className="bar-cell bar-button" onClick={prev} title="Previous glyph (←)">
          ‹ Prev
        </button>
        <div className="bar-cell mono small counter">
          {index + 1} / {ALL_CHARS.length}
        </div>
        <button className="bar-cell bar-button" onClick={next} title="Next glyph (→)">
          Next ›
        </button>
      </header>

      <div className="draw-layout">
        <nav className="toolbar">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={prefs.tool === t.id ? 'tool active' : 'tool'}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.key})`}
            >
              <svg viewBox="0 0 20 20" aria-hidden>
                {t.icon}
              </svg>
              <span className="tool-key">{t.key}</span>
            </button>
          ))}
          <div className="toolbar-sep" />
          <button className="tool" onClick={undo} disabled={!h.past.length} title="Undo (⌘Z)">
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M7 5 L3 9 L7 13" />
              <path d="M3 9 H12 C15 9 17 11 17 13.5 C17 16 15 17 12 17 H9" />
            </svg>
          </button>
          <button className="tool" onClick={redo} disabled={!h.future.length} title="Redo (⇧⌘Z)">
            <svg viewBox="0 0 20 20" aria-hidden>
              <path d="M13 5 L17 9 L13 13" />
              <path d="M17 9 H8 C5 9 3 11 3 13.5 C3 16 5 17 8 17 H11" />
            </svg>
          </button>
          <div className="toolbar-spacer" />
          <button className={showKeys ? 'tool active' : 'tool'} onClick={() => setShowKeys((s) => !s)} title="Keyboard shortcuts">
            <svg viewBox="0 0 20 20" aria-hidden>
              <rect x="2.5" y="5.5" width="15" height="10" />
              <path d="M5 8.5h1M8 8.5h1M11 8.5h1M14 8.5h1M6 12.5h8" />
            </svg>
          </button>
        </nav>

        <div className="canvas-area">
          <Editor
            font={font}
            char={char}
            glyph={glyph}
            guide={variant > 0 && prefs.showDefaultGuide ? getGlyph(font, char) : undefined}
            prefs={prefs}
            selection={selection}
            setSelection={setSelection}
            penDraft={penDraft}
            setPenDraft={setPenDraft}
            finishPen={finishPen}
            apply={apply}
            commit={commit}
            endGesture={endGesture}
            spaceHeld={spaceHeld}
            view={view}
            setView={setView}
            fitKey={fitKey}
          />
          <div className="canvas-hud">
            <span className="mono small">{toolLabel}</span>
            <span className="hud-hint small muted">{hintFor(prefs.tool, !!penDraft)}</span>
          </div>
          <div className="zoom-controls">
            <button onClick={() => view && zoomBy(view, 1 / 1.25, setView)} title="Zoom out">
              −
            </button>
            <button className="mono small" onClick={() => setFitKey((n) => n + 1)} title="Fit (0)">
              Fit
            </button>
            <button onClick={() => view && zoomBy(view, 1.25, setView)} title="Zoom in">
              +
            </button>
          </div>
          {showKeys && (
            <div className="shortcuts">
              <div className="panel-title">Shortcuts</div>
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="shortcut-row">
                  <span className="mono small">{k}</span>
                  <span className="small">{d}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="sidebar">
          <section className="panel">
            <div className="panel-title">{toolLabel}</div>
            {(prefs.tool === 'brush' || prefs.tool === 'eraser') && (
              <WidthControl
                value={prefs.tool === 'eraser' ? prefs.eraserWidth : prefs.brushWidth}
                onChange={(w) => setPrefs(prefs.tool === 'eraser' ? { eraserWidth: w } : { brushWidth: w })}
                tapered={prefs.tool === 'brush' && prefs.usePressure}
              />
            )}
            {prefs.tool === 'brush' && (
              <div className="checkbox-group">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={prefs.usePressure}
                    onChange={(e) => setPrefs({ usePressure: e.target.checked })}
                  />
                  <span>Use pen pressure</span>
                </label>
                <p className="muted small">
                  {penDetected
                    ? 'Stylus detected. Press harder for a heavier line, up to the width above.'
                    : 'Works with a pressure-sensitive stylus like Apple Pencil. Mouse and finger strokes stay a fixed width.'}
                </p>
              </div>
            )}
            {prefs.tool === 'pen' && (
              <>
                <Segmented
                  value={prefs.penOp}
                  options={[
                    ['add', 'Fill'],
                    ['cut', 'Cut out'],
                  ]}
                  onChange={(penOp) => setPrefs({ penOp })}
                />
                <p className="muted small">
                  Click to place corners, drag to pull out curves. Click the first point or press Enter to
                  close. Use <em>Cut out</em> for counters like the hole in an O.
                </p>
              </>
            )}
            {prefs.tool === 'select' &&
              (selectedShape ? (
                <>
                  <div className="kv">
                    <span className="muted">Shape</span>
                    <span>{selectedShape.kind === 'pen' ? `Path · ${selectedShape.nodes.length} points` : 'Brush stroke'}</span>
                  </div>
                  <Segmented
                    value={selectedShape.op}
                    options={[
                      ['add', 'Fill'],
                      ['cut', 'Cut out'],
                    ]}
                    onChange={(op) =>
                      commit({
                        ...glyph,
                        shapes: glyph.shapes.map((s) => (s.id === selectedShape.id ? { ...s, op } : s)),
                      })
                    }
                  />
                  {selectedShape.kind === 'brush' && (
                    <WidthControl
                      value={selectedShape.width}
                      onChange={(width) =>
                        commit(
                          {
                            ...glyph,
                            shapes: glyph.shapes.map((s) => (s.id === selectedShape.id ? { ...s, width } : s)),
                          },
                          `width:${selectedShape.id}`,
                        )
                      }
                    />
                  )}
                  <button className="button block" onClick={deleteSelection}>
                    Delete {selection?.node !== null && selectedShape.kind === 'pen' && selectedShape.nodes.length > 3 ? 'point' : 'shape'}
                  </button>
                </>
              ) : (
                <p className="muted small">
                  Click a shape to select it. Drag to move, drag points and handles to reshape. Arrow keys nudge.
                </p>
              ))}
          </section>

          <section className="panel">
            <div className="panel-title">
              Reference
              <Toggle checked={prefs.showReference} onChange={(showReference) => setPrefs({ showReference })} />
            </div>
            <label className="field">
              <span>Font</span>
              <select
                value={customFont ? '__custom' : prefs.referenceFont}
                onChange={(e) =>
                  setPrefs({ referenceFont: e.target.value === '__custom' ? 'Futura' : e.target.value, showReference: true })
                }
              >
                {REFERENCE_FONTS.map((f) => (
                  <option key={f.label} value={f.stack}>
                    {f.label}
                  </option>
                ))}
                <option value="__custom">Installed font…</option>
              </select>
            </label>
            {customFont && (
              <label className="field">
                <span>Font name</span>
                <input
                  value={prefs.referenceFont}
                  onChange={(e) => setPrefs({ referenceFont: e.target.value })}
                  placeholder="e.g. Futura"
                  spellCheck={false}
                />
              </label>
            )}
            <label className="field">
              <span>
                Opacity <span className="muted mono">{Math.round(prefs.referenceOpacity * 100)}%</span>
              </span>
              <input
                type="range"
                min={0.04}
                max={0.6}
                step={0.01}
                value={prefs.referenceOpacity}
                onChange={(e) => setPrefs({ referenceOpacity: +e.target.value })}
              />
            </label>
          </section>

          <section className="panel">
            <div className="panel-title">Guides</div>
            <div className="toggle-row">
              <span>Grid</span>
              <Toggle checked={prefs.showGrid} onChange={(showGrid) => setPrefs({ showGrid })} />
            </div>
            <div className="toggle-row">
              <span>Metric lines</span>
              <Toggle checked={prefs.showGuides} onChange={(showGuides) => setPrefs({ showGuides })} />
            </div>
            <div className="toggle-row">
              <span>Snap to grid &amp; guides</span>
              <Toggle checked={prefs.snap} onChange={(snap) => setPrefs({ snap })} />
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">Spacing</div>
            <div className="field-grid three">
              <NumberField label="Width" value={glyph.advance} min={0} max={3000} step={10} onChange={(advance) => commit({ ...glyph, advance })} />
              {lsb !== null && rsb !== null ? (
                <>
                  <NumberField label="Left" value={lsb} min={-1000} max={1000} step={5} onChange={setLsb} />
                  <NumberField label="Right" value={rsb} min={-1000} max={1000} step={5} onChange={setRsb} />
                </>
              ) : (
                <div className="muted small span2">Draw something to edit sidebearings.</div>
              )}
            </div>
            <button className="button block" onClick={autoFit} disabled={!bounds}>
              Auto-fit width
            </button>
          </section>

          <section className="panel">
            <div className="panel-title">In context</div>
            <GlyphRun
              font={font}
              text={contextString(char)}
              highlight={char}
              variant={variant}
              className="context-run"
              padding={40}
            />
            {variants > 1 && char !== ' ' && (
              <>
                <div className="muted small">Typed repeatedly, alternates cycle:</div>
                <GlyphRun font={font} text={char.repeat(Math.min(8, variants * 2))} className="context-run" padding={40} />
              </>
            )}
          </section>

          <section className="panel">
            <div className="panel-title">
              Alternates <span className="muted">{variants > 1 ? `${variants - 1}` : 'none'}</span>
            </div>
            <p className="muted small">
              Draw extra versions of a character. The font swaps between them as you type so repeated letters
              look hand-drawn instead of identical.
            </p>
            <div className="button-row">
              <button className="button" onClick={() => newAlternate(false)}>
                New blank
              </button>
              <button className="button" onClick={() => newAlternate(true)} disabled={!glyph.shapes.length}>
                Duplicate this
              </button>
            </div>
            {variant > 0 && (
              <>
                <div className="toggle-row">
                  <span>Show default glyph as a guide</span>
                  <Toggle checked={prefs.showDefaultGuide} onChange={(showDefaultGuide) => setPrefs({ showDefaultGuide })} />
                </div>
                <button className="button block" onClick={removeAlternate}>
                  Delete alternate {variant}
                </button>
              </>
            )}
            <div className="toggle-row">
              <span>Cycle alternates as you type</span>
              <Toggle
                checked={font.cycleAlternates !== false}
                onChange={(on) => setCycleAlternates(font.id, on)}
              />
            </div>
          </section>

          <section className="panel">
            <button
              className="button block danger"
              disabled={!glyph.shapes.length}
              onClick={() => {
                commit({ ...glyph, shapes: [] });
                setSelection(null);
              }}
            >
              Clear glyph
            </button>
          </section>
        </aside>
      </div>

      <footer className="glyph-strip" ref={stripRef}>
        {ALL_CHARS.map((c) => {
          const g = getGlyph(font, c);
          return (
            <button
              key={c}
              className={`strip-cell${c === char ? ' current' : ''}${isDrawn(font, c) ? ' drawn' : ''}`}
              onClick={() => goTo(c)}
              title={describeChar(c)}
            >
              {g.shapes.length ? (
                <GlyphThumb font={font} glyph={g} className="strip-svg" />
              ) : (
                <span className="strip-ghost">{c === ' ' ? '␣' : c}</span>
              )}
            </button>
          );
        })}
      </footer>
    </div>
  );
}

const clampWidth = (w: number) => Math.min(300, Math.max(4, w));

function zoomBy(view: View, factor: number, setView: (v: View) => void) {
  const el = document.querySelector('.editor-svg');
  if (!el) return;
  const r = el.getBoundingClientRect();
  const px = r.width / 2;
  const py = r.height / 2;
  const s = Math.min(8, Math.max(0.05, view.s * factor));
  const k = s / view.s;
  setView({ s, ox: px - (px - view.ox) * k, oy: py - (py - view.oy) * k });
}

function hintFor(tool: Tool, drafting: boolean) {
  switch (tool) {
    case 'select':
      return 'Click a shape to edit it';
    case 'pen':
      return drafting ? 'Click the first point or press Enter to close' : 'Click to add points, drag for curves';
    case 'brush':
      return 'Draw freehand · [ ] to resize';
    case 'eraser':
      return 'Erase parts of the glyph · [ ] to resize';
  }
}

function WidthControl({
  value,
  onChange,
  tapered = false,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Preview a pressure stroke (light → heavy → light) instead of a single dot. */
  tapered?: boolean;
}) {
  const full = Math.max(2, (value / 300) * 56);
  let preview: React.ReactNode = <circle cx="60" cy="30" r={full / 2} />;
  if (tapered) {
    const pts = Array.from({ length: 41 }, (_, i) => {
      const t = i / 40;
      return { x: 12 + t * 96, y: 30 - Math.sin(t * Math.PI * 2) * 10, w: full * pressureScale(Math.sin(t * Math.PI)) };
    });
    preview = (
      <g className="taper">
        {pts.slice(1).map((p, i) => (
          <line key={i} x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y} strokeWidth={(pts[i].w + p.w) / 2} />
        ))}
      </g>
    );
  }
  return (
    <div className="width-control">
      <div className="width-preview">
        <svg viewBox="0 0 120 60" aria-hidden>
          {preview}
        </svg>
      </div>
      <div className="width-inputs">
        <input type="range" min={4} max={300} value={value} onChange={(e) => onChange(+e.target.value)} />
        <NumberField
          label={tapered ? 'Max width' : 'Width'}
          value={value}
          min={4}
          max={300}
          step={2}
          onChange={onChange}
          suffix="u"
        />
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map(([v, label]) => (
        <button key={v} className={v === value ? 'active' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={checked ? 'toggle on' : 'toggle'}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}
