declare module 'opentype.js' {
  export class Path {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    close(): void;
  }
  export class Glyph {
    constructor(options: {
      name: string;
      unicode?: number;
      unicodes?: number[];
      advanceWidth: number;
      path: Path;
    });
  }
  export class Font {
    constructor(options: {
      familyName: string;
      styleName: string;
      unitsPerEm: number;
      ascender: number;
      descender: number;
      designer?: string;
      version?: string;
      glyphs: Glyph[];
    });
    tables: { os2: Record<string, number> };
    toArrayBuffer(): ArrayBuffer;
  }
  export function parse(buffer: ArrayBuffer): {
    glyphs: { length: number };
    charToGlyph(c: string): { name: string; advanceWidth: number; path: { commands: unknown[] } };
  };
}

declare module 'clipper-lib' {
  type IntPoint = { X: number; Y: number };
  const ClipperLib: {
    ClipperOffset: new (miterLimit?: number, arcTolerance?: number) => {
      AddPath(path: IntPoint[], joinType: number, endType: number): void;
      Execute(solution: IntPoint[][], delta: number): void;
    };
    Clipper: {
      new (): {
        AddPaths(paths: IntPoint[][], polyType: number, closed: boolean): void;
        Execute(clipType: number, solution: IntPoint[][], subjFill: number, clipFill: number): boolean;
      };
      Orientation(path: IntPoint[]): boolean;
    };
    JoinType: { jtRound: number };
    EndType: { etOpenRound: number };
    ClipType: { ctUnion: number };
    PolyType: { ptSubject: number };
    PolyFillType: { pftNonZero: number };
  };
  export default ClipperLib;
}
