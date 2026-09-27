import type { Font, Glyph } from '../types';
import { glyphSvgPath } from '../geometry/outline';
import { getGlyph } from '../store';

/** A single glyph centered in a square em box. */
export function GlyphThumb({ font, glyph, className }: { font: Font; glyph: Glyph; className?: string }) {
  const { ascender, descender } = font.metrics;
  const h = ascender - descender;
  const cx = glyph.advance / 2;
  return (
    <svg className={className} viewBox={`${cx - h / 2} ${-ascender} ${h} ${h}`} aria-hidden>
      <path d={glyphSvgPath(glyph.shapes)} transform="scale(1,-1)" />
    </svg>
  );
}

/** A run of glyphs set with their advance widths, like a line of text. */
export function GlyphRun({
  font,
  text,
  highlight,
  className,
  padding = 0,
}: {
  font: Font;
  text: string;
  /** Tint the background behind every occurrence of this character. */
  highlight?: string;
  className?: string;
  padding?: number;
}) {
  const { ascender, descender } = font.metrics;
  let x = 0;
  const items = [...text].map((char, i) => {
    const glyph = getGlyph(font, char);
    const item = (
      <g key={i} transform={`translate(${x} 0) scale(1,-1)`}>
        {highlight === char && (
          <rect x={0} y={descender} width={glyph.advance} height={ascender - descender} className="run-highlight" />
        )}
        <path d={glyphSvgPath(glyph.shapes)} />
      </g>
    );
    x += glyph.advance;
    return item;
  });
  const width = Math.max(x, 1);
  return (
    <svg
      className={className}
      viewBox={`${-padding} ${-ascender - padding} ${width + padding * 2} ${ascender - descender + padding * 2}`}
      aria-hidden
    >
      {items}
    </svg>
  );
}
