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

export function getGlyph(font: Font, char: string): Glyph {
  return font.glyphs[char] ?? EMPTY_GLYPHS(char);
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

export function setGlyph(fontId: string, char: string, glyph: Glyph) {
  patchFont(fontId, (f) => ({ ...f, glyphs: { ...f.glyphs, [char]: glyph } }));
}

export const isDrawn = (font: Font, char: string) => (font.glyphs[char]?.shapes.length ?? 0) > 0;
