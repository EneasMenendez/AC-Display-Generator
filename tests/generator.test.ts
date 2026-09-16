import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import luaparse from 'luaparse';
import { createElement, createEmptyProject, type Project, type TextElement } from '../src/shared/model';
import { parseProfile } from '../src/shared/profile';
import {
  generateConfigLua,
  generateDisplayIni,
  generateDisplayLua,
  upsertIncludeBlock,
  removeIncludeBlock,
  findConflictingDisplays,
  toLua,
  LuaRaw,
} from '../src/shared/generator';
import { formatBinding, formatTime } from '../src/shared/format';

const profileJson = JSON.parse(readFileSync('resources/profiles/av_toyota_starlet_millington.display_profile.json', 'utf8'));

function sampleProject(): Project {
  const p = createEmptyProject({
    name: 'Starlet test',
    profileId: 'av_toyota_starlet_millington.driver_display',
    profileVersion: 2,
    carId: 'av_toyota_starlet_millington',
    appVersion: '0.1.0',
    displays: [{ displayId: 'driver_display', name: 'Driver Display', width: 1593, height: 987 }],
  });
  const text = createElement('text') as TextElement;
  text.binding = { variable: 'speed', decimals: 0, prefix: '', suffix: ' km/h', padZeros: 0, showSign: false };
  text.rules.push({ id: 'r1', when: { variable: 'rpm', op: '>=', value: '95%' }, set: { color: '#FF0000', blinkHz: 4 } });
  const gear = createElement('gear');
  const rpm = createElement('rpm_bar');
  const shift = createElement('shift_light');
  const icon = createElement('icon');
  const gauge = createElement('gauge');
  p.displays[0].pages[0].elements.push(rpm, text, gear, shift, icon, gauge);
  // segunda página con condición automática y cambio por botón
  p.displays[0].pages.push({ id: 'pit', name: 'Boxes', elements: [], when: { variable: 'in_pitlane', op: '==', value: true } });
  p.displays[0].settings.pageSwitch = { input: 'extraA', wrap: true, remember: true };
  return p;
}

describe('perfil', () => {
  it('valida el perfil del Starlet y aplica defaults', () => {
    const r = parseProfile(profileJson);
    expect(r.ok).toBe(true);
    expect(r.profile!.displays[0].emissive.mode).toBe('none');
    expect(r.profile!.displays[0].uv_region.width).toBe(1);
  });
  it('rechaza perfiles sin mallas', () => {
    const bad = JSON.parse(JSON.stringify(profileJson));
    bad.displays[0].meshes = [];
    const r = parseProfile(bad);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('meshes');
  });
});

describe('toLua', () => {
  it('serializa claves no identificadoras y valores raw', () => {
    const lua = toLua({ '-1': 'R', end: 1, fn: new LuaRaw('function() return 1 end'), list: [1, 'a', true, null] });
    expect(lua).toContain("['-1'] = 'R'");
    expect(lua).toContain("['end'] = 1");
    expect(lua).toContain('fn = function() return 1 end');
    expect(lua).toContain('nil');
  });
});

