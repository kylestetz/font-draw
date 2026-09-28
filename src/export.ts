import * as opentype from 'opentype.js';
import type { Font } from './types';
import { ALL_CHARS, postscriptName } from './glyphs';
import { drawnAlternates, getGlyph } from './store';
import { buildGsub, type AltEntry } from './features';
import type { Glyph } from './types';
import { glyphOutline, walkContours } from './geometry/outline';

function familyName(font: Font) {
  return font.name.trim() || 'Untitled';
}

/** Builds a CFF-flavoured OpenType font from every glyph that has been drawn (plus the space). */
export function buildFont(font: Font): ArrayBuffer {
  const { metrics } = font;
  const notdefPath = new opentype.Path();
  // A simple hollow box for .notdef.
  const w = 500;
  const h = metrics.capHeight;
  notdefPath.moveTo(50, 0);
  notdefPath.lineTo(50, h);
  notdefPath.lineTo(w - 50, h);
  notdefPath.lineTo(w - 50, 0);
  notdefPath.close();
  notdefPath.moveTo(100, 50);
  notdefPath.lineTo(w - 100, 50);
  notdefPath.lineTo(w - 100, h - 50);
  notdefPath.lineTo(100, h - 50);
  notdefPath.close();

  const glyphs = [new opentype.Glyph({ name: '.notdef', advanceWidth: w, path: notdefPath })];
  let yMax = metrics.ascender;
  let yMin = metrics.descender;

  const addGlyph = (glyph: Glyph, name: string, unicode?: number) => {
    const path = new opentype.Path();
    const R = Math.round;
    const outline = glyphOutline(glyph.shapes);
    if (outline.bounds) {
      yMax = Math.max(yMax, outline.bounds.y + outline.bounds.height);
      yMin = Math.min(yMin, outline.bounds.y);
    }
    walkContours(outline.contours, {
      move: (x, y) => path.moveTo(R(x), R(y)),
      line: (x, y) => path.lineTo(R(x), R(y)),
      curve: (x1, y1, x2, y2, x, y) => path.curveTo(R(x1), R(y1), R(x2), R(y2), R(x), R(y)),
      close: () => path.close(),
    });
    glyphs.push(
      new opentype.Glyph({
        name,
        ...(unicode !== undefined && { unicode }),
        advanceWidth: Math.max(0, Math.round(glyph.advance)),
        path,
      }),
    );
    return glyphs.length - 1;
  };

  // Each character is followed by its alternates, so a character's variants have adjacent ids.
  const altEntries: AltEntry[] = [];
  let spaceId: number | null = null;
  for (const char of ALL_CHARS) {
    const glyph = getGlyph(font, char);
    if (!glyph.shapes.length && char !== ' ') continue;
    const name = postscriptName(char);
    const base = addGlyph(glyph, name, char.codePointAt(0)!);
    if (char === ' ') spaceId = base;
    if (!glyph.shapes.length) continue;
    const alts = drawnAlternates(font, char).map((a, i) => addGlyph(a.glyph, `${name}.alt${i + 1}`));
    if (alts.length) altEntries.push({ base, alts });
  }

  const otf = new opentype.Font({
    familyName: familyName(font),
    styleName: 'Regular',
    unitsPerEm: metrics.unitsPerEm,
    ascender: metrics.ascender,
    descender: metrics.descender,
    designer: 'Font Draw',
    version: '1.0',
    glyphs,
  });
  const gsub = buildGsub(altEntries, glyphs.length, spaceId, font.cycleAlternates !== false);
  if (gsub) (otf.tables as Record<string, unknown>).gsub = gsub;
  // Take the drawn metrics as the source of truth, and keep Windows from clipping tall drawings.
  Object.assign(otf.tables.os2, {
    usWeightClass: 400,
    sCapHeight: metrics.capHeight,
    sxHeight: metrics.xHeight,
    usWinAscent: Math.ceil(yMax),
    usWinDescent: Math.ceil(Math.abs(yMin)),
  });
  return otf.toArrayBuffer();
}

export function fontFileName(font: Font) {
  const base = familyName(font).replace(/[^A-Za-z0-9-_ ]+/g, '').replace(/\s+/g, '-') || 'font';
  return `${base}-Regular.otf`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadFont(font: Font) {
  saveBlob(new Blob([buildFont(font)], { type: 'font/otf' }), fontFileName(font));
}

export function downloadProject(font: Font) {
  const json = JSON.stringify({ format: 'font-draw', version: 1, font }, null, 0);
  saveBlob(new Blob([json], { type: 'application/json' }), fontFileName(font).replace(/\.otf$/, '.fontdraw.json'));
}

export async function readProjectFile(file: File): Promise<Font> {
  const data = JSON.parse(await file.text());
  const font = data?.format === 'font-draw' ? data.font : null;
  if (!font || typeof font.name !== 'string' || typeof font.glyphs !== 'object' || !font.metrics) {
    throw new Error('Not a Font Draw project file');
  }
  return font as Font;
}
