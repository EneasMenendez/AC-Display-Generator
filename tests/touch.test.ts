import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LuaFactory } from 'wasmoon';
import { createElement, createEmptyProject, createPhysicalButton, type ButtonElement, type Project } from '../src/shared/model';
import { parseProfile } from '../src/shared/profile';
import { collectVariables, generateConfigLua, generateDisplayIni, generateDisplayLua } from '../src/shared/generator';
import { TOUCH_ACTIONS, buttonAt, buttonStateVar, displayHasTouch, usedSwitches } from '../src/shared/touch';
import { fireTouch, type TouchSimApi } from '../src/renderer/src/render/touchSim';

/**
 * Pantallas táctiles: catálogo de acciones, generación (INTERACTIVE = 1 y configuración) y
 * comportamiento del runtime Lua con el puntero simulado.
 */

const profile = parseProfile(JSON.parse(readFileSync('resources/profiles/av_toyota_starlet_millington.display_profile.json', 'utf8'))).profile!;
const RUNTIME = readFileSync('resources/runtime/acdg_runtime.lua', 'utf8');

function button(x: number, y: number, patch: Partial<ButtonElement['config']>): ButtonElement {
  const el = createElement('button', x, y) as ButtonElement;
  el.width = 200;
  el.height = 100;
  Object.assign(el.config, patch);
  return el;
}

function project(): Project {
  const p = createEmptyProject({
    name: 'touch',
    profileId: profile.id,
    profileVersion: 2,
    carId: 'av_toyota_starlet_millington',
    appVersion: '0.1.0',
    displays: [{ displayId: 'driver_display', name: 'Driver', width: 1593, height: 987 }],
  });
  const d = p.displays[0];
  d.pages[0].elements.push(
    button(100, 100, { action: 'switch_toggle', switch: 'a', label: 'MODO' }),
    button(400, 100, { action: 'page_next', label: 'SIG' }),
    button(700, 100, { action: 'kers', behavior: 'hold', label: 'KERS' }),
    button(1000, 100, { action: 'tc_up', behavior: 'repeat', repeatMs: 100, label: 'TC+' }),
  );
  d.pages.push({ id: 'p2', name: 'Segunda', elements: [createElement('text')] });
  d.settings.touch.switches = [{ key: 'a', label: 'Modo', initial: false, remember: true }];
  d.physicalButtons = [
    { ...createPhysicalButton('ButtonPanel_01'), name: 'Botonera: páginas', action: 'page_next' },
    { ...createPhysicalButton('ButtonPanel_02'), name: 'Botonera: modo', action: 'switch_toggle', switch: 'b' },
  ];
  return p;
}