describe('generador', () => {
  const profile = parseProfile(profileJson).profile!;
  const display = profile.displays[0];

  it('produce Lua sintácticamente válido y con las variables usadas', () => {
    const gen = generateConfigLua(sampleProject(), sampleProject().displays[0], display);
    expect(() => luaparse.parse(gen.lua, { luaVersion: '5.1' })).not.toThrow();
    expect(gen.variables).toEqual(expect.arrayContaining(['speed', 'rpm', 'gear', 'abs_active', 'water_temp']));
    // abs_active es physics_only → función con fallback
    expect(gen.lua).toMatch(/abs_active = function\(\) if car\.physicsAvailable == false then return false end return car\.absInAction end/);
    // el icono integrado se mapea a icons/abs.png
    expect(gen.assets).toContainEqual({ source: 'builtin:abs', target: 'icons/abs.png' });
    expect(gen.lua).toContain("file = 'icons/abs.png'");
    // páginas: condición y botón de cambio
    expect(gen.variables).toContain('in_pitlane');
    expect(gen.lua).toMatch(/when = \{[\s\S]*variable = 'in_pitlane'/);
    expect(gen.lua).toContain("input = 'extraA'");
  });

  it('runtime y display.lua son válidos', () => {
    const runtime = readFileSync('resources/runtime/acdg_runtime.lua', 'utf8');
    expect(() => luaparse.parse(runtime, { luaVersion: '5.1' })).not.toThrow();
    const gen = generateConfigLua(sampleProject(), sampleProject().displays[0], display);
    const full = generateDisplayLua(gen.lua, runtime, 'driver_display');
    expect(() => luaparse.parse(full, { luaVersion: '5.1' })).not.toThrow();
    expect(full).not.toMatch(/\brequire\(/);
    expect(full).toContain("ac.log('[ACDG] display");
  });

  it('genera display.ini con la sección y la condición ACTIVE', () => {
    const ini = generateDisplayIni(profile, display, { folder: 'acdg/driver_display' });
    expect(ini).toContain('[SCRIPTABLE_DISPLAY_ACDG_DRIVER_DISPLAY]');
    expect(ini).toContain('MESHES = Plano_014_001');
    expect(ini).toContain('SCRIPT = acdg/driver_display/display.lua');
    expect(ini).toContain('KEEP_BACKGROUND = 1');
    expect(ini).not.toContain('ACTIVE');
  });
});

describe('ext_config.ini', () => {
  const original = '[LIGHTING]\nEMISSIVE_MULT=1\n';
  it('añade, actualiza y elimina el bloque INCLUDE sin tocar el resto', () => {
    const body = '[SCRIPTABLE_DISPLAY_ACDG_DRIVER_DISPLAY]\nMESHES = m\nSCRIPT = acdg/driver_display/display.lua';
    const a = upsertIncludeBlock(original, 'driver_display', body);
    expect(a).toContain(original);
    expect(a).toContain('SCRIPT = acdg/driver_display/display.lua');
    const b = upsertIncludeBlock(a, 'driver_display', body);
    expect(b.split('ACDG BEGIN').length).toBe(2);
    const c = removeIncludeBlock(b, 'driver_display');
    expect(c).not.toContain('ACDG');
    expect(c).toContain('EMISSIVE_MULT=1');
  });
  it('detecta displays ajenos sobre la misma malla', () => {
    const cfg = '[SCRIPTABLE_DISPLAY_...]\nMESHES = int_display, Plano_014_001\nSCRIPT = display.lua\n\n[SCRIPTABLE_DISPLAY_ACDG_DRIVER_DISPLAY]\nMESHES = Plano_014_001\n';
    expect(findConflictingDisplays(cfg, ['plano_014_001'], 'driver_display')).toEqual(['[SCRIPTABLE_DISPLAY_...]']);
  });
});

describe('formato', () => {
  it('tiempos', () => {
    expect(formatTime(83452)).toBe('1:23.452');
    expect(formatTime(83452, "m'ss\"mm")).toBe('1\'23"45');
    expect(formatTime(3723000, 'h:mm:ss')).toBe('1:02:03');
    expect(formatTime(-1)).toBe('-:--.---');
  });
  it('binding con mapa, unidades y decimales', () => {
    expect(formatBinding({ variable: 'gear', decimals: 0, prefix: '', suffix: '', padZeros: 0, showSign: false, map: { '-1': 'R', '0': 'N' } }, -1)).toBe('R');
    expect(formatBinding({ variable: 'speed', decimals: 1, prefix: '', suffix: '', unit: 'mph', padZeros: 0, showSign: false }, 100)).toBe('62.1');
    expect(formatBinding({ variable: 'delta', decimals: 2, prefix: '', suffix: '', padZeros: 0, showSign: true }, 0.351)).toBe('+0.35');
    expect(formatBinding({ variable: 'throttle', decimals: 0, prefix: '', suffix: '%', padZeros: 3, showSign: false }, 0.7)).toBe('070%');
  });
});
