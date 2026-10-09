import type { AppSettings } from '@shared/types';
import { resetThemeCache } from './render/theme';

/**
 * Aspecto de la aplicación: color de acento y profundidad del fondo. Se aplica escribiendo las
 * variables CSS de styles.css, así que todo (interfaz y lo que se dibuja sobre el lienzo) cambia a
 * la vez. El acento puede venir de Content Manager: si el usuario lo ha personalizado allí, la
 * aplicación se pone a juego al arrancar.
 */

export const ACCENT_PRESETS: Record<string, string> = {
  amber: '#F0A73A',
  blue: '#4F8CFF',
  green: '#58B878',
  red: '#E0564F',
};

export const DEFAULT_ACCENT = ACCENT_PRESETS.amber;

/** Fondos: mismo diseño, más o menos profundo según el monitor y la luz de la habitación. */
export const BACKGROUNDS: Record<string, { label: string; bg: string; bg2: string; bg3: string; bg4: string; line: string; line2: string }> = {
  deep: { label: 'Profundo', bg: '#08090a', bg2: '#0d0e10', bg3: '#131416', bg4: '#191a1e', line: '#16171a', line2: '#212328' },
  normal: { label: 'Normal', bg: '#0d0e10', bg2: '#121316', bg3: '#17181b', bg4: '#1e2024', line: '#1b1c20', line2: '#26282d' },
  soft: { label: 'Suave', bg: '#131417', bg2: '#191a1e', bg3: '#202227', bg4: '#282b31', line: '#232529', line2: '#303339' },
};

/** Color del texto que va encima del acento: tinta oscura salvo que el acento sea muy oscuro. */
function onAccent(hex: string): string {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.55 ? '#16171a' : '#ffffff';
}

function rgba(hex: string, a: number): string {
  const n = hex.replace('#', '');
  return `rgba(${parseInt(n.slice(0, 2), 16)}, ${parseInt(n.slice(2, 4), 16)}, ${parseInt(n.slice(4, 6), 16)}, ${a})`;
}

/** Acento efectivo según los ajustes (y lo leído de Content Manager). */
export function resolveAccent(settings: Pick<AppSettings, 'accent'>, cmAccent: string | null): string {
  const a = settings.accent ?? 'cm';
  if (a === 'cm') return cmAccent ?? DEFAULT_ACCENT;
  if (ACCENT_PRESETS[a]) return ACCENT_PRESETS[a];
  return /^#[0-9a-f]{6}$/i.test(a) ? a.toUpperCase() : DEFAULT_ACCENT;
}

/** Escribe las variables CSS del tema a partir de los ajustes. */
export function applyAppearance(settings: Pick<AppSettings, 'accent' | 'background'>, cmAccent: string | null): void {
  const accent = resolveAccent(settings, cmAccent);
  const bg = BACKGROUNDS[settings.background ?? 'normal'] ?? BACKGROUNDS.normal;
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-soft', rgba(accent, 0.12));
  root.setProperty('--on-accent', onAccent(accent));
  root.setProperty('--bg', bg.bg);
  root.setProperty('--bg-2', bg.bg2);
  root.setProperty('--bg-3', bg.bg3);
  root.setProperty('--bg-4', bg.bg4);
  root.setProperty('--line', bg.line);
  root.setProperty('--line-2', bg.line2);
  // el lienzo lee estos mismos colores y los tenía cacheados
  resetThemeCache();
}
