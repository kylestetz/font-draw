# Font Draw

A browser app for making real font files by drawing each glyph.

- **Library**: create, duplicate, delete, and reopen fonts. Everything is saved automatically in the browser (IndexedDB).
- **Font view**: a grid of every glyph (A–Z, a–z, 0–9, common punctuation and symbols), a live type tester that uses the font you're drawing, vertical metrics settings, and **Download .otf**.
- **Draw screen**:
  - **Pen** (P): click to place corners, drag to pull out Bézier handles, click the first point or press Enter to close. Set it to *Cut out* for counters (the hole in an O).
  - **Brush** (B): freehand strokes with an adjustable width (`[` / `]`).
  - **Eraser** (E): a brush that cuts away from everything drawn before it.
  - **Select** (V): move shapes, drag points and handles, double-click a point to switch it between corner and smooth, and use the arrow keys to nudge.
  - Guides for ascender, cap height, x-height, baseline and descender, plus a grid and optional snapping.
  - A semi-transparent reference letter in a font you choose (or any font installed on your machine).
  - Spacing controls (width, left/right sidebearings, auto-fit), an "in context" preview, undo/redo, and zoom/pan.
  - Prev/Next buttons, ← / → keys, and a glyph strip for moving quickly between glyphs.

## How export works

Each glyph is a stack of shapes. Brush strokes are expanded into outlines with Clipper and smoothed into curves. The shapes are then combined in order with paper.js boolean operations: *fill* shapes are united and *cut* shapes are subtracted. The result is clean, overlap-free Bézier contours, and the editor draws exactly that result. opentype.js writes the contours into a CFF-flavoured OpenType (`.otf`) file.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

Built with Vite, React and TypeScript.
