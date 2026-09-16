import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LuaFactory } from 'wasmoon';
import { createElement, createEmptyProject, type Project, type TextElement } from '../src/shared/model';
import { parseProfile } from '../src/shared/profile';
import { generateConfigLua, generateDisplayLua } from '../src/shared/generator';

/**
 * Ejecuta el display.lua generado en una VM Lua con stubs de la API de CSP para detectar errores del
 * runtime antes de probar en el juego (lo más parecido a CSP que se puede hacer fuera de él).
 */

const profile = parseProfile(JSON.parse(readFileSync('resources/profiles/av_toyota_starlet_millington.display_profile.json', 'utf8'))).profile!;

function project(): Project {
  const p = createEmptyProject({
    name: 'rt',
    profileId: profile.id,
    profileVersion: 2,
    carId: 'av_toyota_starlet_millington',
    appVersion: '0.1.0',
    displays: [{ displayId: 'driver_display', name: 'Driver', width: 1593, height: 987 }],
  });
  const d = p.displays[0];
  const text = createElement('text') as TextElement;
  text.binding = { variable: 'lap_time', decimals: 0, prefix: '', suffix: '', padZeros: 0, showSign: false, timeFormat: "m'ss\"mm" };
  text.rules.push({ id: 'r', when: { variable: 'rpm', op: '>=', value: '95%' }, set: { color: '#FF0000', blinkHz: 4 } });
  const speed = createElement('text') as TextElement;
  speed.binding = { variable: 'speed', decimals: 1, prefix: '', suffix: ' km/h', unit: 'mph', padZeros: 3, showSign: false };
  d.pages[0].elements.push(createElement('rpm_bar'), createElement('shift_light'), createElement('bar'), createElement('gear'), createElement('icon'), createElement('gauge'), createElement('rect'), createElement('circle'), createElement('line'), text, speed);
  d.pages.push({ id: 'pit', name: 'Boxes', elements: [createElement('text')], when: { variable: 'in_pitlane', op: '==', value: true } });
  d.settings.pageSwitch = { input: 'extraA', wrap: true, remember: true };
  d.settings.nightMode = 'headlights';
  d.background.file = 'assets/bg.png';
  return p;
}

const STUBS = `
local vmt = {}
vmt.__index = vmt
function vec2(x, y) return setmetatable({ x = x or 0, y = y or 0 }, vmt) end
local cmt = {}
cmt.__index = cmt
rgbm = setmetatable({}, { __call = function(_, r, g, b, m) return setmetatable({ r = r or 1, g = g or 1, b = b or 1, mult = m or 1 }, cmt) end })
rgbm.colors = { white = rgbm(1,1,1,1) }
script = {}
CALLS = {}
local function rec(name) return function(...) CALLS[#CALLS + 1] = name return 0 end end
local font = { weight = function(self) return self end }
ui = setmetatable({
  DWriteFont = setmetatable({ Weight = { Bold = 700 } }, { __call = function() return font end }),
  Alignment = { Start = -1, Center = 0, End = 1 },
  drawRectFilled = rec('drawRectFilled'), drawRect = rec('drawRect'), drawImage = rec('drawImage'),
  drawCircleFilled = rec('drawCircleFilled'), drawCircle = rec('drawCircle'), drawLine = rec('drawLine'),
  dwriteDrawTextClipped = rec('dwriteDrawTextClipped'), pushDWriteFont = rec('pushDWriteFont'), popDWriteFont = rec('popDWriteFont'),
  pathClear = rec('pathClear'), pathArcTo = rec('pathArcTo'), pathStroke = rec('pathStroke'),
  beginRotation = rec('beginRotation'), endPivotRotation = rec('endPivotRotation'),
}, { __index = function(_, k) return rec(k) end })
STORAGE = { page = 1 }
ac = setmetatable({
  getSim = function() return sim end,
  skipFrame = rec('skipFrame'),
  storage = function(defaults) return STORAGE end,
  log = function(...) LOGGED = table.concat({ ... }, ' ') end,
  warn = function(...) LOGGED = table.concat({ ... }, ' ') end,
  error = function(...) ERRORED = table.concat({ ... }, ' ') end,
}, { __index = function(_, k) return rec(k) end })
CARV = { rpm = 4500, rpmLimiter = 8000, gear = 3, speedKmh = 128, gas = 0.7, fuel = 30, maxFuel = 60, waterTemperature = 90,
  lapTimeMs = 83452, focused = true, distanceToCamera = 2, physicsAvailable = true, prefersImperialUnits = false, isInPitlane = false, extraA = false, headlightsActive = false, absInAction = false, isEngineLimiterOn = false }
car = setmetatable({}, { __index = function(_, k) local v = CARV[k] if v ~= nil then return v end return 0 end })
sim = setmetatable({}, { __index = function(_, k) if k == 'timeHours' then return 14 end return 0 end })
__dirname = 'C:/fake/extension/acdg/driver_display'
`;

describe('runtime Lua generado', () => {
  it('display.lua se ejecuta sin errores con la API de CSP simulada y cambia de página', async () => {
    const p = project();
    const gen = generateConfigLua(p, p.displays[0], profile.displays[0]);
    const lua = generateDisplayLua(gen.lua, readFileSync('resources/runtime/acdg_runtime.lua', 'utf8'), 'driver_display');
    const engine = await new LuaFactory().createEngine();
    try {
      await engine.doString(STUBS);
      await engine.doString(lua);
      expect(String(await engine.doString('return LOGGED'))).toContain('[ACDG] display "driver_display" cargado');
      expect(await engine.doString('return ERRORED')).toBeFalsy();
      // varios frames en distintos estados
      await engine.doString('script.update(0.016)');
      await engine.doString('CARV.rpm = 7900; CARV.isEngineLimiterOn = true; CARV.headlightsActive = true; script.update(0.016)');
      await engine.doString('CARV.physicsAvailable = false; CARV.prefersImperialUnits = true; script.update(0.016)');
      const calls = Number(await engine.doString('return #CALLS'));
      expect(calls).toBeGreaterThan(20);
      // página automática: en pit lane se dibuja solo la página "Boxes" (1 texto + fondo)
      await engine.doString('CALLS = {}; CARV.isInPitlane = true; script.update(0.016)');
      const pitCalls = Number(await engine.doString('return #CALLS'));
      expect(pitCalls).toBeLessThan(calls);
      // botón extraA: flanco de subida cambia de página manual (fuera del pit lane) y se guarda en storage
      await engine.doString('CARV.isInPitlane = false; CARV.extraA = true; script.update(0.016); CARV.extraA = false; script.update(0.016)');
      expect(Number(await engine.doString('return STORAGE.page'))).toBe(2);
      // coche lejano y no enfocado → skipFrame sin dibujar
      await engine.doString('CALLS = {}; CARV.focused = false; CARV.distanceToCamera = 500; script.update(0.016)');
      expect(String(await engine.doString('return CALLS[1]'))).toBe('skipFrame');
      expect(Number(await engine.doString('return #CALLS'))).toBe(1);
    } finally {
      engine.global.close();
    }
  }, 30000);
});
