import { useCallback, useState } from 'react';

export type Tool = 'select' | 'pen' | 'brush' | 'eraser';

export type Prefs = {
  tool: Tool;
  brushWidth: number;
  /** Vary brush width with stylus pressure (Apple Pencil etc.). */
  usePressure: boolean;
  eraserWidth: number;
  penOp: 'add' | 'cut';
  showReference: boolean;
  referenceFont: string;
  referenceOpacity: number;
  showGrid: boolean;
  showGuides: boolean;
  snap: boolean;
};

export const REFERENCE_FONTS: { label: string; stack: string }[] = [
  { label: 'Helvetica', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'Inter', stack: 'Inter, "Helvetica Neue", Arial, sans-serif' },
  { label: 'Work Sans', stack: '"Work Sans", "Helvetica Neue", Arial, sans-serif' },
  { label: 'Georgia', stack: 'Georgia, serif' },
  { label: 'Times', stack: '"Times New Roman", Times, serif' },
  { label: 'Playfair Display', stack: '"Playfair Display", Georgia, serif' },
  { label: 'DM Serif Display', stack: '"DM Serif Display", Georgia, serif' },
  { label: 'Space Mono', stack: '"Space Mono", "Courier New", monospace' },
  { label: 'Courier', stack: '"Courier New", Courier, monospace' },
  { label: 'Caveat (handwritten)', stack: 'Caveat, cursive' },
];

const DEFAULTS: Prefs = {
  tool: 'brush',
  brushWidth: 80,
  usePressure: true,
  eraserWidth: 60,
  penOp: 'add',
  showReference: true,
  referenceFont: REFERENCE_FONTS[0].stack,
  referenceOpacity: 0.14,
  showGrid: true,
  showGuides: true,
  snap: false,
};

const KEY = 'font-draw:prefs';

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return DEFAULTS;
  }
}

export function usePrefs() {
  const [prefs, setPrefs] = useState(load);
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);
  return [prefs, update] as const;
}
