import { describe, it, expect } from 'vitest';
import { hasUvRegion, physicalSizeFromMesh, regionFromKn5Uv, regionFromPx, uvRegionPx } from '../src/shared/uv';

describe('área visible (UV de la malla)', () => {
  it('convierte el rectángulo UV del kn5 (V negada) en región de textura', () => {
    // malla DISPLAY del Porsche 992: u 0..1, v -0.885..-0.125 → franja central de la textura
    // la GPU muestrea v mod 1: filas 0,115 → 0,875
    const r = regionFromKn5Uv({ u0: 0, v0: -0.8851385712623596, u1: 1, v1: -0.12488490343093872 })!;
    expect(r).toEqual({ x: 0, y: 0.1149, width: 1, height: 0.7603 });
    expect(hasUvRegion({ uv_region: r })).toBe(true);
    const px = uvRegionPx({ uv_region: r, texture_size: { width: 1024, height: 512 } });
    expect(px).toEqual({ x: 0, y: 59, width: 1024, height: 389 });
    expect(regionFromPx(px, { width: 1024, height: 512 })).toEqual({ x: 0, y: 0.1152, width: 1, height: 0.7598 });
    // malla del copiloto del mismo coche (codriver.kn5): V positiva, casi toda la textura
    const c = regionFromKn5Uv({ u0: 0.0503, v0: 0.0053, u1: 0.9497, v1: 0.9725 })!;
    expect(c).toEqual({ x: 0.0503, y: 0.0053, width: 0.8994, height: 0.9672 });
  });
  it('una malla que usa toda la textura no marca área', () => {
    const r = regionFromKn5Uv({ u0: 0.0055, v0: -0.9965, u1: 0.995, v1: -0.0035 })!;
    expect(hasUvRegion({ uv_region: r })).toBe(false);
  });
  it('rechaza UV fuera de la textura (repetición / bisel) y mallas vacías', () => {
    expect(regionFromKn5Uv({ u0: 0.088, v0: -1.0476, u1: 0.912, v1: 1.81 })).toBeNull();
    // cruza el borde de la textura
    expect(regionFromKn5Uv({ u0: 0, v0: -0.3, u1: 1, v1: 0.4 })).toBeNull();
    expect(regionFromKn5Uv(null)).toBeNull();
  });
  it('tamaño físico: las dos dimensiones mayores del volumen', () => {
    expect(physicalSizeFromMesh({ x: 0.2458, y: 0.0922, z: 0.0153 })).toEqual({ width: 0.246, height: 0.092 });
    expect(physicalSizeFromMesh({ x: 0.1, y: 0.07, z: 1e-8 })).toEqual({ width: 0.1, height: 0.07 });
  });
});
