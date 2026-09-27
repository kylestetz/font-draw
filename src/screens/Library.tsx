import { useRef } from 'react';
import { createFont, deleteFont, duplicateFont, importFont, isDrawn, useStore } from '../store';
import { navigate, paths } from '../router';
import { ALL_CHARS } from '../glyphs';
import { GlyphRun } from '../components/GlyphSvg';
import { readProjectFile } from '../export';
import type { Font } from '../types';

function sampleText(font: Font) {
  if (isDrawn(font, 'A') && isDrawn(font, 'a')) return 'Aa';
  const drawn = ALL_CHARS.filter((c) => isDrawn(font, c));
  return drawn.slice(0, 3).join('');
}

export function Library({ notFound }: { notFound?: boolean }) {
  const { fonts } = useStore();
  const fileInput = useRef<HTMLInputElement>(null);

  const onNew = () => navigate(paths.font(createFont().id));

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      navigate(paths.font(importFont(await readProjectFile(file)).id));
    } catch (err) {
      alert((err as Error).message);
    }
  };

  return (
    <div className="screen">
      <header className="bar">
        <div className="bar-cell brand">
          <Logo /> Font Draw
        </div>
        <div className="bar-spacer" />
        <button className="bar-cell bar-button" onClick={() => fileInput.current?.click()}>
          Open project…
        </button>
        <button className="bar-cell bar-button primary" onClick={onNew}>
          New font
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            onImport(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </header>

      <main className="library">
        {notFound && <div className="notice">That font doesn’t exist anymore.</div>}
        <div className="library-intro">
          <h1>Draw a typeface, glyph by glyph.</h1>
          <p>
            Sketch letters with a brush or build precise outlines with the pen, then download a real
            OpenType font you can install and use anywhere.
          </p>
        </div>
        <div className="section-label">
          <span>Your fonts</span>
          <span className="muted">{fonts.length}</span>
        </div>
        <div className="font-cards">
          <button className="font-card new-card" onClick={onNew}>
            <span className="new-plus">+</span>
            <span>New font</span>
          </button>
          {fonts.map((font) => {
            const drawn = ALL_CHARS.filter((c) => isDrawn(font, c)).length;
            const sample = sampleText(font);
            return (
              <div key={font.id} className="font-card" onClick={() => navigate(paths.font(font.id))}>
                <div className="font-card-preview">
                  {sample ? (
                    <GlyphRun font={font} text={sample} className="font-card-run" />
                  ) : (
                    <span className="font-card-empty">Aa</span>
                  )}
                </div>
                <div className="font-card-meta">
                  <div className="font-card-name">{font.name || 'Untitled'}</div>
                  <div className="muted mono small">
                    {drawn}/{ALL_CHARS.length} glyphs · {new Date(font.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="font-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => duplicateFont(font.id)}>Duplicate</button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete “${font.name}”? This can’t be undone.`)) deleteFont(font.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

export function Logo() {
  return (
    <svg className="logo" viewBox="0 0 20 20" aria-hidden>
      <rect x="0.5" y="0.5" width="19" height="19" fill="none" stroke="currentColor" />
      <path d="M5.5 15.5 L10 4.5 L14.5 15.5 M7.3 11.5 H12.7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
