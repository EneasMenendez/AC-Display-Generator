import type { DisplayDef } from './profile';
import type { Kn5Mesh } from './types';

/**
 * Área visible del display: la parte de la textura que la malla muestra realmente (su rectángulo UV).
 * La textura completa es lo que renderiza CSP (el lienzo del editor); si la malla solo usa una franja,
 * lo que se dibuje fuera de ella no se ve en el coche.
 */

export interface UvRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_REGION: UvRegion = { x: 0, y: 0, width: 1, height: 1 };

/** true si el área visible no es (casi) toda la textura. */
export function hasUvRegion(def: Pick<DisplayDef, 'uv_region'> | undefined | null): boolean {
  const r = def?.uv_region;
  if (!r) return false;
  // tolerancia del 1 %: los bordes de las mallas suelen quedar a unos píxeles del límite de la textura
  return r.x > 0.01 || r.y > 0.01 || r.x + r.width < 0.99 || r.y + r.height < 0.99;
}

/** Área visible en píxeles de la textura. */
export function uvRegionPx(def: Pick<DisplayDef, 'uv_region' | 'texture_size'>): { x: number; y: number; width: number; height: number } {
  const r = def.uv_region ?? FULL_REGION;
  const W = def.texture_size.width;
  const H = def.texture_size.height;
  const x = Math.round(r.x * W);
  const y = Math.round(r.y * H);
  return { x, y, width: Math.max(1, Math.round((r.x + r.width) * W) - x), height: Math.max(1, Math.round((r.y + r.height) * H) - y) };
}

/** Píxeles → región normalizada (redondeada a 4 decimales). */
export function regionFromPx(px: { x: number; y: number; width: number; height: number }, texture: { width: number; height: number }): UvRegion {
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  return {
    x: r4(px.x / texture.width),
    y: r4(px.y / texture.height),
    width: r4(px.width / texture.width),
    height: r4(px.height / texture.height),
  };
}

/**
 * Región a partir del rectángulo UV de la malla del kn5. La GPU muestrea la textura con
 * coordenadas envueltas (v mod 1, 0 = fila superior), así que las filas visibles son {v mod 1}:
 * vale tanto para mallas con V negativa (exportadas desde FBX, v ∈ [-1, 0]) como positiva.
 * Si el rectángulo cubre más de una repetición o cruza un borde de la textura (texturas
 * repetidas, mallas con bisel) no es fiable y se devuelve null.
 */
export function regionFromKn5Uv(uv: Kn5Mesh['uv']): UvRegion | null {
  if (!uv) return null;
  const eps = 0.02;
  const vals = [uv.u0, uv.u1, uv.v0, uv.v1];
  if (!vals.every((n) => Number.isFinite(n))) return null;
  if (uv.u1 - uv.u0 > 1 + eps || uv.v1 - uv.v0 > 1 + eps) return null;
  const wrap = (a: number, b: number): [number, number] | null => {
    const base = Math.floor(a + eps);
    const x0 = a - base;
    const x1 = b - base;
    if (x1 > 1 + eps) return null; // cruza el borde de la textura
    const c = (n: number) => Math.min(1, Math.max(0, n));
    return [c(x0), c(x1)];
  };
  const xs = wrap(uv.u0, uv.u1);
  const ys = wrap(uv.v0, uv.v1);
  if (!xs || !ys) return null;
  const r4 = (n: number) => Math.round(n * 10000) / 10000;
  const region = { x: r4(xs[0]), y: r4(ys[0]), width: r4(xs[1] - xs[0]), height: r4(ys[1] - ys[0]) };
  if (region.width < 0.01 || region.height < 0.01) return null;
  return region;
}

/** Tamaño físico aproximado (m) a partir del volumen envolvente: las dos dimensiones mayores. */
export function physicalSizeFromMesh(size: Kn5Mesh['size']): { width: number; height: number } | null {
  if (!size) return null;
  const dims = [size.x, size.y, size.z].filter((n) => Number.isFinite(n) && n > 0.001).sort((a, b) => b - a);
  if (dims.length < 2) return null;
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return { width: r3(dims[0]), height: r3(dims[1]) };
}
