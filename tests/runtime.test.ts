import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LuaFactory } from 'wasmoon';
import luaparse from 'luaparse';
import { createElement, createEmptyProject, createPhysicalShiftLights, type NeedleElement, type Project, type RpmBarElement, type ShiftLightsElement, type TextElement } from '../src/shared/model';
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
  const needle = createElement('needle') as NeedleElement;
  needle.config.image = 'assets/needle.png';
  const lights = createElement('shift_lights') as ShiftLightsElement;
  lights.config.pattern = 'edges_to_center';
  lights.config.glow = { size: 10, intensity: 0.8, luminance: 2, core: 0.8 };
  lights.config.blinkDuty = 0.3;
  const texBar = createElement('rpm_bar') as RpmBarElement;
  texBar.config.style = 'continuous';
  texBar.config.fillImage = 'assets/bar_fill.png';
  texBar.config.bgImage = 'assets/bar_bg.png';
  texBar.config.tintImage = true;
  d.pages[0].elements.push(createElement('rpm_bar'), createElement('shift_light'), createElement('bar'), createElement('gear'), createElement('icon'), createElement('gauge'), createElement('rect'), createElement('circle'), createElement('line'), text, speed, needle, lights, createElement('needle'), createElement('shift_lights'), texBar);
  d.pages.push({ id: 'pit', name: 'Boxes', elements: [createElement('text')], when: { variable: 'in_pitlane', op: '==', value: true } });
  d.settings.pageSwitch = { input: 'extraA', wrap: true, remember: true };
  d.settings.nightMode = 'headlights';
  d.settings.refreshHz = 0;
  text.binding.updateHz = 10;
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
TEXTS = {}
local function rec(name) return function(...) CALLS[#CALLS + 1] = name return 0 end end
local font = { weight = function(self) return self end }
ui = setmetatable({
  DWriteFont = setmetatable({ Weight = { Bold = 700 } }, { __call = function() return font end }),
  Alignment = { Start = -1, Center = 0, End = 1 },
  drawRectFilled = rec('drawRectFilled'), drawRect = rec('drawRect'), drawImage = rec('drawImage'),
  drawCircleFilled = rec('drawCircleFilled'), drawCircle = rec('drawCircle'),
  dwriteDrawTextClipped = function(text, size, a, b, ah, av) CALLS[#CALLS + 1] = 'dwriteDrawTextClipped'; TEXTS[#TEXTS + 1] = { text = text, size = size, y1 = a.y, y2 = b.y, x1 = a.x, x2 = b.x, av = av } return 0 end, measureDWriteText = function(t, s) return vec2(#t * s * 0.6, s * 1.33) end, pushDWriteFont = rec('pushDWriteFont'), popDWriteFont = rec('popDWriteFont'),
  pathClear = rec('pathClear'), pathArcTo = rec('pathArcTo'), pathStroke = rec('pathStroke'),
  beginRotation = rec('beginRotation'), endPivotRotation = function(deg, piv) CALLS[#CALLS + 1] = 'endPivotRotation'; ROT_DEG = deg return 0 end,
  drawImageQuad = function(src, a, b, c, d) CALLS[#CALLS + 1] = 'drawImageQuad'; QUAD = { a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y } return 0 end,
  drawLine = function(a, b) CALLS[#CALLS + 1] = 'drawLine'; LINE = { a.x, a.y, b.x, b.y } return 0 end,
  MediaPlayer = setmetatable({ supported = function() return true end }, { __call = function(_, src)
    local pl = { src = src, playing = false, pos = 0 }
    function pl:setAutoPlay() end function pl:setLooping() end function pl:setMuted() end function pl:setVolume() end function pl:setPlaybackRate() end
    function pl:setCurrentTime(v) self.pos = v end function pl:play() self.playing = true; PLAYED = (PLAYED or 0) + 1 end function pl:pause() self.playing = false end function pl:ended() return false end
    return pl
  end }),
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
  lapTimeMs = 83452, focused = true, distanceToCamera = 2, physicsAvailable = true, prefersImperialUnits = false, isInPitlane = false, extraA = false, extraB = false, headlightsActive = false, absInAction = false, isEngineLimiterOn = false, kersButtonPressed = false }
car = setmetatable({}, { __index = function(_, k) local v = CARV[k] if v ~= nil then return v end return 0 end })
sim = setmetatable({}, { __index = function(_, k) if k == 'timeHours' then return 14 end return 0 end })
__dirname = 'C:/fake/extension'
`;

/**
 * Globales permitidos en el Lua generado: los que aporta CSP. Cualquier otro nombre significa que un
 * local se usa antes de declararse (Lua lo resuelve como global nil y el dibujado falla en el coche)
 * o que hay una errata en una expresión del catálogo de variables.
 */
const CSP_GLOBALS = new Set([
  'ACDG', 'ac', 'car', 'sim', 'ui', 'display', 'script', 'physics', 'render',
  'vec2', 'vec3', 'vec4', 'rgb', 'rgbm', 'mat4x4', 'refnumber', 'refbool',
  'math', 'string', 'table', 'os', 'io', 'bit', 'ffi',
  'pairs', 'ipairs', 'next', 'select', 'type', 'tostring', 'tonumber', 'pcall', 'xpcall', 'error',
  'assert', 'unpack', 'setmetatable', 'getmetatable', 'rawget', 'rawset', 'require', 'print',
  'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', '__dirname',
]);

function unexpectedGlobals(code: string): string[] {
  const chunk = luaparse.parse(code, { scope: true, comments: false }) as unknown as { globals: { name: string }[] };
  return [...new Set(chunk.globals.map((g) => g.name))].filter((n) => !CSP_GLOBALS.has(n)).sort();
}

describe('runtime Lua generado', () => {
  it('no usa ningún global fuera de la API de CSP (locales usados antes de declararse)', () => {
    expect(unexpectedGlobals(readFileSync('resources/runtime/acdg_runtime.lua', 'utf8'))).toEqual([]);
    const p = project();
    const gen = generateConfigLua(p, p.displays[0], profile.displays[0]);
    expect(unexpectedGlobals(gen.lua)).toEqual([]);
    expect(unexpectedGlobals(generateDisplayLua(gen.lua, readFileSync('resources/runtime/acdg_runtime.lua', 'utf8'), 'driver_display'))).toEqual([]);
  });

  it('display.lua se ejecuta sin errores con la API de CSP simulada y cambia de página', async () => {
    const p = project();
    const gen = generateConfigLua(p, p.displays[0], profile.displays[0], { fontMetrics: { 'Segoe UI': { line: 1.33, shift: -0.06 } } });
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
      // con las luces encendidas (destello y núcleo) tampoco debe fallar nada del dibujado
      expect(await engine.doString('return ERRORED'), 'error dibujando con luces encendidas').toBeFalsy();
      // aguja: geometría girada calculada (sin endPivotRotation); textura de barra y LEDs con imagen
      const names = String(await engine.doString('return table.concat(CALLS, ",")'));
      expect(names).toContain('drawImageQuad');
      expect(names).toContain('drawLine');
      expect(names).toContain('drawImage');
      // la aguja simple gira alrededor de su eje (120, 300): la punta queda a 200 px del eje y, con rpm altas, a la derecha
      const line = (await engine.doString('return LINE[1] .. "," .. LINE[2] .. "," .. LINE[3] .. "," .. LINE[4]')) as string;
      const [lx0, ly0, lx1, ly1] = line.split(',').map(Number);
      expect(lx0).toBe(120);
      expect(ly0).toBe(300);
      expect(Math.hypot(lx1 - lx0, ly1 - ly0)).toBeCloseTo(200, 1);
      expect(lx1).toBeGreaterThan(lx0);
      expect(gen.assets).toContainEqual({ source: 'assets/needle.png', target: 'driver_display_needle.png' });
      expect(gen.assets).toContainEqual({ source: 'assets/bar_fill.png', target: 'driver_display_bar_fill.png' });
      // colocación vertical del texto: caja de línea (1,33 × tamaño según el stub) centrada en la caja del
      // elemento con la corrección de la fuente, alineación Start; horizontal = ancho completo de la caja
      const gearEl = p.displays[0].pages[0].elements.find((e) => e.type === 'gear')! as { x: number; y: number; width: number; height: number; config: { style: { size: number } } };
      const drawn = (await engine.doString('local t = {} for i = 1, #TEXTS do t[i] = TEXTS[i] end return t')) as Map<number, Map<string, unknown>> | Record<string, unknown>;
      const list = drawn instanceof Map ? [...drawn.values()].map((m) => Object.fromEntries((m as Map<string, unknown>).entries())) : Object.values(drawn as Record<string, Map<string, unknown>>).map((m) => (m instanceof Map ? Object.fromEntries(m.entries()) : (m as Record<string, unknown>)));
      const size = gearEl.config.style.size;
      const lineH = size * 1.33;
      const expectedTop = gearEl.y + gearEl.height / 2 + -0.06 * size - lineH / 2;
      const g = list.find((t) => Math.abs(Number(t.y1) - expectedTop) < 0.01 && Number(t.size) === size);
      expect(g, `no se dibujó la marcha en top=${expectedTop}; textos: ${JSON.stringify(list)}`).toBeTruthy();
      expect(Number(g!.y2) - Number(g!.y1)).toBeCloseTo(lineH, 3);
      expect(Number(g!.x1)).toBe(gearEl.x);
      expect(Number(g!.x2)).toBe(gearEl.x + gearEl.width);
      expect(Number(g!.av)).toBe(-1);
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

  it('luces de cambio físicas: encienden las mallas en orden, con su color, y parpadean en el corte', async () => {
    const p = project();
    const strip = createPhysicalShiftLights(['LED1', 'LED2', 'LED3', 'LED4', 'NO_EXISTE']);
    strip.rpmStart = 4000;
    strip.rpmEnd = 6000;
    strip.zones = [{ count: 3, color: '#00FF00' }, { count: 2, color: '#FF0000' }];
    strip.intensity = 10;
    strip.limiterBlinkHz = 5;
    strip.limiterColor = '#0000FF';
    p.displays[0].physicalShiftLights = [strip, { ...createPhysicalShiftLights([' ', '']), id: 'vacia' }];
    const gen = generateConfigLua(p, p.displays[0], profile.displays[0]);
    // la tira sin mallas no llega al script
    expect(gen.lua.match(/meshes = \{/g)).toHaveLength(1);
    const lua = generateDisplayLua(gen.lua, readFileSync('resources/runtime/acdg_runtime.lua', 'utf8'), 'driver_display');
    const engine = await new LuaFactory().createEngine();
    try {
      await engine.doString(STUBS);
      await engine.doString(`
        rgb = function(r, g, b) return { r = r, g = g, b = b } end
        EMIS, UNIQUE = {}, {}
        ac.findMeshes = function(name)
          local ref = {}
          function ref:size() return name == 'NO_EXISTE' and 0 or 1 end
          function ref:ensureUniqueMaterials() UNIQUE[name] = true return self end
          function ref:setMaterialProperty(prop, v) if prop == 'ksEmissive' then EMIS[name] = v end return self end
          return ref
        end
        function lit(name) local v = EMIS[name] return v and (v.r + v.g + v.b) > 0 end
        function colorOf(name) local v = EMIS[name] return string.format('%g,%g,%g', v.r, v.g, v.b) end`);
      await engine.doString(lua);
      // la malla que no existe se avisa en el registro; las demás tienen material propio
      expect(String(await engine.doString('return ERRORED'))).toContain('NO_EXISTE');
      expect(await engine.doString('return UNIQUE.LED1 and UNIQUE.LED4')).toBe(true);
      // por debajo del primer régimen: todo apagado
      await engine.doString('ERRORED = nil; CARV.rpm = 3000; script.update(0.016)');
      expect(await engine.doString('return lit("LED1") or lit("LED4")')).toBe(false);
      // a mitad de recorrido: 3 de 5 encendidos (4000–6000 rpm, 5 LEDs → 5000 rpm = el tercero)
      await engine.doString('CARV.rpm = 5000; script.update(0.016)');
      expect(await engine.doString('return lit("LED1") and lit("LED2") and lit("LED3")')).toBe(true);
      expect(await engine.doString('return lit("LED4")')).toBe(false);
      // color del tramo × intensidad
      expect(await engine.doString('return colorOf("LED1")')).toBe('0,10,0');
      await engine.doString('CARV.rpm = 5900; script.update(0.016)');
      expect(await engine.doString('return colorOf("LED4")')).toBe('10,0,0');
      // en el corte: todos del color del limitador, encendiéndose y apagándose
      const states = new Set<string>();
      for (let i = 0; i < 20; i++) {
        await engine.doString('CARV.rpm = 6100; CARV.isEngineLimiterOn = true; script.update(0.02)');
        states.add(String(await engine.doString('return lit("LED1") and colorOf("LED1") or "off"')));
      }
      expect([...states].sort()).toEqual(['0,0,10', 'off']);
      expect(await engine.doString('return ERRORED')).toBeFalsy();
    } finally {
      engine.global.close();
    }
  }, 30000);

  it('frecuencia de refresco: a 30 Hz se salta la mayoría de los frames y el texto a 10 Hz se congela', async () => {
    const p = project();
    p.displays[0].settings.refreshHz = 30;
    const gen = generateConfigLua(p, p.displays[0], profile.displays[0]);
    const lua = generateDisplayLua(gen.lua, readFileSync('resources/runtime/acdg_runtime.lua', 'utf8'), 'driver_display');
    const engine = await new LuaFactory().createEngine();
    try {
      await engine.doString(STUBS);
      await engine.doString(lua);
      // 60 frames a 60 fps (0,96 s) → ~29 redibujados y el resto saltados
      await engine.doString('CALLS = {}; for i = 1, 60 do script.update(0.016) end');
      const skips = Number(await engine.doString('local n = 0 for i = 1, #CALLS do if CALLS[i] == "skipFrame" then n = n + 1 end end return n'));
      expect(skips).toBeGreaterThanOrEqual(28);
      expect(skips).toBeLessThanOrEqual(33);
      // el texto con updateHz = 10 se recalcula ~10 veces por segundo: el tiempo de vuelta mostrado va por saltos
      await engine.doString('TEXTS = {}; CARV.lapTimeMs = 0; for i = 1, 60 do CARV.lapTimeMs = CARV.lapTimeMs + 16; script.update(0.016) end');
      const shown = (await engine.doString('local t = {} for i = 1, #TEXTS do t[#t + 1] = TEXTS[i].text end return table.concat(t, "|")')) as string;
      const lapTexts = shown.split('|').filter((x) => /^\d+'\d\d"\d\d$/.test(x));
      const distinct = new Set(lapTexts).size;
      expect(lapTexts.length).toBeGreaterThan(20);
      expect(distinct).toBeLessThanOrEqual(12);
      expect(distinct).toBeGreaterThanOrEqual(8);
    } finally {
      engine.global.close();
    }
  }, 30000);
});