describe('táctil: modelo y generación', () => {
  it('el display es táctil solo si hay botones o gestos (o se fuerza)', () => {
    const p = project();
    const d = p.displays[0];
    expect(displayHasTouch(d)).toBe(true);
    d.settings.touch.mode = 'off';
    expect(displayHasTouch(d)).toBe(false);
    d.settings.touch.mode = 'auto';
    const sinBotones = project().displays[0];
    sinBotones.pages[0].elements = [];
    expect(displayHasTouch(sinBotones)).toBe(false);
    sinBotones.settings.touch.swipePages = true;
    expect(displayHasTouch(sinBotones)).toBe(true);
    sinBotones.settings.touch.swipePages = false;
    sinBotones.settings.touch.mode = 'on';
    expect(displayHasTouch(sinBotones)).toBe(true);
  });

  it('la zona táctil incluye el margen y gana el botón de más arriba', () => {
    const page = { id: 'x', name: 'x', elements: [button(0, 0, { padding: 20 }), button(50, 50, {})] };
    expect(buttonAt(page, 210, 10)?.id).toBe(page.elements[0].id);
    expect(buttonAt(page, 100, 100)?.id).toBe(page.elements[1].id);
    expect(buttonAt(page, 900, 900)).toBeNull();
  });

  it('display.ini escribe INTERACTIVE = 1 solo cuando toca', () => {
    const conTactil = generateDisplayIni(profile, profile.displays[0], { script: 'd.lua', interactive: true });
    expect(conTactil).toContain('INTERACTIVE = 1');
    expect(generateDisplayIni(profile, profile.displays[0], { script: 'd.lua' })).not.toContain('INTERACTIVE');
  });

  it('la configuración lleva el estado táctil, los interruptores usados y la variable que ilumina', () => {
    const p = project();
    const gen = generateConfigLua(p, p.displays[0], profile.displays[0]);
    expect(gen.lua).toContain('touch = {');
    expect(gen.lua).toContain('enabled = true');
    expect(gen.lua).toContain('switches = {');
    expect(gen.lua).toContain('a = {');
    expect(gen.lua).toContain('remember = true');
    // el interruptor y las variables de estado de los botones entran en el catálogo del display
    expect(usedSwitches(p.displays[0])).toEqual(['a', 'b']); // a: botón de la pantalla, b: botón físico
    const vars = collectVariables(p.displays[0]);
    expect(vars).toContain('touch_a');
    expect(vars).toContain('kers_button');
    expect(buttonStateVar(p.displays[0].pages[0].elements[0] as ButtonElement)).toBe('touch_a');
    expect(gen.lua).toContain("stateVar = 'touch_a'");
    expect(gen.lua).toContain("switchKey = 'a'");
  });

  it('cada acción del catálogo existe en la tabla ACTIONS del runtime Lua', () => {
    for (const a of TOUCH_ACTIONS) {
      expect(RUNTIME, `falta la acción ${a.id} en el runtime`).toContain(`\n  ${a.id} = {`);
    }
  });
});

describe('táctil: simulación del editor', () => {
  function api(values: Record<string, number | boolean>, log: string[]): TouchSimApi {
    return {
      get: (id) => values[id],
      set: (id, v) => {
        values[id] = v;
      },
      stepPage: (d) => log.push(`step:${d}`),
      gotoPage: (i) => log.push(`go:${i}`),
      indexOfPage: () => 1,
      previousPage: () => 0,
      playBoot: () => log.push('boot'),
      note: (t) => log.push(`note:${t}`),
    };
  }

  it('interruptores, páginas, mantener pulsado y repetición', () => {
    const values: Record<string, number | boolean> = { tc_mode: 3 };
    const log: string[] = [];
    const a = api(values, log);
    const sw = button(0, 0, { action: 'switch_toggle', switch: 'b' });
    fireTouch(sw, 'press', a);
    expect(values.touch_b).toBe(true);
    fireTouch(sw, 'press', a);
    expect(values.touch_b).toBe(false);

    fireTouch(button(0, 0, { action: 'page_next' }), 'press', a);
    fireTouch(button(0, 0, { action: 'page_go', pageId: 'p2' }), 'press', a);
    expect(log).toEqual(['step:1', 'go:1']);

    const kers = button(0, 0, { action: 'kers', behavior: 'hold' });
    fireTouch(kers, 'press', a);
    expect(values.kers_button).toBe(true);
    fireTouch(kers, 'release', a);
    expect(values.kers_button).toBe(false);

    const tc = button(0, 0, { action: 'tc_up' });
    fireTouch(tc, 'press', a);
    fireTouch(tc, 'press', a);
    expect(values.tc_mode).toBe(5);

    // acción sin equivalente en la simulación: solo avisa
    fireTouch(button(0, 0, { action: 'neutral' }), 'press', a);
    expect(log.some((l) => l.startsWith('note:'))).toBe(true);
  });
});

