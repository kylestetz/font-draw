import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadFonts } from './store';
import './styles.css';

loadFonts();
createRoot(document.getElementById('root')!).render(<App />);
