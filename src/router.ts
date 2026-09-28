import { useEffect, useState } from 'react';

export type Route =
  | { name: 'library' }
  | { name: 'font'; fontId: string }
  | { name: 'glyph'; fontId: string; hex: string; variant: number };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'font' && parts[1]) {
    if (parts[2] === 'glyph' && parts[3]) {
      return { name: 'glyph', fontId: parts[1], hex: parts[3], variant: Math.max(0, Number(parts[4]) || 0) };
    }
    return { name: 'font', fontId: parts[1] };
  }
  return { name: 'library' };
}

export function useRoute() {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export const paths = {
  library: () => '#/',
  font: (fontId: string) => `#/font/${fontId}`,
  glyph: (fontId: string, hex: string, variant = 0) =>
    `#/font/${fontId}/glyph/${hex}${variant ? `/${variant}` : ''}`,
};

export function navigate(hash: string, replace = false) {
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
