import { useEffect, useRef, useState } from 'react';
import { DEFAULT_MONO_WIDTH, createFont, nextFontName } from '../store';
import { navigate, paths } from '../router';
import { NumberField } from './NumberField';

type Spacing = 'proportional' | 'monospace';

const OPTIONS: { id: Spacing; title: string; body: string; sample: string }[] = [
  {
    id: 'proportional',
    title: 'Proportional',
    body: 'Each glyph gets its own width, so an i is narrow and an m is wide. Most text fonts work this way.',
    sample: 'illumination',
  },
  {
    id: 'monospace',
    title: 'Monospace',
    body: 'Every glyph sits in a cell of the same width, like a typewriter or a code font. You can switch later.',
    sample: 'illumination',
  },
];

export function NewFontDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [spacing, setSpacing] = useState<Spacing>('proportional');
  const [monoWidth, setMonoWidth] = useState(DEFAULT_MONO_WIDTH);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = () => {
    const font = createFont({ name, monoWidth: spacing === 'monospace' ? monoWidth : undefined });
    navigate(paths.font(font.id));
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog"
        role="dialog"
        aria-label="New font"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <div className="dialog-head">
          <span className="panel-title">New font</span>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="dialog-body">
          <label className="field">
            <span>Name</span>
            <input ref={nameRef} value={name} placeholder={nextFontName()} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          </label>
          <div className="field">
            <span>Spacing</span>
            <div className="spacing-options">
              {OPTIONS.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  className={spacing === o.id ? 'spacing-option active' : 'spacing-option'}
                  onClick={() => setSpacing(o.id)}
                  aria-pressed={spacing === o.id}
                >
                  <span className={`spacing-sample ${o.id}`}>{o.sample}</span>
                  <span className="spacing-title">{o.title}</span>
                  <span className="spacing-body">{o.body}</span>
                </button>
              ))}
            </div>
          </div>
          {spacing === 'monospace' && (
            <div className="mono-width">
              <NumberField label="Cell width" value={monoWidth} min={50} max={3000} step={10} onChange={setMonoWidth} suffix="u" />
              <p className="muted small">
                In font units, out of a 1000-unit em. 600 is typical (Courier, most code fonts); go
                narrower for a condensed look.
              </p>
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary">
            Create font
          </button>
        </div>
      </form>
    </div>
  );
}
