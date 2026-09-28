export type Vec = { x: number; y: number };

/** A pen-path anchor. Handles are offsets relative to the anchor; null means no handle. */
export type PathNode = {
  x: number;
  y: number;
  in: Vec | null;
  out: Vec | null;
};

/** 'add' fills the shape; 'cut' removes it from everything drawn before it. */
export type ShapeOp = 'add' | 'cut';

export type PenShape = {
  id: string;
  kind: 'pen';
  op: ShapeOp;
  nodes: PathNode[];
};

export type BrushShape = {
  id: string;
  kind: 'brush';
  op: ShapeOp;
  width: number;
  /** Flat list of x,y pairs in font units. */
  points: number[];
  /**
   * Stylus pressure per point (0–1), present when the stroke was drawn with pen pressure on.
   * `width` is then the width at full pressure.
   */
  pressures?: number[];
};

export type Shape = PenShape | BrushShape;

export type Glyph = {
  shapes: Shape[];
  advance: number;
};

export type Metrics = {
  unitsPerEm: number;
  ascender: number;
  capHeight: number;
  xHeight: number;
  descender: number;
};

export type Font = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  metrics: Metrics;
  /** Keyed by the glyph's character. Missing entries have never been touched. */
  glyphs: Record<string, Glyph>;
  /** Alternate drawings per character (variant 1 is index 0). */
  alternates?: Record<string, Glyph[]>;
  /**
   * When set, the font is monospaced: every glyph is this wide, whatever its own `advance` says.
   * Each glyph keeps its proportional width, so switching back loses nothing.
   */
  monoWidth?: number;
  /** Cycle through alternates automatically as you type (OpenType `calt`). Defaults to on. */
  cycleAlternates?: boolean;
};
