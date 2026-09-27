export type GlyphGroup = { id: string; label: string; chars: string[] };

const range = (from: string, to: string) => {
  const out: string[] = [];
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) out.push(String.fromCharCode(c));
  return out;
};

export const GLYPH_GROUPS: GlyphGroup[] = [
  { id: 'upper', label: 'Uppercase', chars: range('A', 'Z') },
  { id: 'lower', label: 'Lowercase', chars: range('a', 'z') },
  { id: 'digits', label: 'Numerals', chars: range('0', '9') },
  {
    id: 'punct',
    label: 'Punctuation',
    chars: [...'.,:;!?\'"‘’“”-–—()[]{}/\\…', ' '],
  },
  { id: 'symbols', label: 'Symbols', chars: [...'&@#$%*+=<>_~^`|€£°•©'] },
];

export const ALL_CHARS: string[] = GLYPH_GROUPS.flatMap((g) => g.chars);

export const groupOf = (char: string) => GLYPH_GROUPS.find((g) => g.chars.includes(char))!;

export const codeHex = (char: string) =>
  char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');

export const charFromHex = (hex: string) => String.fromCodePoint(parseInt(hex, 16));

const NAMES: Record<string, string> = {
  ' ': 'Space',
  '.': 'Period',
  ',': 'Comma',
  ':': 'Colon',
  ';': 'Semicolon',
  '!': 'Exclamation',
  '?': 'Question',
  "'": 'Apostrophe',
  '"': 'Quote',
  '‘': 'Left single quote',
  '’': 'Right single quote',
  '“': 'Left double quote',
  '”': 'Right double quote',
  '-': 'Hyphen',
  '–': 'En dash',
  '—': 'Em dash',
  '(': 'Left paren',
  ')': 'Right paren',
  '[': 'Left bracket',
  ']': 'Right bracket',
  '{': 'Left brace',
  '}': 'Right brace',
  '/': 'Slash',
  '\\': 'Backslash',
  '…': 'Ellipsis',
  '&': 'Ampersand',
  '@': 'At',
  '#': 'Number sign',
  $: 'Dollar',
  '%': 'Percent',
  '*': 'Asterisk',
  '+': 'Plus',
  '=': 'Equals',
  '<': 'Less than',
  '>': 'Greater than',
  _: 'Underscore',
  '~': 'Tilde',
  '^': 'Caret',
  '`': 'Grave',
  '|': 'Bar',
  '€': 'Euro',
  '£': 'Pound',
  '°': 'Degree',
  '•': 'Bullet',
  '©': 'Copyright',
};

export function describeChar(char: string) {
  if (NAMES[char]) return NAMES[char];
  if (/[A-Z]/.test(char)) return `Capital ${char}`;
  if (/[a-z]/.test(char)) return `Small ${char}`;
  if (/[0-9]/.test(char)) return `Digit ${char}`;
  return char;
}

const DIGIT_NAMES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** PostScript glyph name used in the exported font. */
export function postscriptName(char: string) {
  if (/[A-Za-z]/.test(char)) return char;
  if (/[0-9]/.test(char)) return DIGIT_NAMES[Number(char)];
  if (char === ' ') return 'space';
  return `uni${codeHex(char)}`;
}

const NARROW = new Set([...".,:;!'|‘’`()[]{}"]);

export function defaultAdvance(char: string) {
  if (char === ' ') return 260;
  if (/[A-Z]/.test(char)) return char === 'I' ? 300 : char === 'M' || char === 'W' ? 860 : 680;
  if (/[a-z]/.test(char)) return /[ijlf t]/.test(char) ? 300 : char === 'm' || char === 'w' ? 820 : 560;
  if (/[0-9]/.test(char)) return 600;
  if (char === '—') return 1000;
  if (char === '…') return 800;
  if (NARROW.has(char)) return 300;
  return 560;
}
