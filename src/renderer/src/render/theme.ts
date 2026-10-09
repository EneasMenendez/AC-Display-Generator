/**
 * Colores de la interfaz leídos de las variables CSS (styles.css), para que lo que se dibuja sobre
 * el lienzo (fondo, selección, guías, área visible) siga el mismo tema que el resto del programa y
 * no haya dos paletas que mantener.
 */

const cache = new Map<string, string>();

/** Olvida los colores leídos (al cambiar el aspecto desde los ajustes). */
export function resetThemeCache(): void {
  cache.clear();
}

function cssVar(name: string, fallback: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = v || fallback;
  cache.set(name, value);
  return value;
}

/** Color con transparencia a partir de un token (#rrggbb). */
function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export const theme = {
  /** fondo del área de trabajo */
  get bg(): string {
    return cssVar('--bg', '#0d0e10');
  },
  /** acento: selección y tiradores */
  get accent(): string {
    return cssVar('--accent', '#f0a73a');
  },
  get accentFill(): string {
    return alpha(theme.accent, 0.12);
  },
  /** elementos bloqueados */
  get warn(): string {
    return cssVar('--warn', '#d6a03f');
  },
  /** chrome discreto: marco del área visible y su etiqueta */
  get dim(): string {
    return cssVar('--text-3', '#5e636b');
  },
  get dimText(): string {
    return cssVar('--text-2', '#92979f');
  },
  get warnFill(): string {
    return alpha(theme.warn, 0.33);
  },
  /** líneas sobrias: borde del display y rejilla */
  get outline(): string {
    return cssVar('--line-2', '#26282d');
  },
  get grid(): string {
    return 'rgba(255,255,255,0.05)';
  },
  /** guías de alineación */
  get guide(): string {
    return '#d46bb3';
  },
  /** velo sobre lo que la malla no muestra (en previsualización lo tapa del todo) */
  get veil(): string {
    return 'rgba(0,0,0,0.72)';
  },
  get veilSolid(): string {
    return '#000';
  },
};
