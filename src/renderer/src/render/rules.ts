import type { Color, DisplayElement } from '@shared/model';
import type { SimContext } from '../sim';
import { compare } from './compare';

/**
 * Reglas de estado de un elemento (misma semántica que applyRules del runtime Lua): se aplican en
 * orden y la última que se cumple manda. Vive aparte del dibujado para no depender del navegador.
 */

/** Parpadeo: true durante la parte encendida del ciclo. */
export function blinkOn(t: number, hz: number | undefined, duty = 0.5): boolean {
  if (!hz || hz <= 0) return true;
  return (t * hz) % 1 < Math.max(0.05, Math.min(0.95, duty || 0.5));
}

export interface RuleResult {
  visible: boolean;
  opacity: number;
  color?: Color;
  image?: string;
}


export function applyRules(el: DisplayElement, ctx: SimContext): RuleResult {
  let visible = el.visible;
  let opacity = el.opacity;
  let color: Color | undefined;
  let image: string | undefined;
  for (const r of el.rules) {
    const v = ctx.values[r.when.variable];
    if (compare(v, r.when.op, r.when.value, ctx)) {
      if (r.set.visible !== undefined) visible = r.set.visible;
      if (r.set.opacity !== undefined) opacity = r.set.opacity;
      if (r.set.color !== undefined) color = r.set.color;
      if (r.set.image !== undefined) image = r.set.image;
      if (r.set.blinkHz && r.set.blinkHz > 0 && !blinkOn(ctx.t, r.set.blinkHz)) visible = false;
    }
  }
  return { visible, opacity, color, image };
}