const STUBS = `
local vmt = {}
vmt.__index = vmt
function vec2(x, y) return setmetatable({ x = x or 0, y = y or 0 }, vmt) end
function vec3(x, y, z) return setmetatable({ x = x or 0, y = y or 0, z = z or 0 }, vmt) end
MESH_PRESSED = nil
local cmt = {}
cmt.__index = cmt
rgbm = setmetatable({}, { __call = function(_, r, g, b, m) return setmetatable({ r = r or 1, g = g or 1, b = b or 1, mult = m or 1 }, cmt) end })
rgbm.colors = { white = rgbm(1,1,1,1) }
script = {}
CALLS = {}
local function rec(name) return function(...) CALLS[#CALLS + 1] = name return 0 end end
local font = { weight = function(self) return self end }
MOUSE = { x = -1, y = -1, down = false, clicked = false }
ui = setmetatable({
  DWriteFont = setmetatable({ Weight = { Bold = 700 } }, { __call = function() return font end }),
  Alignment = { Start = -1, Center = 0, End = 1 },
  measureDWriteText = function(t, s) return vec2(#t * s * 0.6, s * 1.33) end,
  mouseDown = function() return MOUSE.down end,
  mouseClicked = function() return MOUSE.clicked end,
  mouseReleased = function() return false end,
  rectHovered = function(a, b) return MOUSE.x >= a.x and MOUSE.x <= b.x and MOUSE.y >= a.y and MOUSE.y <= b.y end,
}, { __index = function(_, k) return rec(k) end })
STORAGE = {}
KERS = nil
TC = nil
ac = setmetatable({
  getSim = function() return sim end,
  skipFrame = rec('skipFrame'),
  storage = function(defaults) for k, v in pairs(defaults) do if STORAGE[k] == nil then STORAGE[k] = v end end return STORAGE end,
  log = function(...) LOGGED = table.concat({ ... }, ' ') end,
  warn = function(...) LOGGED = table.concat({ ... }, ' ') end,
  error = function(...) ERRORED = table.concat({ ... }, ' ') end,
  setKERS = function(v) KERS = v CALLS[#CALLS + 1] = 'setKERS' end,
  setTractionControl = function(v) TC = v CALLS[#CALLS + 1] = 'setTractionControl' end,
  isMeshPressed = function(name) return MESH_PRESSED == name end,
}, { __index = function(_, k) return rec(k) end })
CARV = { rpm = 4500, rpmLimiter = 8000, gear = 3, speedKmh = 0, focused = true, distanceToCamera = 2,
  physicsAvailable = true, tractionControlMode = 3, tractionControlModes = 6, isInPitlane = false }
car = setmetatable({}, { __index = function(_, k) local v = CARV[k] if v ~= nil then return v end return 0 end })
sim = setmetatable({}, { __index = function(_, k) if k == 'timeHours' then return 14 end return 0 end })
__dirname = 'C:/fake/extension'

-- utilidades del test: pulsar y soltar en un punto de la pantalla
function TAP(x, y)
  MOUSE.x, MOUSE.y = x, y
  MOUSE.down, MOUSE.clicked = true, true
  script.update(0.016)
  MOUSE.clicked = false
  script.update(0.016)
  MOUSE.down = false
  script.update(0.016)
end
function PRESS(x, y)
  MOUSE.x, MOUSE.y = x, y
  MOUSE.down, MOUSE.clicked = true, true
  script.update(0.016)
  MOUSE.clicked = false
end
function RELEASE()
  MOUSE.down = false
  script.update(0.016)
end
`;

