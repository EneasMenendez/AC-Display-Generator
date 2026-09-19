import { describe, it, expect } from 'vitest';
import { ledRanks, ledZoneColor } from '../src/shared/leds';

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
