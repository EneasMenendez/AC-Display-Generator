import { createElement, createPage, createTrigger, type ButtonElement, type Page, type RpmBarElement, type TextElement, type ShiftLightElement, type IconElement, type BarElement, type RectElement } from './model';

/**
 * Plantillas de pantallas de funcionalidad: generan páginas con elementos normales, editables después.
 * Coordenadas relativas al lienzo (w × h) para que valgan en cualquier resolución.
 */
export type TemplateId = 'launch' | 'pit_limiter' | 'settings' | 'fuel' | 'touch_menu';

export const TEMPLATES: { id: TemplateId; label: string; description: string }[] = [
  { id: 'launch', label: 'Launch control', description: 'Con el botón KERS mantenido y el coche parado: rpm actuales frente al objetivo, barra de rpm y luz READY.' },
  { id: 'pit_limiter', label: 'Limitador de boxes', description: 'Automática al entrar en boxes o al poner el limitador: velocidad, límite y tiempo en pit lane.' },
  { id: 'settings', label: 'Ajustes del coche', description: 'Conmutable con Extra A: freno, ABS, TC, mapa de motor y presiones.' },
  { id: 'fuel', label: 'Combustible / estrategia', description: 'Conmutable con Extra B: litros, vueltas restantes y consumo por vuelta.' },
  { id: 'touch_menu', label: 'Menú táctil', description: 'Barra de botones táctiles: página anterior/siguiente, luces y un interruptor propio.' },
];

function text(x: number, y: number, w: number, h: number, variable: string | undefined, opts: Partial<TextElement['binding']> & { staticText?: string; size?: number; color?: string; align?: TextElement['style']['align']; name?: string } = {}): TextElement {
  const el = createElement('text', x, y) as TextElement;
  el.width = w;
  el.height = h;
  el.binding = { variable, decimals: 0, prefix: '', suffix: '', padZeros: 0, showSign: false, ...opts, staticText: opts.staticText };
  if (!variable) el.binding.variable = undefined;
  el.style.size = opts.size ?? Math.round(h * 0.7);
  if (opts.color) el.style.color = opts.color;
  if (opts.align) el.style.align = opts.align;
  if (opts.name) el.name = opts.name;
  return el;
}

/** Botón táctil de una plantilla. */
function button(x: number, y: number, w: number, h: number, label: string, action: ButtonElement['config']['action'], opts: { name?: string; switchKey?: string; color?: string } = {}): ButtonElement {
  const el = createElement('button', x, y) as ButtonElement;
  el.width = w;
  el.height = h;
  el.name = opts.name ?? label;
  el.config.label = label;
  el.config.action = action;
  if (opts.switchKey) el.config.switch = opts.switchKey;
  if (opts.color) el.config.fillOn = opts.color;
  el.config.style.size = Math.round(h * 0.4);
  return el;
}