describe('botones físicos del coche', () => {
  it('se emiten en la configuración con la malla, la zona y la acción', () => {
    const p = project();
    const d = p.displays[0];
    d.physicalButtons![0].point = { x: 0.1, y: 0.8, z: 0.4 };
    d.physicalButtons![0].radius = 0.04;
    d.physicalButtons![1].uv = { x: 0, y: 0.5, width: 0.5, height: 0.5 };
    const gen = generateConfigLua(p, d, profile.displays[0]);
    expect(gen.lua).toContain('physicalButtons = {');
    expect(gen.lua).toContain("mesh = 'ButtonPanel_01'");
    expect(gen.lua).toContain('radius = 0.04');
    expect(gen.lua).toContain("action = 'page_next'");
    expect(gen.lua).toContain("switchKey = 'b'");
    // los interruptores que usan también se inicializan
    expect(usedSwitches(d)).toEqual(['a', 'b']);
    // una malla vacía no se emite
    d.physicalButtons![0].mesh = '  ';
    expect(generateConfigLua(p, d, profile.displays[0]).lua).not.toContain('ButtonPanel_01');
  });

  it('pulsar la malla en el juego ejecuta la acción una sola vez por pulsación', async () => {
    const p = project();
    const lua = generateDisplayLua(generateConfigLua(p, p.displays[0], profile.displays[0]).lua, RUNTIME, 'driver_display');
    const engine = await new LuaFactory().createEngine();
    try {
      await engine.doString(STUBS);
      await engine.doString(lua);
      await engine.doString('script.update(0.016)');
      // la botonera del interruptor: una pulsación mantenida cuenta una vez ("al pulsar")
      await engine.doString("MESH_PRESSED = 'ButtonPanel_02'; for i = 1, 10 do script.update(0.016) end");
      expect(await engine.doString("return ACDG.sw('b')")).toBe(true);
      await engine.doString('MESH_PRESSED = nil; script.update(0.016)');
      await engine.doString("MESH_PRESSED = 'ButtonPanel_02'; for i = 1, 5 do script.update(0.016) end");
      expect(await engine.doString("return ACDG.sw('b')")).toBe(false);
      // la botonera de páginas cambia de página (la segunda tiene menos elementos)
      await engine.doString('MESH_PRESSED = nil; CALLS = {}; script.update(0.016)');
      const antes = Number(await engine.doString('return #CALLS'));
      await engine.doString("MESH_PRESSED = 'ButtonPanel_01'; script.update(0.016); MESH_PRESSED = nil");
      await engine.doString('for i = 1, 60 do script.update(0.016) end');
      await engine.doString('CALLS = {}; script.update(0.016)');
      expect(Number(await engine.doString('return #CALLS'))).toBeLessThan(antes);
      expect(await engine.doString('return ERRORED')).toBeFalsy();
    } finally {
      engine.global.close();
    }
  }, 30000);
});

