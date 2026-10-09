import type { DisplayProject } from '@shared/model';
import type { FontMetrics } from '@shared/generator';

/**
 * Mide con canvas cómo coloca el editor el texto (textBaseline = 'middle') y cómo lo colocaría
 * DirectWrite centrando su caja de línea, para que el runtime Lua corrija la diferencia.
 * Todo en fracción del tamaño de fuente (independiente del tamaño).
 */
function measureFontMetrics(font: string, bold = false): FontMetrics {
  const SIZE = 100;
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  g.font = `${bold ? 'bold ' : ''}${SIZE}px "${font}", "Segoe UI", sans-serif`;
  g.textBaseline = 'alphabetic';
  const m = g.measureText('H');
  const A = m.fontBoundingBoxAscent ?? SIZE * 0.8;
  const D = m.fontBoundingBoxDescent ?? SIZE * 0.2;
  const cap = m.actualBoundingBoxAscent ?? SIZE * 0.7;
  // DirectWrite: caja de línea centrada → centro de las mayúsculas respecto al centro de la caja
  const d = ((A - D) / 2 - cap / 2) / SIZE;
  // editor: centro de las mayúsculas respecto a la línea 'middle'
  g.textBaseline = 'middle';
  const m2 = g.measureText('H');
  const e = ((m2.actualBoundingBoxDescent - m2.actualBoundingBoxAscent) / 2) / SIZE;
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return { line: r4((A + D) / SIZE), shift: r4(e - d) };
}

/** Métricas de todas las fuentes que usan los textos de un display (incluida la de reserva). */
export function fontMetricsFor(displays: DisplayProject[]): Record<string, FontMetrics> {
  const names = new Set<string>(['Segoe UI']);
  for (const d of displays) {
    for (const p of d.pages) {
      for (const el of p.elements) {
        const style = el.type === 'text' ? el.style : el.type === 'gear' ? el.config.style : null;
        if (style?.font) names.add(style.font);
      }
    }
  }
  const out: Record<string, FontMetrics> = {};
  for (const n of names) {
    try {
      out[n] = measureFontMetrics(n);
    } catch {
      /* sin canvas: el runtime usa valores por defecto */
    }
  }
  return out;
}
