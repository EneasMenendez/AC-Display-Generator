import { describe, it, expect } from 'vitest';
import { applyRules } from '../src/renderer/src/render/rules';
import { resolveSim } from '../src/renderer/src/sim';
import { createElement, type TextElement } from '../src/shared/model';

/** Reglas de estado del editor: deben decidir lo mismo que el runtime Lua (compare sobre números). */

const defaults = { rpm_limiter: 8000, rpm_warning_pct: 0.85, rpm_redline_pct: 0.95, max_fuel_l: 60, water_temp_range: [40, 130] as [number, number], oil_temp_range: [40, 150] as [number, number], oil_pressure_range: [0, 8] as [number, number], speed_max: 300 };
const ctx = (values: Record<string, number | boolean>) => resolveSim(values, defaults, 0, 1);

function el(when: { variable: string; op: '=='; value: number | boolean }, set: { color?: string; visible?: boolean }): TextElement {
  const e = createElement('text') as TextElement;
  e.rules.push({ id: 'r', when, set });
  return e;
}

describe('reglas de estado', () => {
  it('las condiciones booleanas valen en los dos sentidos', () => {
    const rule = el({ variable: 'is_replay', op: '==', value: false }, { color: '#FF0000' });
    expect(applyRules(rule, ctx({ is_replay: false })).color).toBe('#FF0000');
    expect(applyRules(rule, ctx({ is_replay: true })).color).toBeUndefined();

    const rule2 = el({ variable: 'pit_limiter', op: '==', value: true }, { visible: false });
    expect(applyRules(rule2, ctx({ pit_limiter: true })).visible).toBe(false);
    expect(applyRules(rule2, ctx({ pit_limiter: false })).visible).toBe(true);
  });

  it('las condiciones en % se resuelven con el limitador', () => {
    const rule = el({ variable: 'rpm', op: '==' as const, value: 8000 }, { color: '#00FF00' });
    rule.rules[0].when = { variable: 'rpm', op: '>=', value: '95%' } as typeof rule.rules[0]['when'];
    expect(applyRules(rule, ctx({ rpm: 7700 })).color).toBe('#00FF00');
    expect(applyRules(rule, ctx({ rpm: 7000 })).color).toBeUndefined();
  });
});
