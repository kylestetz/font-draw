/**
 * OpenType alternates.
 *
 * Every character can have alternate drawings. They're exposed three ways in the exported font:
 *  - `calt` (contextual alternates, on by default in browsers and most apps): a repeated letter uses
 *    the next variant after the one used by its previous occurrence, looking back a few glyphs within
 *    the same word. "hello" gets two different l's; "banana" cycles its a's.
 *  - `salt` (stylistic alternates): lists every alternate, for apps with a glyph picker.
 *  - `ss01`…`ss20` (stylistic sets): set N swaps each character for its Nth alternate.
 *
 * `cycleVariants` mirrors the `calt` rules so in-app previews match the real font.
 */
import type { Font, Glyph } from './types';
import { drawnAlternates, getGlyph, isDrawn } from './store';

/** How far back (in glyphs) `calt` looks for the previous occurrence of the same letter. */
export const MAX_LOOKBACK = 4;

// ---------- preview ----------

export type SetGlyph = { char: string; variant: number; glyph: Glyph };

/** Lays out text the way the exported font's `calt` feature will. */
export function cycleVariants(font: Font, text: string, lookback = MAX_LOOKBACK): SetGlyph[] {
  const chars = [...text];
  const cycle = font.cycleAlternates !== false;
  const out: SetGlyph[] = [];
  const altCache = new Map<string, ReturnType<typeof drawnAlternates>>();
  const alts = (c: string) => {
    if (!altCache.has(c)) altCache.set(c, isDrawn(font, c) ? drawnAlternates(font, c) : []);
    return altCache.get(c)!;
  };

  chars.forEach((char, i) => {
    const list = alts(char);
    let index = 0; // 0 = default, k = list[k-1]
    if (cycle && list.length) {
      for (let d = 1; d <= lookback && i - d >= 0; d++) {
        const prev = chars[i - d];
        if (prev === ' ') break;
        if (prev === char) {
          index = (out[i - d].variant === 0 ? 0 : list.findIndex((a) => a.variant === out[i - d].variant) + 1) + 1;
          index %= list.length + 1;
          break;
        }
      }
    }
    const variant = index === 0 ? 0 : list[index - 1].variant;
    out.push({ char, variant, glyph: getGlyph(font, char, variant) });
  });
  return out;
}

// ---------- GSUB ----------

export type AltEntry = { base: number; alts: number[] };

type Coverage = { format: 1; glyphs: number[] } | { format: 2; ranges: { start: number; end: number; index: number }[] };

const single = (id: number): Coverage => ({ format: 1, glyphs: [id] });

/** Every glyph id except the excluded ones, as ranges. */
function allExcept(glyphCount: number, excluded: Set<number>): Coverage {
  const ranges: { start: number; end: number; index: number }[] = [];
  let index = 0;
  let start = -1;
  for (let id = 0; id <= glyphCount; id++) {
    const inSet = id < glyphCount && !excluded.has(id);
    if (inSet && start < 0) start = id;
    if (!inSet && start >= 0) {
      ranges.push({ start, end: id - 1, index });
      index += id - start;
      start = -1;
    }
  }
  return { format: 2, ranges };
}

/** Rough byte size of one chain-context subtable with `d` backtrack glyphs (see opentype.js writer). */
const chainSize = (d: number) => 18 * d + 12;

/** Size budget for the `calt` lookups; GSUB uses 16-bit offsets, so stay well under 64 KB. */
const CALT_BUDGET = 48_000;

export function buildGsub(entries: AltEntry[], glyphCount: number, spaceId: number | null, cycle: boolean) {
  if (!entries.length) return null;
  entries = [...entries].sort((a, b) => a.base - b.base);
  const maxAlts = Math.max(...entries.map((e) => e.alts.length));

  type Lookup = { lookupType: number; lookupFlag: number; subtables: unknown[] };
  const lookups: Lookup[] = [];

  // Single substitutions: base → Nth alternate. Used by the stylistic sets and by `calt`.
  const singleLookup: number[] = [];
  for (let n = 1; n <= maxAlts; n++) {
    const withN = entries.filter((e) => e.alts.length >= n);
    singleLookup[n] = lookups.length;
    lookups.push({
      lookupType: 1,
      lookupFlag: 0,
      subtables: [
        {
          substFormat: 2,
          coverage: { format: 1, glyphs: withN.map((e) => e.base) },
          substitute: withN.map((e) => e.alts[n - 1]),
        },
      ],
    });
  }

  const saltLookup = lookups.length;
  lookups.push({
    lookupType: 3,
    lookupFlag: 0,
    subtables: [
      {
        substFormat: 1,
        coverage: { format: 1, glyphs: entries.map((e) => e.base) },
        alternateSets: entries.map((e) => e.alts),
      },
    ],
  });

  const caltLookups: number[] = [];
  if (cycle) {
    // Look back as far as the size budget allows.
    const variantTotal = entries.reduce((sum, e) => sum + e.alts.length + 1, 0);
    let lookback = MAX_LOOKBACK;
    const cost = (l: number) =>
      variantTotal * Array.from({ length: l }, (_, i) => chainSize(i + 1)).reduce((a, b) => a + b, 0) +
      entries.length * 8;
    while (lookback > 1 && cost(lookback) > CALT_BUDGET) lookback--;

    // One lookup per character keeps each lookup small; they never interact because each rule only
    // looks at variants of its own character.
    for (const e of entries) {
      const variants = [e.base, ...e.alts];
      const excluded = new Set(variants);
      if (spaceId !== null) excluded.add(spaceId);
      const others = allExcept(glyphCount, excluded);
      const subtables = [];
      // Nearest previous occurrence wins, so try shorter distances first.
      for (let d = 1; d <= lookback; d++) {
        for (let k = 0; k < variants.length; k++) {
          const next = (k + 1) % variants.length;
          subtables.push({
            substFormat: 3,
            // Backtrack is listed nearest-first.
            backtrackCoverage: [...Array.from({ length: d - 1 }, () => others), single(variants[k])],
            inputCoverage: [single(e.base)],
            lookaheadCoverage: [],
            // Cycling back to the default glyph still has to match (so farther rules don't), it
            // just substitutes nothing.
            lookupRecords: next === 0 ? [] : [{ sequenceIndex: 0, lookupListIndex: singleLookup[next] }],
          });
        }
      }
      caltLookups.push(lookups.length);
      lookups.push({ lookupType: 6, lookupFlag: 0, subtables });
    }
  }

  // Feature tags must be in alphabetical order.
  const features: { tag: string; feature: { featureParams: number; lookupListIndexes: number[] } }[] = [];
  if (caltLookups.length) features.push({ tag: 'calt', feature: { featureParams: 0, lookupListIndexes: caltLookups } });
  features.push({ tag: 'salt', feature: { featureParams: 0, lookupListIndexes: [saltLookup] } });
  for (let n = 1; n <= Math.min(maxAlts, 20); n++) {
    features.push({
      tag: `ss${String(n).padStart(2, '0')}`,
      feature: { featureParams: 0, lookupListIndexes: [singleLookup[n]] },
    });
  }

  const langSys = () => ({ reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: features.map((_, i) => i) });
  return {
    version: 1,
    scripts: [
      { tag: 'DFLT', script: { defaultLangSys: langSys(), langSysRecords: [] } },
      { tag: 'latn', script: { defaultLangSys: langSys(), langSysRecords: [] } },
    ],
    features,
    lookups,
  };
}
