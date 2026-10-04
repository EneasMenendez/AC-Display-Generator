import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LuaFactory } from 'wasmoon';
import { createElement, createEmptyProject, createPage, createTrigger, pageConditions, type Project, type TextElement, type VideoElement } from '../src/shared/model';
import { createTemplatePage, TEMPLATES } from '../src/shared/templates';
import { parseProfile } from '../src/shared/profile';
import { generateConfigLua, generateDisplayLua, collectVariables } from '../src/shared/generator';
import { PageEngine } from '../src/renderer/src/render/pageEngine';
import { resolveSim } from '../src/renderer/src/sim';

const profile = parseProfile(JSON.parse(readFileSync('resources/profiles/av_toyota_starlet_millington.display_profile.json', 'utf8'))).profile!;

/** Proyecto con arranque (2 pantallas), launch control (KERS mantenido, parado) y página principal. */
function project(): Project {
  const p = createEmptyProject({ name: 'pg', profileId: profile.id, profileVersion: 2, carId: 'x', appVersion: '0', displays: [{ displayId: 'driver_display', name: 'D', width: 1593, height: 987 }] });
  const d = p.displays[0];
  const logo = createPage('Logo', 'boot');
  logo.duration = 1;
  const t = createElement('text') as TextElement;
  t.binding = { variable: undefined, staticText: 'HOLA', decimals: 0, prefix: '', suffix: '', padZeros: 0, showSign: false };
  t.anim = { delay: 0.2, fadeIn: 0.3, fadeOut: 0.3, from: 'up', distance: 40 };
  logo.elements.push(t);
  const intro = createPage('Intro', 'boot');
  intro.duration = 2;
  const v = createElement('video') as VideoElement;
  v.config.file = 'assets/intro.mp4';
  intro.elements.push(v);
  const launch = createPage('Launch', 'function');
  launch.trigger = { ...createTrigger('kers_button'), mode: 'hold', enter: [{ variable: 'speed', op: '<', value: 5 }], priority: 10 };
  launch.elements.push(createElement('rpm_bar'));
  d.pages.unshift(logo, intro);
  d.pages.push(launch, createTemplatePage('fuel', d.canvas, 8000));
  d.settings.boot = { ...d.settings.boot, transition: 'fade', transitionS: 0.5, sound: 'assets/boot.wav', skipSpeedKmh: 50 };
  return p;
}

describe('máquina de páginas (editor)', () => {
  it('arranque → principal, launch control con KERS y coche parado, conmutación con Extra B', () => {
    const p = project();
    const d = p.displays[0];
    const eng = new PageEngine();
    const ctx = (over: Record<string, number | boolean>, t: number) => resolveSim({ rpm: 3000, speed: 0, ...over }, profile.displays[0].defaults, t, 1);
    eng.requestBoot();
    let r = eng.step(d, ctx({}, 0), 0)!;
    expect(r.page.name).toBe('Logo');
    r = eng.step(d, ctx({}, 1.2), 1.2)!;
    expect(r.page.name).toBe('Intro');
    expect(r.pageTime).toBeCloseTo(0, 1);
    r = eng.step(d, ctx({}, 3.5), 3.5)!;
    expect(r.page.name).toBe('Principal');
    r = eng.step(d, ctx({}, 3.7), 3.7)!;
    expect(r.from?.name).toBe('Intro');
    expect(r.k).toBeGreaterThan(0);
    expect(r.k).toBeLessThan(1);
    // KERS mantenido y parado → launch; en marcha no
    r = eng.step(d, ctx({ kers_button: true }, 5), 5)!;
    expect(r.page.name).toBe('Launch');
    r = eng.step(d, ctx({ kers_button: true, speed: 40 }, 6), 6)!;
    expect(r.page.name).toBe('Principal');
    // Extra B conmuta la pantalla de combustible (prioridad menor que launch)
    r = eng.step(d, ctx({ extra_b: true }, 7), 7)!;
    expect(r.page.name).toBe('Combustible');
    r = eng.step(d, ctx({ extra_b: false }, 7.5), 7.5)!;
    expect(r.page.name).toBe('Combustible');
    r = eng.step(d, ctx({ extra_b: true }, 8), 8)!;
    expect(r.page.name).toBe('Principal');
    // arranque saltado por velocidad
    eng.requestBoot();
    r = eng.step(d, ctx({ speed: 80 }, 9), 9)!;
    expect(r.page.name).toBe('Principal');
  });
  it('la página de boxes se muestra en pit lane o con el limitador puesto (cualquiera de las dos)', () => {
    const p = project();
    const d = p.displays[0];
    d.pages.splice(3, 0, createTemplatePage('pit_limiter', d.canvas, 8000));
    const eng = new PageEngine();
    const ctx = (over: Record<string, number | boolean>, t: number) => resolveSim({ rpm: 3000, speed: 60, ...over }, profile.displays[0].defaults, t, 1);
    expect(eng.step(d, ctx({}, 0), 0)!.page.name).toBe('Principal');
    expect(eng.step(d, ctx({ in_pitlane: true }, 1), 1)!.page.name).toBe('Limitador de boxes');
    expect(eng.step(d, ctx({ in_pitlane: false, pit_limiter: true }, 2), 2)!.page.name).toBe('Limitador de boxes');
    expect(eng.step(d, ctx({ in_pitlane: false, pit_limiter: false }, 3), 3)!.page.name).toBe('Principal');
    expect(collectVariables(d)).toContain('pit_limiter');
  });
  it('las plantillas generan páginas válidas y sus variables existen', () => {
    for (const t of TEMPLATES) {
      const pg = createTemplatePage(t.id, { width: 1024, height: 512 }, 8000);
      expect(pg.elements.length).toBeGreaterThan(2);
      // las normales se eligen por condición o, si llevan botones táctiles, con el dedo
      expect(pg.kind === 'function' ? !!pg.trigger : pageConditions(pg).length > 0 || pg.elements.some((e) => e.type === 'button')).toBe(true);
    }
    const p = project();
    const vars = collectVariables(p.displays[0]);
    expect(vars).toContain('kers_button');
    expect(vars).toContain('speed');
    expect(vars).toContain('fuel_laps_left');
  });
});

