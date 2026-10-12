import { describe, it, expect } from 'vitest';
import { distributeZones, ledRanks, ledZoneColor, shiftLightsState } from '../src/shared/leds';

describe('luces de cambio', () => {
  it('orden de encendido según el patrón', () => {
    expect(ledRanks(5, 'left_to_right')).toEqual([0, 1, 2, 3, 4]);
    expect(ledRanks(5, 'edges_to_center')).toEqual([0, 2, 4, 3, 1]);
    expect(ledRanks(6, 'edges_to_center')).toEqual([0, 2, 4, 5, 3, 1]);
    expect(ledRanks(5, 'center_to_edges')).toEqual([3, 1, 0, 2, 4]);
  });
  it('color por tramos en orden de encendido', () => {
    const zones = [
      { count: 2, color: '#00FF00' },
      { count: 1, color: '#FFFF00' },
    ];
    expect(ledZoneColor(0, zones, '#FFF')).toBe('#00FF00');
    expect(ledZoneColor(1, zones, '#FFF')).toBe('#00FF00');
    expect(ledZoneColor(2, zones, '#FFF')).toBe('#FFFF00');
    expect(ledZoneColor(7, zones, '#FFF')).toBe('#FFFF00');
    expect(ledZoneColor(0, [], '#FFF')).toBe('#FFF');
  });
});

describe('estado de una tira (vista previa de las luces físicas)', () => {
  const base = {
    n: 5,
    start: 4000,
    end: 6000,
    pattern: 'left_to_right' as const,
    zones: [{ count: 3, color: '#0F0' }, { count: 2, color: '#F00' }],
    limiterOn: false,
    limiterBlinkHz: 5,
    limiterColor: '#00F',
    t: 0,
  };
  const lit = (s: { lit: boolean }[]) => s.map((x) => (x.lit ? 1 : 0)).join('');

  it('enciende progresivamente, igual que el runtime', () => {
    expect(lit(shiftLightsState({ ...base, rpm: 3000 }))).toBe('00000');
    expect(lit(shiftLightsState({ ...base, rpm: 4000 }))).toBe('10000');
    expect(lit(shiftLightsState({ ...base, rpm: 5000 }))).toBe('11100');
    expect(shiftLightsState({ ...base, rpm: 5900 }).map((x) => x.color)).toEqual(['#0F0', '#0F0', '#0F0', '#F00', '#F00']);
  });

  it('de los extremos al centro', () => {
    expect(lit(shiftLightsState({ ...base, rpm: 4500, pattern: 'edges_to_center' }))).toBe('10001');
  });

  it('en el corte parpadean todos con el color del limitador', () => {
    const on = shiftLightsState({ ...base, rpm: 6100, t: 0.01 });
    const off = shiftLightsState({ ...base, rpm: 6100, t: 0.15 });
    expect(lit(on)).toBe('11111');
    expect(on.every((x) => x.color === '#00F')).toBe(true);
    expect(lit(off)).toBe('00000');
  });
});

describe('reparto de tramos', () => {
  const Z = [{ count: 4, color: 'g' }, { count: 3, color: 'y' }, { count: 3, color: 'r' }];
  const sum = (z: { count: number }[]) => z.reduce((a, x) => a + x.count, 0);
  it('mantiene la proporción y suma exactamente los LEDs', () => {
    for (const n of [1, 2, 3, 5, 7, 10, 15, 16]) expect(sum(distributeZones(Z, n)), `n=${n}`).toBe(n);
    expect(distributeZones(Z, 10).map((z) => z.count)).toEqual([4, 3, 3]);
    expect(distributeZones(Z, 20).map((z) => z.count)).toEqual([8, 6, 6]);
  });
  it('cada tramo conserva al menos un LED si hay para todos', () => {
    expect(distributeZones(Z, 5).every((z) => z.count >= 1)).toBe(true);
    expect(distributeZones(Z, 3).map((z) => z.count)).toEqual([1, 1, 1]);
  });
});
