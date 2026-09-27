import { useEffect, useState } from 'react';
import type { Font, Metrics } from '../types';
import { deleteFont, getGlyph, isDrawn, renameFont, setMetrics } from '../store';
import { navigate, paths } from '../router';
import { ALL_CHARS, GLYPH_GROUPS, codeHex, describeChar } from '../glyphs';
import { buildFont, downloadFont, downloadProject } from '../export';
import { GlyphThumb } from '../components/GlyphSvg';
import { Logo } from './Library';
import { NumberField } from '../components/NumberField';

let faceCounter = 0;

/** Loads the font being drawn into the page so the type tester can use it. */
function useFontFace(font: Font) {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    let face: FontFace | null = null;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const name = `fd-preview-${++faceCounter}`;
        face = new FontFace(name, buildFont(font));
        await face.load();
        if (cancelled) return;
        document.fonts.add(face);
        setFamily(name);
      } catch (err) {
        console.warn('Preview font failed to load', err);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      // Keep the previous face around briefly so the tester doesn't flash while the next one loads.
      const old = face;
      if (old) setTimeout(() => document.fonts.delete(old), 2000);
    };
  }, [font.glyphs, font.metrics, font.name]);
  return family;
}

const METRIC_FIELDS: { key: keyof Metrics; label: string }[] = [
  { key: 'ascender', label: 'Ascender' },
  { key: 'capHeight', label: 'Cap height' },
  { key: 'xHeight', label: 'x-height' },
  { key: 'descender', label: 'Descender' },
];

export function FontView({ font }: { font: Font }) {
  const family = useFontFace(font);
  const [text, setText] = useState('Handgloves — The quick brown fox jumps over the lazy dog. 0123456789');
  const [size, setSize] = useState(64);
  const drawnCount = ALL_CHARS.filter((c) => isDrawn(font, c)).length;
  const firstUndrawn = ALL_CHARS.find((c) => !isDrawn(font, c) && c !== ' ');

  return (
    <div className="screen">
      <header className="bar">
        <a className="bar-cell brand" href={paths.library()}>
          <Logo /> Font Draw
        </a>
        <div className="bar-cell bar-title">
          <input
            className="title-input"
            value={font.name}
            onChange={(e) => renameFont(font.id, e.target.value)}
            aria-label="Font name"
            spellCheck={false}
          />
        </div>
        <div className="bar-spacer" />
        <div className="bar-cell mono small">
          {drawnCount} / {ALL_CHARS.length} drawn
        </div>
        {firstUndrawn && (
          <a className="bar-cell bar-button" href={paths.glyph(font.id, codeHex(firstUndrawn))}>
            Continue drawing → {firstUndrawn}
          </a>
        )}
        <button className="bar-cell bar-button primary" onClick={() => downloadFont(font)} disabled={!drawnCount}>
          <DownloadIcon /> Download .otf
        </button>
      </header>

      <div className="font-layout">
        <main className="font-main">
          <section className="tester">
            <div className="tester-controls">
              <span className="label">Type tester</span>
              <input
                className="tester-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type something…"
              />
              <label className="tester-size mono small">
                <input type="range" min={16} max={200} value={size} onChange={(e) => setSize(+e.target.value)} />
                {size}px
              </label>
            </div>
            <div
              className="tester-output"
              style={{ fontFamily: family ? `"${family}", var(--fallback-font)` : 'var(--fallback-font)', fontSize: size }}
            >
              {drawnCount ? text || ' ' : <span className="muted tester-empty">Draw some glyphs to see your font here.</span>}
            </div>
          </section>

          {GLYPH_GROUPS.map((group) => {
            const count = group.chars.filter((c) => isDrawn(font, c)).length;
            return (
              <section key={group.id} className="glyph-group">
                <div className="section-label">
                  <span>{group.label}</span>
                  <span className="muted">
                    {count}/{group.chars.length}
                  </span>
                </div>
                <div className="glyph-grid">
                  {group.chars.map((char) => {
                    const glyph = getGlyph(font, char);
                    const drawn = glyph.shapes.length > 0;
                    return (
                      <a
                        key={char}
                        className={`glyph-cell${drawn ? ' drawn' : ''}`}
                        href={paths.glyph(font.id, codeHex(char))}
                        title={`${describeChar(char)} · U+${codeHex(char)}`}
                      >
                        <span className="glyph-cell-label">{char === ' ' ? '␣' : char}</span>
                        {drawn ? (
                          <GlyphThumb font={font} glyph={glyph} className="glyph-cell-svg" />
                        ) : (
                          <span className="glyph-cell-ghost">{char === ' ' ? 'Space' : char}</span>
                        )}
                      </a>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </main>

        <aside className="sidebar">
          <section className="panel">
            <div className="panel-title">Font</div>
            <label className="field">
              <span>Family name</span>
              <input value={font.name} onChange={(e) => renameFont(font.id, e.target.value)} spellCheck={false} />
            </label>
            <div className="progress">
              <div className="progress-bar" style={{ width: `${(drawnCount / ALL_CHARS.length) * 100}%` }} />
            </div>
            <div className="muted small mono">
              {drawnCount} of {ALL_CHARS.length} glyphs drawn
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">
              Vertical metrics <span className="muted">units / {font.metrics.unitsPerEm} em</span>
            </div>
            <MetricsDiagram metrics={font.metrics} />
            <div className="field-grid">
              {METRIC_FIELDS.map(({ key, label }) => (
                <NumberField
                  key={key}
                  label={label}
                  value={font.metrics[key]}
                  min={key === 'descender' ? -600 : 0}
                  max={key === 'descender' ? 0 : 1200}
                  step={10}
                  onChange={(v) => setMetrics(font.id, { [key]: v })}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">Export</div>
            <button className="button primary block" onClick={() => downloadFont(font)} disabled={!drawnCount}>
              <DownloadIcon /> Download OpenType (.otf)
            </button>
            <p className="muted small">
              Includes every glyph you’ve drawn. Undrawn characters fall back to another font on the system.
            </p>
            <button className="button block" onClick={() => downloadProject(font)}>
              Save project file (.json)
            </button>
            <p className="muted small">Editable backup you can reopen later from the library.</p>
          </section>

          <section className="panel">
            <button
              className="button block danger"
              onClick={() => {
                if (confirm(`Delete “${font.name}”? This can’t be undone.`)) {
                  deleteFont(font.id);
                  navigate(paths.library(), true);
                }
              }}
            >
              Delete font
            </button>
          </section>
        </aside>
      </div>
    </div>
  );
}

function MetricsDiagram({ metrics }: { metrics: Metrics }) {
  const { ascender, capHeight, xHeight, descender } = metrics;
  const top = ascender + 60;
  const h = top - (descender - 60);
  const k = 5;
  const lines = [
    { y: ascender, label: 'Ascender' },
    { y: capHeight, label: 'Cap' },
    { y: xHeight, label: 'x' },
    { y: 0, label: 'Baseline' },
    { y: descender, label: 'Descender' },
  ];
  return (
    <svg className="metrics-diagram" viewBox={`0 0 280 ${h / k}`} aria-hidden>
      {lines.map((l) => {
        const y = (top - l.y) / k;
        return (
          <g key={l.label}>
            <line x1={0} x2={280} y1={y} y2={y} className={l.y === 0 ? 'baseline' : ''} />
            <text x={278} y={y - 3} textAnchor="end">
              {l.label}
            </text>
          </g>
        );
      })}
      <text x={12} y={top / k} className="metrics-sample" style={{ fontSize: capHeight / k / 0.72 }}>
        Hx
      </text>
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
