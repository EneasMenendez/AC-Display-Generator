import type { Color } from './model';

/* Luces de cambio: orden de encendido y color por tramos (compartido por el editor; el runtime Lua lo replica). */

/** posición (0..n-1) → rango de encendido (0 = primero en encenderse) */
export function ledRanks(n: number, pattern: 'left_to_right' | 'edges_to_center' | 'center_to_edges'): number[] {
  const rank = new Array<number>(n).fill(0);
  if (pattern === 'edges_to_center') {
    let l = 0;
    let r = n - 1;
    let k = 0;
    while (l <= r) {
      rank[l] = k++;
      if (r !== l) rank[r] = k++;
      l++;
      r--;
    }
  } else if (pattern === 'center_to_edges') {
    const mid = (n - 1) / 2;
    const order = [...Array(n).keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
    order.forEach((p, k) => (rank[p] = k));
  } else for (let p = 0; p < n; p++) rank[p] = p;
  return rank;
}

/** color del LED según su rango y los tramos configurados */
export function ledZoneColor(rank: number, zones: { count: number; color: Color }[], fallback: Color): Color {
  let acc = 0;
  for (const z of zones) {
    acc += Math.max(0, Math.floor(z.count));
    if (rank < acc) return z.color;
  }
  return zones.length ? zones[zones.length - 1].color : fallback;
}

/**
 * Estado de cada LED (por posición física) de una tira de luces de cambio a unas rpm dadas: cuántos
 * están encendidos, con qué color y el parpadeo en el corte. Es la lógica de draw.shift_lights y de
 * las luces físicas del runtime Lua, para la vista previa del editor.
 */
export function shiftLightsState(o: {
  n: number;
  rpm: number;
  start: number;
  end: number;
  pattern: 'left_to_right' | 'edges_to_center' | 'center_to_edges';
  zones: { count: number; color: Color }[];
  limiterOn: boolean;
  limiterBlinkHz: number;
  limiterColor: Color;
  blinkDuty?: number;
  t: number;
}): { lit: boolean; color: Color }[] {
  const n = Math.max(0, Math.floor(o.n));
  const end = o.end <= o.start ? o.start + 1 : o.end;
  const frac = Math.max(0, Math.min(1, (o.rpm - o.start) / (end - o.start)));
  let active = 0;
  if (o.rpm >= o.start) {
    active = Math.floor(frac * n + 0.0001);
    if (frac < 1) active += 1;
    active = Math.min(active, n);
  }
  const blink = (o.limiterOn || o.rpm >= end) && o.limiterBlinkHz > 0;
  const duty = Math.max(0.05, Math.min(0.95, o.blinkDuty ?? 0.5));
  const blinkVisible = blink && (o.t * o.limiterBlinkHz) % 1 < duty;
  const ranks = ledRanks(n, o.pattern);
  return ranks.map((rank) => (blink ? { lit: blinkVisible, color: o.limiterColor } : { lit: rank < active, color: ledZoneColor(rank, o.zones, o.limiterColor) }));
}

/**
 * Reparte los tramos de color entre n LEDs manteniendo su proporción (p. ej. 4/3/3 → 2/2/1 con 5 LEDs).
 * Cada tramo conserva al menos un LED mientras haya LEDs para todos.
 */
export function distributeZones(zones: { count: number; color: Color }[], n: number): { count: number; color: Color }[] {
  const total = zones.reduce((a, z) => a + Math.max(0, z.count), 0);
  if (zones.length === 0 || n <= 0) return zones.map((z) => ({ ...z, count: 0 }));
  const weights = total > 0 ? zones.map((z) => Math.max(0, z.count) / total) : zones.map(() => 1 / zones.length);
  const counts = weights.map((w) => Math.floor(w * n));
  if (n >= zones.length) for (let i = 0; i < counts.length; i++) if (counts[i] === 0) counts[i] = 1;
  // ajuste final: lo que sobre o falte, por el mayor resto (el último tramo, el rojo, gana empates)
  let diff = n - counts.reduce((a, c) => a + c, 0);
  const order = weights.map((w, i) => ({ i, rest: w * n - Math.floor(w * n) })).sort((a, b) => b.rest - a.rest || b.i - a.i);
  for (let k = 0; diff !== 0 && k < 1000; k++) {
    const { i } = order[k % order.length];
    if (diff > 0) (counts[i]++, diff--);
    else if (counts[i] > 1 || n < zones.length) (counts[i] > 0 && (counts[i]--, diff++));
  }
  return zones.map((z, i) => ({ ...z, count: counts[i] }));
}
