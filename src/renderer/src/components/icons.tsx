/** Iconos de interfaz (trazo fino, 16 px). Sustituyen a los emoji para una estética más sobria. */

const PATHS: Record<string, string> = {
  eye: 'M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  eyeOff: 'M2 2l12 12 M6.3 6.4A2.5 2.5 0 0 0 9.6 9.7 M4.2 4.3C2.4 5.5 1 8 1 8s2.5 5 7 5c1.2 0 2.3-.3 3.2-.8 M6.5 3.2C7 3.1 7.5 3 8 3c4.5 0 7 5 7 5s-.7 1.4-2 2.7',
  lock: 'M4 7V5a4 4 0 0 1 8 0v2 M3 7h10v7H3z',
  unlock: 'M4 7V5a4 4 0 0 1 7.7-1.5 M3 7h10v7H3z',
  undo: 'M6 4 2 7.5 6 11 M2.5 7.5H10a3.5 3.5 0 0 1 0 7H8',
  redo: 'M10 4l4 3.5L10 11 M13.5 7.5H6a3.5 3.5 0 0 0 0 7h2',
  plus: 'M8 3v10 M3 8h10',
  minus: 'M3 8h10',
  fit: 'M2 6V2h4 M14 6V2h-4 M2 10v4h4 M14 10v4h-4',
  close: 'M3 3l10 10 M13 3 3 13',
  play: 'M4 2.5v11l9-5.5z',
  up: 'M8 13V3 M3.5 7.5 8 3l4.5 4.5',
  down: 'M8 3v10 M3.5 8.5 8 13l4.5-4.5',
  top: 'M3 2.5h10 M8 14V5 M4 9l4-4 4 4',
  bottom: 'M3 13.5h10 M8 2v9 M4 7l4 4 4-4',
  back: 'M10 3 5 8l5 5',
  help: 'M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14z M6 6.2a2 2 0 1 1 2.8 1.9c-.6.3-.8.7-.8 1.3 M8 12h.01',
  sliders: 'M2 4h8 M13 4h1 M10 2.5v3 M2 12h1 M6 12h8 M3 10.5v3',
  save: 'M3 2h8l2 2v10H3z M5 2v4h5V2 M5 10h6',
  folder: 'M2 4h4l1.5 1.5H14V13H2z',
  monitor: 'M2 3h12v8H2z M6 14h4 M8 11v3',
  grid: 'M2 2h5v5H2z M9 2h5v5H9z M2 9h5v5H2z M9 9h5v5H9z',
  text: 'M3 3h10 M8 3v10 M6 13h4',
  bar: 'M2 10h12v3H2z M2 10h7v3H2z',
  circle: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z',
  gauge: 'M3 12a6 6 0 1 1 10 0 M8 11l3-4',
  light: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8 1v2 M8 13v2 M1 8h2 M13 8h2',
  image: 'M2 3h12v10H2z M2 11l4-4 3 3 2-2 3 3',
  rect: 'M2 4h12v8H2z',
  line: 'M2 12 14 4',
  gear: 'M5 3h6v10H5z M8 3v10',
  icon: 'M8 2l6 11H2z M8 6.5v3 M8 11.5h.01',
  segments: 'M2 5h2v6H2z M5.5 5h2v6h-2z M9 5h2v6H9z M12.5 5h2v6h-2z',
  check: 'M3 8.5 6.5 12 13 4',
  alert: 'M8 2l6 11H2z M8 6.5v3 M8 11.5h.01',
};

export function Icon({ name, size = 16, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.help} />
    </svg>
  );
}
