import type { AppSettings, BackgroundImage } from '@shared/types';
import { resetThemeCache } from './render/theme';

/**
 * Aspecto de la aplicación: color de acento, profundidad del fondo e imagen de fondo opcional. Se
 * aplica escribiendo las variables CSS de styles.css, así que todo (interfaz y lo que se dibuja
 * sobre el lienzo) cambia a la vez. Con imagen, los tres niveles pasan a marcar cuánta imagen se ve
 * a través de la interfaz.
 */

export const ACCENT_PRESETS: Record<string, string> = {
  amber: '#F0A73A',
  blue: '#4F8CFF',
  green: '#58B878',
  red: '#E0564F',
};

export const DEFAULT_ACCENT = ACCENT_PRESETS.amber;

/**
 * Fondos: mismo diseño, más o menos profundo según el monitor y la luz de la habitación. Con una
 * imagen de fondo, `alpha` es lo que deja ver de ella el lienzo y los paneles.
 */
export const BACKGROUNDS: Record<string, { label: string; bg: string; bg2: string; bg3: string; bg4: string; line: string; line2: string; alpha: [number, number] }> = {
  deep: { label: 'Profundo', bg: '#08090a', bg2: '#0d0e10', bg3: '#131416', bg4: '#191a1e', line: '#16171a', line2: '#212328', alpha: [0.9, 0.95] },
  normal: { label: 'Normal', bg: '#0d0e10', bg2: '#121316', bg3: '#17181b', bg4: '#1e2024', line: '#1b1c20', line2: '#26282d', alpha: [0.74, 0.87] },
  soft: { label: 'Suave', bg: '#131417', bg2: '#191a1e', bg3: '#202227', bg4: '#282b31', line: '#232529', line2: '#303339', alpha: [0.5, 0.72] },
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

let objectUrl: string | null = null;

/**
 * URL utilizable en CSS para la imagen de fondo. Se crea un blob: un data URL de varios MB no cabe
 * en una variable CSS (Chromium lo descarta y el fondo se queda en blanco).
 */
export function backgroundObjectUrl(image: BackgroundImage | null): string | null {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  if (!image?.data?.length) return null;
  objectUrl = URL.createObjectURL(new Blob([new Uint8Array(image.data)], { type: image.mime || 'image/jpeg' }));
  return objectUrl;
}

/** Acento efectivo según los ajustes. */
export function resolveAccent(settings: Pick<AppSettings, 'accent'>): string {
  const a = settings.accent ?? 'amber';
  if (ACCENT_PRESETS[a]) return ACCENT_PRESETS[a];
  return /^#[0-9a-f]{6}$/i.test(a) ? a.toUpperCase() : DEFAULT_ACCENT;
}

/** Escribe las variables CSS del tema a partir de los ajustes y la imagen de fondo. */
export function applyAppearance(settings: Pick<AppSettings, 'accent' | 'background'>, backgroundUrl: string | null): void {
  const accent = resolveAccent(settings);
  const bg = BACKGROUNDS[settings.background ?? 'normal'] ?? BACKGROUNDS.normal;
  const root = document.documentElement.style;
  root.setProperty('--accent', accent);
  root.setProperty('--accent-soft', rgba(accent, 0.12));
  root.setProperty('--on-accent', onAccent(accent));
  // con imagen, el lienzo y los paneles se vuelven translúcidos; los campos y las tarjetas siguen
  // opacos para que el texto no pelee con la foto
  root.setProperty('--bg', backgroundUrl ? rgba(bg.bg, bg.alpha[0]) : bg.bg);
  root.setProperty('--bg-2', backgroundUrl ? rgba(bg.bg2, bg.alpha[1]) : bg.bg2);
  // tarjetas, listas y diálogos: siempre algo más opacos que los paneles, para que el texto se lea
  // encima de cualquier foto
  root.setProperty('--surface', backgroundUrl ? rgba(bg.bg2, Math.min(0.97, bg.alpha[1] + 0.14)) : bg.bg2);
  root.setProperty('--bg-3', bg.bg3);
  root.setProperty('--bg-4', bg.bg4);
  root.setProperty('--line', bg.line);
  root.setProperty('--line-2', bg.line2);
  document.documentElement.style.setProperty('--app-image', backgroundUrl ? `url("${backgroundUrl}")` : 'none');
  document.documentElement.classList.toggle('has-background', !!backgroundUrl);
  // el lienzo lee estos mismos colores y los tenía cacheados
  resetThemeCache();
}
