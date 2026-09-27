import { useRoute } from './router';
import { useStore } from './store';
import { Library } from './screens/Library';
import { FontView } from './screens/FontView';
import { DrawScreen } from './screens/DrawScreen';
import { charFromHex } from './glyphs';

export function App() {
  const route = useRoute();
  const { loaded, fonts } = useStore();
  if (!loaded) return <div className="loading">Loading…</div>;

  if (route.name === 'library') return <Library />;
  const font = fonts.find((f) => f.id === route.fontId);
  if (!font) return <Library notFound />;
  if (route.name === 'glyph') return <DrawScreen key={font.id} font={font} char={charFromHex(route.hex)} />;
  return <FontView font={font} />;
}
