import { useSyncExternalStore } from 'react';
import { get, set } from 'idb-keyval';
import type { Font, Glyph, Metrics } from './types';
import { defaultAdvance } from './glyphs';

const STORAGE_KEY = 'font-draw:fonts';

type State = { loaded: boolean; fonts: Font[] };

let state: State = { loaded: false, fonts: [] };
const listeners = new Set<() => void>();

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

let saveTimer: number | undefined;
function scheduleSave() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    set(STORAGE_KEY, state.fonts).catch((err) => console.error('Failed to save fonts', err));
  }, 300);
}
window.addEventListener('beforeunload', () => {
  if (saveTimer !== undefined) set(STORAGE_KEY, state.fonts);
});

export async function loadFonts() {
  let fonts: Font[] = [];
  try {
    fonts = (await get<Font[]>(STORAGE_KEY)) ?? [];
  } catch (err) {
    console.error('Failed to load fonts', err);
  }
  emit({ loaded: true, fonts });
}

export function useStore() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export function useFont(id: string | undefined) {
  const { fonts, loaded } = useStore();
  return { font: fonts.find((f) => f.id === id), loaded };
}

export const DEFAULT_METRICS: Metrics = {
  unitsPerEm: 1000,
  ascender: 800,
  capHeight: 700,
  xHeight: 500,
  descender: -200,
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function updateFonts(fn: (fonts: Font[]) => Font[]) {
  emit({ ...state, fonts: fn(state.fonts) });
  scheduleSave();
}

function patchFont(id: string, fn: (font: Font) => Font) {
  updateFonts((fonts) => fonts.map((f) => (f.id === id ? { ...fn(f), updatedAt: Date.now() } : f)));
}

export function createFont(): Font {
  const n = state.fonts.length + 1;
  const font: Font = {
    id: uid(),
    name: `Untitled ${n}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metrics: { ...DEFAULT_METRICS },
    glyphs: {},
  };
  updateFonts((fonts) => [font, ...fonts]);
  return font;
}

export function importFont(data: Font): Font {
  const font: Font = { ...data, id: uid(), updatedAt: Date.now() };
  updateFonts((fonts) => [font, ...fonts]);
  return font;
}

export function duplicateFont(id: string) {
  const src = state.fonts.find((f) => f.id === id);
  if (!src) return;
  const copy: Font = {
    ...structuredClone(src),
    id: uid(),
    name: `${src.name} copy`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  updateFonts((fonts) => [copy, ...fonts]);
}

export function deleteFont(id: string) {
  updateFonts((fonts) => fonts.filter((f) => f.id !== id));
}

export function renameFont(id: string, name: string) {
  patchFont(id, (f) => ({ ...f, name }));
}

export function setMetrics(id: string, metrics: Partial<Metrics>) {
  patchFont(id, (f) => ({ ...f, metrics: { ...f.metrics, ...metrics } }));
}

/** Variant 0 is the default glyph; 1… are alternates. */
export function getGlyph(font: Font, char: string, variant = 0): Glyph {
  if (variant > 0) {
    const alt = font.alternates?.[char]?.[variant - 1];
    if (alt) return alt;
  }
  return font.glyphs[char] ?? EMPTY_GLYPHS(char);
}

export const variantCount = (font: Font, char: string) => 1 + (font.alternates?.[char]?.length ?? 0);

/** Alternates that have something drawn in them, with their variant numbers. */
export function drawnAlternates(font: Font, char: string) {
  return (font.alternates?.[char] ?? []).flatMap((g, i) => (g.shapes.length ? [{ glyph: g, variant: i + 1 }] : []));
}

// Stable empty glyph objects so memoized consumers don't recompute.
const emptyCache = new Map<string, Glyph>();
function EMPTY_GLYPHS(char: string): Glyph {
  let g = emptyCache.get(char);
  if (!g) {
    g = { shapes: [], advance: defaultAdvance(char) };
    emptyCache.set(char, g);
  }
  return g;
}

export function setGlyph(fontId: string, char: string, glyph: Glyph, variant = 0) {
  patchFont(fontId, (f) => {
    if (variant === 0) return { ...f, glyphs: { ...f.glyphs, [char]: glyph } };
    const alts = [...(f.alternates?.[char] ?? [])];
    alts[variant - 1] = glyph;
    return { ...f, alternates: { ...f.alternates, [char]: alts } };
  });
}

/** Adds an alternate (a copy of `from`, or blank at the default glyph's width); returns its variant. */
export function addAlternate(fontId: string, char: string, from?: Glyph): number {
  const font = state.fonts.find((f) => f.id === fontId)!;
  const alts = font.alternates?.[char] ?? [];
  const glyph: Glyph = from
    ? { ...from, shapes: from.shapes.map((s) => ({ ...s, id: uid() })) }
    : { shapes: [], advance: getGlyph(font, char).advance };
  patchFont(fontId, (f) => ({ ...f, alternates: { ...f.alternates, [char]: [...alts, glyph] } }));
  return alts.length + 1;
}

export function deleteAlternate(fontId: string, char: string, variant: number) {
  patchFont(fontId, (f) => {
    const alts = (f.alternates?.[char] ?? []).filter((_, i) => i !== variant - 1);
    const alternates = { ...f.alternates, [char]: alts };
    if (!alts.length) delete alternates[char];
    return { ...f, alternates };
  });
}

export function setCycleAlternates(fontId: string, cycleAlternates: boolean) {
  patchFont(fontId, (f) => ({ ...f, cycleAlternates }));
}

export const isDrawn = (font: Font, char: string) => (font.glyphs[char]?.shapes.length ?? 0) > 0;
