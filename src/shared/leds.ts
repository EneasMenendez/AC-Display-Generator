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
