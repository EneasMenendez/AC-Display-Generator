import { describe, it, expect } from 'vitest';
import luaparse from 'luaparse';
import { VARIABLES, CURATED_VARIABLES } from '../src/shared/variables';
import { GENERATED_VARIABLES } from '../src/shared/variables.generated';

describe('catálogo de variables', () => {
  it('incluye el catálogo completo del SDK sin duplicar ids ni expresiones', () => {
    expect(GENERATED_VARIABLES.length).toBeGreaterThan(400);
    expect(VARIABLES.length).toBeGreaterThan(CURATED_VARIABLES.length + 400);
    const ids = VARIABLES.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    const luas = VARIABLES.map((v) => v.lua);
    expect(new Set(luas).size).toBe(luas.length);
  });
  it('todas las expresiones Lua son válidas', () => {
    for (const v of VARIABLES) {
      expect(() => luaparse.parse(`return ${v.lua}`, { luaVersion: '5.1' }), v.lua).not.toThrow();
    }
  });
  it('marca como físicas los campos physics-only', () => {
    const f = VARIABLES.find((v) => v.lua === 'car.brakeBias');
    expect(f?.physics_only).toBe(true);
    const w = VARIABLES.find((v) => v.lua === 'car.wheels[2].slipAngle');
    expect(w?.category).toBe('Neumáticos (todos)');
  });
});