describe('máquina de páginas (runtime Lua)', () => {
  it('reproduce el arranque, reinicia el vídeo y activa launch control con KERS', async () => {
    const p = project();
    const gen = generateConfigLua(p, p.displays[0], profile.displays[0]);
    expect(gen.assets).toContainEqual({ source: 'assets/intro.mp4', target: 'driver_display_intro.mp4' });
    expect(gen.assets).toContainEqual({ source: 'assets/boot.wav', target: 'driver_display_boot.wav' });
    const lua = generateDisplayLua(gen.lua, readFileSync('resources/runtime/acdg_runtime.lua', 'utf8'), 'driver_display');
    const stubs = readFileSync('tests/runtime.test.ts', 'utf8').match(/const STUBS = `([\s\S]*?)`;/)![1];
    const engine = await new LuaFactory().createEngine();
    try {
      await engine.doString(stubs);
      await engine.doString('CARV.speedKmh = 0');
      await engine.doString(lua);
      expect(await engine.doString('return ERRORED')).toBeFalsy();
      // frame 0: primera pantalla de arranque (sonido reproducido); tras 1,1 s la segunda (vídeo reiniciado)
      await engine.doString('script.update(0.016)');
      const played0 = Number(await engine.doString('return PLAYED or 0'));
      expect(played0).toBeGreaterThanOrEqual(1);
      await engine.doString('for i = 1, 70 do script.update(0.016) end');
      const played1 = Number(await engine.doString('return PLAYED or 0'));
      expect(played1).toBeGreaterThan(played0);
      // tras 3,5 s ya está en la página principal; KERS parado → launch (rpm_bar dibuja rectángulos)
      await engine.doString('for i = 1, 150 do script.update(0.016) end');
      await engine.doString('CALLS = {}; CARV.kersButtonPressed = true; CARV.speedKmh = 0; script.update(0.016)');
      const n1 = Number(await engine.doString('local n = 0 for i = 1, #CALLS do if CALLS[i] == "drawRectFilled" then n = n + 1 end end return n'));
      expect(n1).toBeGreaterThan(10);
      // al salir se funde durante 0,5 s (la página anterior sigue debajo); después ya no se dibuja
      await engine.doString('CARV.speedKmh = 60; for i = 1, 40 do script.update(0.016) end; CALLS = {}; script.update(0.016)');
      const n2 = Number(await engine.doString('local n = 0 for i = 1, #CALLS do if CALLS[i] == "drawRectFilled" then n = n + 1 end end return n'));
      expect(n2).toBeLessThan(n1);
      expect(await engine.doString('return ERRORED')).toBeFalsy();
    } finally {
      engine.global.close();
    }
  }, 30000);
});
