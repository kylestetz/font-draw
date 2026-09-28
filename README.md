# Font Draw

A browser app for making real font files by drawing each glyph.

- **Library**: create, duplicate, delete, and reopen fonts. Everything is saved automatically in the browser (IndexedDB).
- **Proportional or monospace**: choose when you create a font, or switch later in the font's settings. In a monospace font every glyph shares one cell width, and the sidebearing controls move the drawing within the cell (there's also *Center in cell*). Each glyph keeps its own proportional width, so switching back loses nothing. Monospace exports are flagged as fixed-pitch (`post.isFixedPitch`, PANOSE proportion 9), so apps list them with other monospace fonts.
- **Font view**: a grid of every glyph (A–Z, a–z, 0–9, common punctuation and symbols), a live type tester that uses the font you're drawing, vertical metrics settings, and **Download .otf**.
- **Draw screen**:
  - **Pen** (P): click to place corners, drag to pull out Bézier handles, click the first point or press Enter to close. Set it to *Cut out* for counters (the hole in an O).
  - **Brush** (B): freehand strokes with an adjustable width (`[` / `]`). With **Use pen pressure** on, a pressure-sensitive stylus such as Apple Pencil varies the width as you draw, up to the brush width. Mouse and finger strokes stay a fixed width.
  - **Eraser** (E): a brush that cuts away from everything drawn before it.
  - **Select** (V): move shapes, drag points and handles, double-click a point to switch it between corner and smooth, and use the arrow keys to nudge.
  - Guides for ascender, cap height, x-height, baseline and descender, plus a grid and optional snapping.
  - A semi-transparent reference letter in a font you choose (or any font installed on your machine).
  - **Alternates**: draw extra versions of any character (Default / Alt 1 / Alt 2 … tabs), starting blank or from a copy, with the default glyph shown faintly as a guide.
  - Spacing controls (width, left/right sidebearings, auto-fit), an "in context" preview, undo/redo, and zoom/pan.
  - Prev/Next buttons, ← / → keys, and a glyph strip for moving quickly between glyphs.

## How export works

Each glyph is a stack of shapes. Brush strokes are expanded into outlines with Clipper and smoothed into curves. A pressure stroke is built from the hull of the two end circles of each segment, and the hulls are unioned into one shape. The shapes are then combined in order with paper.js boolean operations: *fill* shapes are united and *cut* shapes are subtracted. The result is clean, overlap-free Bézier contours, and the editor draws exactly that result. opentype.js writes the contours into a CFF-flavoured OpenType (`.otf`) file.

## Alternates in the exported font

Alternates are written as OpenType GSUB features:

- **`calt` (contextual alternates)** is on by default in browsers and most apps. A repeated letter uses the variant after the one its previous occurrence used, looking back up to 4 glyphs in the same word. So `lllll` comes out as l, l.alt1, l.alt2, l, l.alt1. You can turn this off per font.
- **`salt` (stylistic alternates)** lists every alternate for apps with a glyph picker, such as Illustrator and InDesign.
- **`ss01`–`ss20` (stylistic sets)**: set *N* swaps each character for its *N*th alternate.

The in-app previews use the same cycling rule, so they match the exported font.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

Built with Vite, React and TypeScript.