export function createTemplatePage(id: TemplateId, canvas: { width: number; height: number }, limiterRpm: number): Page {
  const W = canvas.width;
  const H = canvas.height;
  const px = (f: number) => Math.round(W * f);
  const py = (f: number) => Math.round(H * f);
  switch (id) {
    case 'launch': {
      const p = createPage('Launch control', 'function');
      p.trigger = { ...createTrigger('kers_button'), mode: 'hold', enter: [{ variable: 'speed', op: '<', value: 5 }], exit: [{ variable: 'speed', op: '>', value: 30 }], priority: 10 };
      const bg = createElement('rect', 0, 0) as RectElement;
      bg.width = W;
      bg.height = H;
      bg.config.fill = '#000000FF';
      bg.name = 'Fondo';
      const title = text(px(0.05), py(0.06), px(0.9), py(0.14), undefined, { staticText: 'LAUNCH CONTROL', color: '#FFB000', name: 'Título' });
      title.rules.push({ id: 'blink', when: { variable: 'kers_button', op: '==', value: true }, set: { blinkHz: 2 } });
      const bar = createElement('rpm_bar', px(0.05), py(0.24)) as RpmBarElement;
      bar.width = px(0.9);
      bar.height = py(0.12);
      bar.config.segments = 20;
      const target = Math.round(limiterRpm * 0.6);
      const rpm = text(px(0.05), py(0.42), px(0.42), py(0.3), 'rpm', { suffix: '', name: 'RPM actuales', color: '#FFFFFF' });
      const tgt = text(px(0.53), py(0.42), px(0.42), py(0.3), undefined, { staticText: String(target), name: 'RPM objetivo', color: '#28C840' });
      const lblA = text(px(0.05), py(0.72), px(0.42), py(0.08), undefined, { staticText: 'RPM', color: '#888888', name: 'Etiqueta rpm' });
      const lblB = text(px(0.53), py(0.72), px(0.42), py(0.08), undefined, { staticText: 'OBJETIVO', color: '#888888', name: 'Etiqueta objetivo' });
      const ready = createElement('shift_light', px(0.44), py(0.82)) as ShiftLightElement;
      ready.width = py(0.12);
      ready.height = py(0.12);
      ready.name = 'READY';
      ready.config.rpmOn = target - 300;
      ready.config.rpmOff = target - 500;
      ready.config.colorOn = '#28C840';
      ready.config.blinkHz = 0;
      const readyTxt = text(px(0.05), py(0.83), px(0.9), py(0.1), undefined, { staticText: 'READY', color: '#28C840', name: 'Texto READY' });
      readyTxt.visible = true;
      readyTxt.rules.push({ id: 'r1', when: { variable: 'rpm', op: '<', value: target - 300 }, set: { visible: false } });
      p.elements.push(bg, title, bar, rpm, tgt, lblA, lblB, ready, readyTxt);
      return p;
    }
    case 'pit_limiter': {
      const p = createPage('Limitador de boxes', 'normal');
      // en boxes (automático) o con el limitador puesto a mano fuera de ellos
      p.when = { variable: 'in_pitlane', op: '==', value: true };
      p.whenAny = [{ variable: 'pit_limiter', op: '==', value: true }];
      const bg = createElement('rect', 0, 0) as RectElement;
      bg.width = W;
      bg.height = H;
      bg.config.fill = '#000000FF';
      bg.name = 'Fondo';
      const title = text(px(0.05), py(0.06), px(0.9), py(0.14), undefined, { staticText: 'PIT LANE', color: '#2D7BFF', name: 'Título' });
      const limOn = text(px(0.05), py(0.06), px(0.9), py(0.14), undefined, { staticText: 'PIT LIMITER', color: '#28C840', name: 'Limitador puesto' });
      limOn.visible = true;
      // con el limitador puesto: el título cambia a "PIT LIMITER" parpadeando; sin él se ve "PIT LANE"
      limOn.rules.push({ id: 'off', when: { variable: 'pit_limiter', op: '==', value: false }, set: { visible: false } });
      limOn.rules.push({ id: 'blink', when: { variable: 'pit_limiter', op: '==', value: true }, set: { blinkHz: 1.5 } });
      title.rules.push({ id: 'hide', when: { variable: 'pit_limiter', op: '==', value: true }, set: { visible: false } });
      const speed = text(px(0.05), py(0.28), px(0.9), py(0.4), 'speed', { suffix: ' km/h', name: 'Velocidad', color: '#FFFFFF' });
      const lim = text(px(0.05), py(0.7), px(0.9), py(0.1), undefined, { staticText: 'LÍMITE 80 km/h', color: '#888888', name: 'Límite' });
      const tPit = text(px(0.05), py(0.82), px(0.9), py(0.1), 'page_time', { decimals: 1, suffix: ' s en boxes', color: '#888888', name: 'Tiempo' });
      p.elements.push(bg, title, limOn, speed, lim, tPit);
      return p;
    }
    case 'settings': {
      const p = createPage('Ajustes', 'function');
      p.trigger = { ...createTrigger('extra_a'), mode: 'toggle', priority: 5, returnTo: 'previous' };
      const bg = createElement('rect', 0, 0) as RectElement;
      bg.width = W;
      bg.height = H;
      bg.config.fill = '#000000FF';
      bg.name = 'Fondo';
      const title = text(px(0.05), py(0.05), px(0.9), py(0.12), undefined, { staticText: 'AJUSTES', color: '#FFB000', name: 'Título' });
      const rows: [string, string, Partial<TextElement['binding']>][] = [
        ['REPARTO FRENO', 'brake_bias', { decimals: 1, suffix: ' %' }],
        ['ABS', 'abs_mode', {}],
        ['TC', 'tc_mode', {}],
        ['TURBO', 'turbo_boost', { decimals: 2, suffix: ' bar' }],
        ['COMBUSTIBLE', 'fuel', { decimals: 1, suffix: ' L' }],
      ];
      const rowH = 0.14;
      rows.forEach(([label, variable, b], i) => {
        const y = py(0.2 + i * rowH);
        p.elements.push(text(px(0.05), y, px(0.5), py(rowH * 0.8), undefined, { staticText: label, color: '#AAAAAA', align: 'left', name: label }));
        p.elements.push(text(px(0.55), y, px(0.4), py(rowH * 0.8), variable, { ...b, color: '#FFFFFF', align: 'right', name: `Valor ${label}` }));
      });
      p.elements.unshift(bg);
      p.elements.splice(1, 0, title);
      return p;
    }
    case 'fuel': {
      const p = createPage('Combustible', 'function');
      p.trigger = { ...createTrigger('extra_b'), mode: 'toggle', priority: 5, returnTo: 'previous' };
      const bg = createElement('rect', 0, 0) as RectElement;
      bg.width = W;
      bg.height = H;
      bg.config.fill = '#000000FF';
      bg.name = 'Fondo';
      const title = text(px(0.05), py(0.05), px(0.9), py(0.12), undefined, { staticText: 'COMBUSTIBLE', color: '#FFB000', name: 'Título' });
      const fuel = text(px(0.05), py(0.2), px(0.44), py(0.3), 'fuel', { decimals: 1, suffix: ' L', color: '#FFFFFF', name: 'Litros' });
      const laps = text(px(0.51), py(0.2), px(0.44), py(0.3), 'fuel_laps_left', { decimals: 1, suffix: ' vueltas', color: '#28C840', name: 'Vueltas restantes' });
      const per = text(px(0.05), py(0.55), px(0.9), py(0.12), 'fuel_per_lap', { decimals: 2, prefix: 'Consumo: ', suffix: ' L/vuelta', color: '#AAAAAA', name: 'Consumo' });
      const bar = createElement('bar', px(0.05), py(0.75)) as BarElement;
      bar.width = px(0.9);
      bar.height = py(0.12);
      bar.config.variable = 'fuel_pct';
      bar.config.min = 0;
      bar.config.max = 1;
      bar.config.thresholds = [{ value: 0.15, color: '#FF2D2D' }];
      bar.name = 'Nivel';
      const icon = createElement('icon', px(0.02), py(0.05)) as IconElement;
      icon.config.icon = 'builtin:fuel';
      icon.config.variable = 'low_fuel';
      icon.config.showWhen = 'when_true';
      icon.width = py(0.12);
      icon.height = py(0.12);
      icon.name = 'Aviso combustible';
      p.elements.push(bg, title, fuel, laps, per, bar, icon);
      return p;
    }
    case 'touch_menu': {
      const p = createPage('Menú táctil', 'normal');
      const bg = createElement('rect', 0, 0) as RectElement;
      bg.width = W;
      bg.height = H;
      bg.config.fill = '#000000FF';
      bg.name = 'Fondo';
      const title = text(px(0.05), py(0.08), px(0.9), py(0.16), undefined, { staticText: 'MENÚ', color: '#FFB000', name: 'Título' });
      const speed = text(px(0.05), py(0.3), px(0.9), py(0.28), 'speed', { suffix: ' km/h', color: '#FFFFFF', name: 'Velocidad' });
      // barra de botones: anterior, luces, interruptor propio y siguiente
      const bw = px(0.22);
      const bh = py(0.2);
      const by = py(0.72);
      const gap = px(0.02);
      const x0 = (W - (bw * 4 + gap * 3)) / 2;
      const prev = button(x0, by, bw, bh, '◀', 'page_prev', { name: 'Página anterior' });
      const lights = button(x0 + bw + gap, by, bw, bh, 'LUCES', 'headlights', { name: 'Luces', color: '#FFB00066' });
      const sw = button(x0 + (bw + gap) * 2, by, bw, bh, 'MODO', 'switch_toggle', { name: 'Interruptor A', switchKey: 'a', color: '#28C84066' });
      const next = button(x0 + (bw + gap) * 3, by, bw, bh, '▶', 'page_next', { name: 'Página siguiente' });
      p.elements.push(bg, title, speed, prev, lights, sw, next);
      return p;
    }
  }
}