describe('táctil: runtime Lua', () => {
  it('pulsar un botón conmuta el interruptor, cambia de página y mantiene el KERS', async () => {
    const p = project();
    const gen = generateConfigLua(p, p.displays[0], profile.displays[0]);
    const lua = generateDisplayLua(gen.lua, RUNTIME, 'driver_display');
    const engine = await new LuaFactory().createEngine();
    try {
      await engine.doString(STUBS);
      await engine.doString(lua);
      expect(await engine.doString('return ERRORED')).toBeFalsy();

      // interruptor táctil: una pulsación lo pone, otra lo quita (y se guarda en el almacenamiento)
      await engine.doString('script.update(0.016)');
      await engine.doString('TAP(150, 150)');
      expect(await engine.doString("return ACDG.sw('a')")).toBe(true);
      expect(Number(await engine.doString('return STORAGE.sw_a'))).toBe(1);
      await engine.doString('TAP(150, 150)');
      expect(await engine.doString("return ACDG.sw('a')")).toBe(false);

      // fuera de cualquier botón no pasa nada
      await engine.doString('TAP(1500, 900)');
      expect(await engine.doString("return ACDG.sw('a')")).toBe(false);

      // KERS mientras se mantiene: se activa al pulsar y se suelta al levantar
      await engine.doString('PRESS(750, 150)');
      expect(await engine.doString('return KERS')).toBe(true);
      await engine.doString('RELEASE()');
      expect(await engine.doString('return KERS')).toBe(false);

      // repetición: manteniendo TC+ sube varias veces
      await engine.doString('PRESS(1050, 150)');
      await engine.doString('for i = 1, 40 do script.update(0.016) end');
      await engine.doString('RELEASE()');
      expect(Number(await engine.doString('return TC'))).toBeGreaterThan(3);

      // botón de página: pasa a la segunda página (menos elementos que la primera)
      await engine.doString('CALLS = {}; script.update(0.016)');
      const antes = Number(await engine.doString('return #CALLS'));
      await engine.doString('TAP(450, 150)');
      // se deja terminar el fundido entre páginas (durante él se dibujan las dos)
      await engine.doString('MOUSE.x = -1; for i = 1, 60 do script.update(0.016) end');
      await engine.doString('CALLS = {}; script.update(0.016)');
      const despues = Number(await engine.doString('return #CALLS'));
      expect(despues).toBeLessThan(antes);
      expect(await engine.doString('return ERRORED')).toBeFalsy();
    } finally {
      engine.global.close();
    }
  }, 30000);

  it('la pulsación se detecta por el flanco del ratón aunque CSP se salte frames', async () => {
    // con SKIP_FRAMES (o pocos Hz de refresco) el script no corre en todos los frames y el aviso de
    // ui.mouseClicked() se pierde: el flanco se calcula en el runtime a partir de ui.mouseDown()
    const p = project();
    p.displays[0].settings.refreshHz = 20;
    const lua = generateDisplayLua(generateConfigLua(p, p.displays[0], profile.displays[0]).lua, RUNTIME, 'driver_display');
    const engine = await new LuaFactory().createEngine();
    try {
      await engine.doString(STUBS);
      await engine.doString(lua);
      await engine.doString('script.update(0.016)');
      // MOUSE.clicked se queda en false: solo se mantiene el botón pulsado
      await engine.doString('MOUSE.x, MOUSE.y = 150, 150; MOUSE.down = true; for i = 1, 20 do script.update(0.016) end');
      expect(await engine.doString("return ACDG.sw('a')")).toBe(true);
      // "al tocar" no se repite mientras se mantiene
      await engine.doString('for i = 1, 20 do script.update(0.016) end');
      expect(await engine.doString("return ACDG.sw('a')")).toBe(true);
      await engine.doString('MOUSE.down = false; script.update(0.016); MOUSE.down = true; for i = 1, 10 do script.update(0.016) end');
      expect(await engine.doString("return ACDG.sw('a')")).toBe(false);
      expect(await engine.doString('return ERRORED')).toBeFalsy();
    } finally {
      engine.global.close();
    }
  }, 30000);

  it('sin táctil no se consulta el puntero y el gesto cambia de página', async () => {
    const p = project();
    const d = p.displays[0];
    d.settings.touch.mode = 'off';
    const off = generateDisplayLua(generateConfigLua(p, d, profile.displays[0]).lua, RUNTIME, 'driver_display');
    const e1 = await new LuaFactory().createEngine();
    try {
      await e1.doString(STUBS);
      await e1.doString(off);
      await e1.doString('script.update(0.016)');
      await e1.doString('TAP(150, 150)');
      expect(await e1.doString("return ACDG.sw('a')")).toBe(false);
      expect(await e1.doString('return ERRORED')).toBeFalsy();
    } finally {
      e1.global.close();
    }

    // gestos: deslizar de derecha a izquierda pasa a la página siguiente
    d.settings.touch.mode = 'auto';
    d.settings.touch.swipePages = true;
    d.settings.touch.swipePct = 25;
    const on = generateDisplayLua(generateConfigLua(p, d, profile.displays[0]).lua, RUNTIME, 'driver_display');
    const e2 = await new LuaFactory().createEngine();
    try {
      await e2.doString(STUBS);
      await e2.doString(on);
      await e2.doString('CALLS = {}; script.update(0.016)');
      const antes = Number(await e2.doString('return #CALLS'));
      // empieza en el borde derecho (sin botón debajo) y levanta en el izquierdo
      await e2.doString('PRESS(1500, 800)');
      await e2.doString('MOUSE.x = 100; RELEASE()');
      await e2.doString('MOUSE.x = -1; for i = 1, 60 do script.update(0.016) end');
      await e2.doString('CALLS = {}; script.update(0.016)');
      expect(Number(await e2.doString('return #CALLS'))).toBeLessThan(antes);
      expect(await e2.doString('return ERRORED')).toBeFalsy();
    } finally {
      e2.global.close();
    }
  }, 30000);
});
