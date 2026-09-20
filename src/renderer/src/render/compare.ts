import type { Rule, RpmValue } from '@shared/model';
import { resolveRpm } from '@shared/model';
import type { SimContext } from '../sim';

/** Comparación de condiciones (reglas, páginas, activadores); los valores '85%' se resuelven con el limitador. */
export function compare(a: unknown, op: Rule['when']['op'], b: unknown, ctx: SimContext): boolean {
  let x = typeof a === 'boolean' ? (a ? 1 : 0) : Number(a);
  let y: number;
  if (typeof b === 'boolean') y = b ? 1 : 0;
  else if (typeof b === 'string') y = resolveRpm(b as RpmValue, ctx.limiter);
  else y = Number(b);
  if (!Number.isFinite(x)) x = 0;
  switch (op) {
    case '>':
      return x > y;
    case '>=':
      return x >= y;
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '==':
      return x === y;
    case '!=':
      return x !== y;
  }
}
