import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LuaFactory, type LuaEngine } from 'wasmoon';
import type { BarElement, CircleElement, RpmBarElement, Color, DisplayElement, GearElement, IconElement, ImageElement, LineElement, RectElement, TextAlign, TextElement, TimeFormat } from '@shared/model';
import { createElement, DEFAULT_TEXT_STYLE } from '@shared/model';
import { VARIABLES } from '@shared/variables';
import type { LuaImportResult } from '@shared/types';

/**
 * Importador de displays hechos a mano: ejecuta el script Lua en una máquina virtual aislada (wasmoon)
 * con `car`/`sim` simulados que registran qué campos se leen, graba todas las llamadas de dibujo
 * (display.* / ui.*) y las convierte en elementos del editor. Para saber qué variable alimenta cada
 * texto o barra se vuelve a ejecutar el script perturbando cada campo leído y se observa qué cambia.
 */

type Vec = { x: number; y: number };
type Rgbm = { r: number; g: number; b: number; mult?: number };

interface Call {
  fn: string;
  args: Record<string, unknown>;
  accessed: string[];
  font?: string;
}

const FIELD_DEFAULTS: Record<string, number | boolean> = {};
for (const v of VARIABLES) {
  const m = /^car\.([A-Za-z0-9_]+)$/.exec(v.lua);
  if (m && typeof v.preview !== 'string') FIELD_DEFAULTS[m[1]] = v.preview;
}
Object.assign(FIELD_DEFAULTS, { rpmLimiter: 8000, maxFuel: 60, physicsAvailable: true, focused: true, isEngineLimiterOn: false, distanceToCamera: 3, prefersImperialUnits: false });

const PRELUDE = `
script = script or {}
local vmt = {}
vmt.__index = vmt
vmt.__add = function(a, b) if type(b) == 'number' then return vec2(a.x + b, a.y + b) end return vec2(a.x + b.x, a.y + b.y) end
vmt.__sub = function(a, b) if type(b) == 'number' then return vec2(a.x - b, a.y - b) end return vec2(a.x - b.x, a.y - b.y) end
vmt.__mul = function(a, b) if type(a) == 'number' then return vec2(a * b.x, a * b.y) end if type(b) == 'number' then return vec2(a.x * b, a.y * b) end return vec2(a.x * b.x, a.y * b.y) end
vmt.__div = function(a, b) if type(b) == 'number' then return vec2(a.x / b, a.y / b) end return vec2(a.x / b.x, a.y / b.y) end
vmt.__unm = function(a) return vec2(-a.x, -a.y) end
vmt.__eq = function(a, b) return a.x == b.x and a.y == b.y end
function vmt:clone() return vec2(self.x, self.y) end
function vmt:set(x, y) if type(x) == 'table' then self.x, self.y = x.x, x.y else self.x, self.y = x, y end return self end
function vmt:length() return math.sqrt(self.x * self.x + self.y * self.y) end
function vec2(x, y) return setmetatable({ x = x or 0, y = y or 0 }, vmt) end
local cmt = {}
cmt.__index = cmt
cmt.__mul = function(a, b) if type(b) == 'number' then return rgbm(a.r * b, a.g * b, a.b * b, a.mult) end return a end
function cmt:clone() return rgbm(self.r, self.g, self.b, self.mult) end
rgbm = setmetatable({}, { __call = function(_, r, g, b, m) return setmetatable({ r = r or 1, g = g or 1, b = b or 1, mult = m or 1 }, cmt) end })
rgb = setmetatable({}, { __call = function(_, r, g, b) return rgbm(r, g, b, 1) end })
rgbm.colors = { white = rgbm(1,1,1,1), black = rgbm(0,0,0,1), red = rgbm(1,0,0,1), green = rgbm(0,1,0,1), blue = rgbm(0,0,1,1), yellow = rgbm(1,1,0,1), transparent = rgbm(0,0,0,0), gray = rgbm(0.5,0.5,0.5,1) }
math.saturate = function(x) if x < 0 then return 0 elseif x > 1 then return 1 end return x end
math.clamp = function(x, a, b) if x < a then return a elseif x > b then return b end return x end
math.lerp = function(a, b, k) return a + (b - a) * k end
math.round = function(x) return math.floor(x + 0.5) end
math.sign = function(x) if x > 0 then return 1 elseif x < 0 then return -1 end return 0 end
unpack = unpack or table.unpack
local sf = string.format
string.format = function(fmt, ...)
  local args = { ... }
  local i = 0
  fmt = tostring(fmt):gsub('%%[%-%+ #0]*%d*%.?%d*([diouxXcs])', function(spec)
    i = i + 1
    if spec ~= 's' and spec ~= 'c' and type(args[i]) == 'number' then args[i] = math.floor(args[i] + 0.5) end
    return '%' .. spec
  end)
  return sf(fmt, table.unpack(args))
end
ui.Alignment = { Start = -1, Center = 0, End = 1 }
ui.ImageFit = { Stretch = 0, Fill = 1, Fit = 2 }
ui.CornerFlags = { All = 15, None = 0 }
ui.DWriteFont = function(name) return tostring(name) end
ui.Icons = setmetatable({}, { __index = function(_, k) return 'icon:' .. tostring(k) end })
function require(name) return {} end
`;

function num(v: unknown, d = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : d;
}
function vec(v: unknown, d: Vec = { x: 0, y: 0 }): Vec {
  if (typeof v === 'number') return { x: v, y: v };
  const o = v as Vec | undefined;
  return o && typeof o === 'object' ? { x: num(o.x), y: num(o.y) } : d;
}
function hex(c: unknown, fallback = '#FFFFFF'): Color {
  const o = c as Rgbm | undefined;
  if (!o || typeof o !== 'object') return fallback;
  const h = (x: number) => Math.max(0, Math.min(255, Math.round(num(x, 1) * 255))).toString(16).padStart(2, '0');
  const a = num(o.mult, 1);
  return (`#${h(o.r)}${h(o.g)}${h(o.b)}` + (a < 0.999 ? h(a) : '')).toUpperCase();
}

class Sandbox {
  private engine!: LuaEngine;
  calls: Call[] = [];
  private accessed = new Set<string>();
  private values: Record<string, number | boolean> = {};
  private font = '';
  readonly touched = new Set<string>();

  constructor(private code: string, private scriptDir: string, private width: number, private height: number) {}

  async init(): Promise<void> {
    this.engine = await new LuaFactory().createEngine();
    const g = this.engine.global;
    const self = this;
    const carProxy = new Proxy(
      {},
      {
        get(_t, k) {
          const key = String(k);
          if (typeof k === 'symbol' || key === 'then' || key === 'toJSON') return undefined;
          self.accessed.add(key);
          self.touched.add(key);
          if (key === 'wheels') return [0, 1, 2, 3].map(() => new Proxy({}, { get: (_w, wk) => (typeof wk === 'symbol' || wk === 'then' ? undefined : 50) }));
          const v = self.values[key];
          if (v !== undefined) return v;
          const d = FIELD_DEFAULTS[key];
          if (d !== undefined) return d;
          return /^(is|has)[A-Z]/.test(key) ? false : 0;
        },
      },
    );
    const simProxy = new Proxy({}, { get: (_t, k) => (typeof k === 'symbol' || k === 'then' ? undefined : k === 'timeHours' ? 14 : k === 'carsCount' ? 1 : 0) });
    const rec = (fn: string, names: string[]) => (...a: unknown[]) => {
      const args: Record<string, unknown> = {};
      if (a.length === 1 && a[0] && typeof a[0] === 'object' && !names.length) Object.assign(args, a[0] as object);
      else names.forEach((n, i) => (args[n] = a[i]));
      self.calls.push({ fn, args, accessed: [...self.accessed], font: self.font || undefined });
      self.accessed = new Set();
      return 0;
    };
    const noop = () => 0;
    g.set('car', carProxy);
    g.set('sim', simProxy);
    g.set('__dirname', this.scriptDir);
    g.set('display', {
      text: rec('display.text', []),
      rect: rec('display.rect', []),
      image: rec('display.image', []),
      horizontalBar: rec('display.horizontalBar', []),
      mirror: noop,
      interactiveMesh: () => ({}),
    });
    const ui: Record<string, unknown> = {
      drawRectFilled: rec('ui.drawRectFilled', ['p1', 'p2', 'color', 'rounding']),
      drawRect: rec('ui.drawRect', ['p1', 'p2', 'color', 'rounding', 'flags', 'thickness']),
      drawImage: rec('ui.drawImage', ['image', 'p1', 'p2', 'color', 'uv1', 'uv2', 'fit']),
      drawImageRounded: rec('ui.drawImage', ['image', 'p1', 'p2', 'color']),
      drawCircleFilled: rec('ui.drawCircleFilled', ['center', 'radius', 'color']),
      drawCircle: rec('ui.drawCircle', ['center', 'radius', 'color', 'segments', 'thickness']),
      drawLine: rec('ui.drawLine', ['p1', 'p2', 'color', 'thickness']),
      dwriteDrawText: rec('ui.dwriteDrawText', ['text', 'size', 'pos', 'color']),
      dwriteDrawTextClipped: rec('ui.dwriteDrawTextClipped', ['text', 'size', 'p1', 'p2', 'halign', 'valign', 'wrap', 'color']),
      drawText: rec('ui.drawText', ['text', 'pos', 'color']),
      dwriteText: rec('ui.dwriteText', ['text', 'size', 'color']),
      pushDWriteFont: (f: unknown) => {
        self.font = String(f ?? '');
        return 0;
      },
      popDWriteFont: () => {
        self.font = '';
        return 0;
      },
      measureDWriteText: (t: unknown, s: unknown) => ({ x: String(t ?? '').length * num(s, 16) * 0.55, y: num(s, 16) }),
      measureText: (t: unknown) => ({ x: String(t ?? '').length * 8, y: 16 }),
    };
    g.set('ui', new Proxy(ui, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : typeof k === 'symbol' || k === 'then' ? undefined : noop) }));
    const ac: Record<string, unknown> = {
      getSim: () => simProxy,
      getCar: () => carProxy,
      currentDisplaySize: () => ({ x: this.width, y: this.height }),
      currentDisplayTextureResolution: () => ({ x: this.width, y: this.height }),
      configValues: (t: unknown) => t,
      getCarConfig: () => 0,
      log: noop,
      debug: noop,
      warn: noop,
      error: noop,
      skipFrame: noop,
      boostFrameRate: noop,
      isSkippingFrame: () => false,
      getFolder: () => this.scriptDir,
      dirname: this.scriptDir,
      storage: () => ({}),
      loadDisplayValue: (_k: unknown, d: unknown) => d ?? '',
      saveDisplayValue: noop,
      getSession: () => ({ laps: 10, type: 3, durationMinutes: 0 }),
      getCarID: () => 'car',
    };
    g.set('ac', new Proxy(ac, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : typeof k === 'symbol' || k === 'then' ? undefined : noop) }));
    await this.engine.doString(PRELUDE);
    await this.engine.doString(this.code);
  }

  async run(values: Record<string, number | boolean>): Promise<Call[]> {
    this.values = values;
    this.calls = [];
    this.accessed = new Set();
    this.font = '';
    await this.engine.doString('local f = (script and script.update) or update; if f then f(0.016) end');
    return this.calls;
  }

  close(): void {
    this.engine.global.close();
  }
}

/* ---------- conversión de llamadas a elementos ---------- */

function textFormat(text: string): { decimals: number; prefix: string; suffix: string; timeFormat?: TimeFormat; numeric: boolean } {
  const t = text.trim();
  if (/^\d+'\d\d"\d\d$/.test(t)) return { decimals: 0, prefix: '', suffix: '', timeFormat: "m'ss\"mm", numeric: true };
  if (/^\d+:\d\d\.\d{3}$/.test(t)) return { decimals: 0, prefix: '', suffix: '', timeFormat: 'm:ss.mmm', numeric: true };
  if (/^\d+:\d\d\.\d$/.test(t)) return { decimals: 0, prefix: '', suffix: '', timeFormat: 'm:ss.m', numeric: true };
  if (/^\d+:\d\d:\d\d$/.test(t)) return { decimals: 0, prefix: '', suffix: '', timeFormat: 'h:mm:ss', numeric: true };
  const m = /^(.*?)([-+]?\d+(?:[.,](\d+))?)(.*)$/.exec(t);
  if (!m) return { decimals: 0, prefix: '', suffix: '', numeric: false };
  return { decimals: m[3] ? m[3].length : 0, prefix: m[1], suffix: m[4], numeric: true };
}

function varIdForField(field: string): string | undefined {
  return VARIABLES.find((v) => v.lua === `car.${field}`)?.id;
}

function callKey(c: Call): string {
  const p = (c.args.pos ?? c.args.p1 ?? c.args.center) as Vec | undefined;
  return `${c.fn}@${p ? `${Math.round(num(p.x))},${Math.round(num(p.y))}` : '?'}`;
}

export async function importLuaDisplay(scriptFile: string, width: number, height: number): Promise<LuaImportResult> {
  const code = readFileSync(scriptFile, 'utf8');
  const dir = dirname(scriptFile);
  const warnings: string[] = [];
  const sb = new Sandbox(code, dir, width, height);
  try {
    await sb.init();
  } catch (e) {
    sb.close();
    return { elements: [], background: null, warnings: [`El script no se pudo ejecutar en el simulador: ${(e as Error).message}`], calls: 0 };
  }
  let base: Call[];
  try {
    base = await sb.run({});
  } catch (e) {
    sb.close();
    return { elements: [], background: null, warnings: [`Error al ejecutar update(): ${(e as Error).message}`], calls: 0 };
  }

  // Ejecuciones perturbadas: qué campo cambia cada llamada (texto, tamaño, color) o su presencia.
  const numericFields = [...sb.touched].filter((f) => typeof (FIELD_DEFAULTS[f] ?? 0) === 'number' && !/^(is|has)[A-Z]/.test(f) && varIdForField(f));
  const boolFields = [...sb.touched].filter((f) => typeof FIELD_DEFAULTS[f] === 'boolean' || /^(is|has)[A-Z]/.test(f));
  // campos de configuración que no deben ganar frente a un dato vivo (p. ej. rpm frente a rpmLimiter)
  const CONFIG_FIELDS = new Set(['rpmLimiter', 'maxFuel', 'speedLimiter', 'gearCount', 'rpmMinimum', 'turboCount', 'absModes', 'tractionControlModes']);
  const raw = new Map<number, { text: string[]; size: string[]; color: string[] }>();
  const pick = (fields: string[]): string | undefined => fields.find((f) => !CONFIG_FIELDS.has(f)) ?? fields[0];
  const effects = new Map<number, { text?: string; size?: string; color?: string }>(); // índice de llamada → campo
  const presence = new Map<string, { field: string; whenTrue: boolean }>();
  const baseKeys = new Set(base.map(callKey));
  for (const f of numericFields) {
    const d = FIELD_DEFAULTS[f];
    const def = VARIABLES.find((v) => v.lua === `car.${f}`);
    const alt = f === 'gear' ? 5 : typeof d === 'number' ? (d === 0 ? 1 : d * 1.37 + 3) : 1;
    // segundo valor extremo (zona roja, avisos): máximo del catálogo o 97 % del limitador
    const high = f === 'rpm' ? num(FIELD_DEFAULTS.rpmLimiter, 8000) * 0.97 : def ? def.range[1] : alt * 2;
    let runs: Call[];
    try {
      runs = await sb.run({ [f]: alt });
      const runsHigh = await sb.run({ [f]: high });
      // se combinan: basta con que alguno de los dos valores altere la llamada
      runs = runs.map((c, i) => {
        const h = runsHigh[i];
        if (!h || h.fn !== c.fn) return c;
        return { ...c, args: { ...c.args, color: hex(h.args.color) !== hex(base[i]?.args.color) ? h.args.color : c.args.color } };
      });
    } catch {
      continue;
    }
    for (let i = 0; i < Math.min(runs.length, base.length); i++) {
      const a = base[i];
      const b = runs[i];
      if (a.fn !== b.fn) continue;
      const e = raw.get(i) ?? { text: [], size: [], color: [] };
      if (String(a.args.text ?? '') !== String(b.args.text ?? '')) e.text.push(f);
      const sa = JSON.stringify([a.args.size, a.args.p2, a.args.radius, a.args.active]);
      const sbv = JSON.stringify([b.args.size, b.args.p2, b.args.radius, b.args.active]);
      if (sa !== sbv) e.size.push(f);
      if (hex(a.args.color) !== hex(b.args.color)) e.color.push(f);
      raw.set(i, e);
    }
  }
  for (const [i, e] of raw) effects.set(i, { text: pick(e.text), size: pick(e.size), color: pick(e.color) });
  for (const f of boolFields) {
    let runs: Call[];
    try {
      runs = await sb.run({ [f]: !(FIELD_DEFAULTS[f] === true) });
    } catch {
      continue;
    }
    const keys = new Set(runs.map(callKey));
    for (const k of keys) if (!baseKeys.has(k)) presence.set(k, { field: f, whenTrue: FIELD_DEFAULTS[f] !== true });
    for (const k of baseKeys) if (!keys.has(k)) presence.set(k, { field: f, whenTrue: FIELD_DEFAULTS[f] === true });
  }
  // llamadas que solo aparecen con un booleano activo: se recuperan para importarlas como iconos
  const extraCalls: { call: Call; field: string; whenTrue: boolean }[] = [];
  for (const [k, p] of presence) {
    if (baseKeys.has(k)) continue;
    try {
      const runs = await sb.run({ [p.field]: p.whenTrue });
      const c = runs.find((x) => callKey(x) === k);
      if (c) extraCalls.push({ call: c, field: p.field, whenTrue: p.whenTrue });
    } catch {
      /* ignorar */
    }
  }
  sb.close();

  const elements: DisplayElement[] = [];
  let background: string | null = null;
  const consumed = new Set<number>();
  const fontsSeen = new Set<string>();

  const resolveImage = (p: unknown): string | null => {
    const rel = String(p ?? '').replace(/\\/g, '/');
    if (!rel) return null;
    for (const c of [join(dir, rel), join(dir, '..', rel), rel]) if (existsSync(c)) return c;
    return null;
  };

  const makeText = (text: string, x: number, y: number, w: number, h: number, size: number, align: TextAlign, color: Color, font: string | undefined, field: string | undefined, callIdx: number, i: number): DisplayElement => {
    const el = createElement('text', Math.round(x), Math.round(y)) as TextElement;
    el.width = Math.max(10, Math.round(w));
    el.height = Math.max(10, Math.round(h));
    el.style = { ...DEFAULT_TEXT_STYLE, size: Math.round(size), color, align, valign: 'top' };
    if (font && font !== 'Segoe UI') fontsSeen.add(font);
    const fmt = textFormat(text);
    const varId = field ? varIdForField(field) : undefined;
    if (field === 'gear') {
      const g = createElement('gear', el.x, el.y) as GearElement;
      g.width = el.width;
      g.height = el.height;
      g.config.style = { ...el.style, align: 'center' };
      g.name = 'Marcha';
      return g;
    }
    if (varId && fmt.numeric) {
      el.binding = { variable: varId, decimals: fmt.decimals, prefix: fmt.prefix, suffix: fmt.suffix, padZeros: 0, showSign: /^\+/.test(text.trim()), timeFormat: fmt.timeFormat };
      el.name = VARIABLES.find((v) => v.id === varId)?.label ?? varId;
    } else {
      el.binding = { staticText: text, decimals: 0, prefix: '', suffix: '', padZeros: 0, showSign: false };
      el.name = `Texto ${i + 1}`;
      if (field && !varId) warnings.push(`El texto "${text}" depende de car.${field}, que no está en el catálogo; se importa como texto fijo.`);
    }
    void callIdx;
    return el;
  };

  for (let i = 0; i < base.length; i++) {
    if (consumed.has(i)) continue;
    const c = base[i];
    const eff = effects.get(i) ?? {};
    const a = c.args;
    switch (c.fn) {
      case 'display.image':
      case 'ui.drawImage': {
        const pos = c.fn === 'display.image' ? vec(a.pos) : vec(a.p1);
        const size = c.fn === 'display.image' ? vec(a.size) : { x: vec(a.p2).x - pos.x, y: vec(a.p2).y - pos.y };
        const file = resolveImage(a.image);
        if (!file) {
          warnings.push(`Imagen no encontrada: ${String(a.image)}`);
          break;
        }
        if (Math.abs(pos.x) < 2 && Math.abs(pos.y) < 2 && Math.abs(size.x - width) < 3 && Math.abs(size.y - height) < 3) {
          background = background ?? file;
          // si el script pinta el fondo DESPUÉS de otros elementos (barras tapadas por una textura con alfa),
          // se conserva ese orden añadiendo la misma imagen como capa por encima
          if (elements.length > 0) {
            const ov = createElement('image', 0, 0) as ImageElement;
            ov.width = width;
            ov.height = height;
            ov.config.file = file;
            ov.config.tint = hex(a.color);
            ov.locked = true;
            ov.name = 'Fondo (capa superior)';
            elements.push(ov);
            warnings.push('El script dibuja el fondo encima de las barras: se ha añadido como capa "Fondo (capa superior)" para conservar el efecto.');
          }
          break;
        }
        const el = createElement('image', Math.round(pos.x), Math.round(pos.y)) as ImageElement;
        el.width = Math.round(size.x);
        el.height = Math.round(size.y);
        el.config.file = file;
        el.config.tint = hex(a.color);
        el.name = String(a.image).split('/').pop() ?? 'Imagen';
        elements.push(el);
        break;
      }
      case 'display.rect':
      case 'ui.drawRectFilled': {
        const pos = c.fn === 'display.rect' ? vec(a.pos) : vec(a.p1);
        const size = c.fn === 'display.rect' ? vec(a.size) : { x: vec(a.p2).x - pos.x, y: vec(a.p2).y - pos.y };
        if (Math.abs(pos.x) < 2 && Math.abs(pos.y) < 2 && size.x >= width - 2 && size.y >= height - 2) break; // limpiado de pantalla
        if (eff.size) {
          // barra: el rect anterior con la misma posición y tamaño fijo es el fondo
          const prev = i > 0 ? base[i - 1] : null;
          const prevPos = prev ? (prev.fn === 'display.rect' ? vec(prev.args.pos) : vec(prev.args.p1)) : null;
          const prevSize = prev ? (prev.fn === 'display.rect' ? vec(prev.args.size) : { x: vec(prev.args.p2).x - prevPos!.x, y: vec(prev.args.p2).y - prevPos!.y }) : null;
          const isBg = prev && prevPos && prevSize && !effects.get(i - 1)?.size && Math.abs(prevPos.x - pos.x) < 2 && Math.abs(prevPos.y - pos.y) < 2 && (prevSize.x >= size.x - 1 || prevSize.y >= size.y - 1);
          const full = isBg ? prevSize! : { x: Math.max(size.x, 10), y: Math.max(size.y, 10) };
          if (isBg) {
            consumed.add(i - 1);
            const bgIdx = elements.findIndex((e) => e.type === 'rect' && e.x === Math.round(prevPos!.x) && e.y === Math.round(prevPos!.y));
            if (bgIdx >= 0) elements.splice(bgIdx, 1);
          }
          const horizontal = Math.abs(full.x - size.x) >= Math.abs(full.y - size.y);
          if (eff.size === 'rpm') {
            const rb = createElement('rpm_bar', Math.round(pos.x), Math.round(pos.y)) as RpmBarElement;
            rb.width = Math.round(full.x);
            rb.height = Math.round(full.y);
            rb.config.orientation = horizontal ? 'horizontal' : 'vertical';
            rb.config.style = 'continuous';
            rb.config.radius = 0;
            rb.config.colors = { ...rb.config.colors, normal: hex(a.color), warning: hex(a.color), off: isBg ? hex(prev!.args.color, '#00000000') : '#00000000' };
            rb.config.min = 0;
            rb.config.max = '100%';
            rb.config.warning = '100%';
            rb.config.redline = eff.color === 'rpm' ? '95%' : '100%';
            rb.config.limiterBlinkHz = 0;
            rb.name = 'Barra RPM';
            elements.push(rb);
            break;
          }
          const el = createElement('bar', Math.round(pos.x), Math.round(pos.y)) as BarElement;
          el.width = Math.round(full.x);
          el.height = Math.round(full.y);
          const varId = varIdForField(eff.size) ?? 'throttle';
          const def = VARIABLES.find((v) => v.id === varId)!;
          el.config.variable = varId;
          el.config.orientation = horizontal ? 'horizontal' : 'vertical';
          el.config.style = 'continuous';
          el.config.colorFill = hex(a.color);
          el.config.colorBg = isBg ? hex(prev!.args.color, '#00000000') : '#00000000';
          // rango: si el tamaño es lineal con el valor, el máximo es el que llena la barra
          const v0 = num(FIELD_DEFAULTS[eff.size]);
          const s0 = horizontal ? size.x : size.y;
          const fullLen = horizontal ? full.x : full.y;
          const k = v0 > 0 ? s0 / v0 : 0;
          if (k > 0 && Number.isFinite(fullLen / k) && fullLen / k > 0 && fullLen / k < 1e6) {
            el.config.min = 0;
            el.config.max = Math.round((fullLen / k) * 100) / 100;
          } else {
            el.config.min = def.range[0];
            el.config.max = def.range[1];
          }
          el.config.radius = 0;
          el.name = `Barra ${def.label}`;
          elements.push(el);
        } else {
          const el = createElement('rect', Math.round(pos.x), Math.round(pos.y)) as RectElement;
          el.width = Math.max(1, Math.round(size.x));
          el.height = Math.max(1, Math.round(size.y));
          el.config.fill = hex(a.color);
          el.config.radius = num(a.rounding);
          el.name = `Rectángulo ${elements.length + 1}`;
          elements.push(el);
        }
        break;
      }
      case 'display.horizontalBar': {
        const pos = vec(a.pos);
        const size = vec(a.size, { x: 200, y: 40 });
        const el = createElement('bar', Math.round(pos.x), Math.round(pos.y)) as BarElement;
        el.width = Math.round(size.x);
        el.height = Math.round(size.y);
        el.config.style = 'segments';
        el.config.segments = Math.max(1, Math.round(num(a.total, 12)));
        el.config.gap = num(a.delta, 8);
        el.config.colorFill = hex(a.activeColor);
        el.config.colorBg = hex(a.inactiveColor, '#00000000');
        const varId = eff.size ? varIdForField(eff.size) : undefined;
        if (varId) {
          const def = VARIABLES.find((v) => v.id === varId)!;
          el.config.variable = varId;
          el.config.min = def.range[0];
          el.config.max = def.range[1];
          el.name = `Barra ${def.label}`;
        } else el.name = 'Barra segmentada';
        elements.push(el);
        break;
      }
      case 'display.text': {
        const pos = vec(a.pos);
        const letter = vec(a.letter, { x: 20, y: 40 });
        const text = String(a.text ?? '');
        const alignment = num(a.alignment);
        const align: TextAlign = alignment >= 0.75 ? 'right' : alignment >= 0.25 ? 'center' : 'left';
        const spacing = num(a.spacing);
        const w = num(a.width) > 0 && align !== 'left' ? num(a.width) : Math.max(letter.x, text.length * (letter.x + spacing));
        elements.push(makeText(text, pos.x, pos.y, w, letter.y, letter.y, align, hex(a.color), String(a.font ?? ''), eff.text, i, elements.length));
        break;
      }
      case 'ui.dwriteDrawText':
      case 'ui.drawText': {
        const pos = vec(a.pos);
        const size = num(a.size, 20);
        const text = String(a.text ?? '');
        elements.push(makeText(text, pos.x, pos.y, Math.max(size, text.length * size * 0.6), size * 1.2, size, 'left', hex(a.color), c.font, eff.text, i, elements.length));
        break;
      }
      case 'ui.dwriteDrawTextClipped': {
        const p1 = vec(a.p1);
        const p2 = vec(a.p2);
        const size = num(a.size, 20);
        const h = num(a.halign);
        const v = num(a.valign);
        const el = makeText(String(a.text ?? ''), p1.x, p1.y, p2.x - p1.x, p2.y - p1.y, size, h < 0 ? 'left' : h > 0 ? 'right' : 'center', hex(a.color), c.font, eff.text, i, elements.length);
        if (el.type === 'text') el.style.valign = v < 0 ? 'top' : v > 0 ? 'bottom' : 'middle';
        elements.push(el);
        break;
      }
      case 'ui.drawCircleFilled': {
        const cpos = vec(a.center);
        const r = num(a.radius, 10);
        const el = createElement('circle', Math.round(cpos.x - r), Math.round(cpos.y - r)) as CircleElement;
        el.width = el.height = Math.round(r * 2);
        el.config.fill = hex(a.color);
        el.name = `Círculo ${elements.length + 1}`;
        elements.push(el);
        break;
      }
      case 'ui.drawLine': {
        const p1 = vec(a.p1);
        const p2 = vec(a.p2);
        const el = createElement('line', Math.round(Math.min(p1.x, p2.x)), Math.round(Math.min(p1.y, p2.y))) as LineElement;
        el.width = Math.max(1, Math.round(Math.abs(p2.x - p1.x)));
        el.height = Math.max(1, Math.round(Math.abs(p2.y - p1.y) || num(a.thickness, 2)));
        el.config.color = hex(a.color);
        el.config.thickness = num(a.thickness, 2);
        elements.push(el);
        break;
      }
      default:
        break;
    }
    // color dependiente de un campo → regla aproximada (cambio de color por encima del valor de prueba)
    const last = elements[elements.length - 1];
    if (eff.color && last && last.type !== 'rpm_bar' && !consumed.has(i)) {
      const varId = varIdForField(eff.color);
      if (varId) last.rules.push({ id: `rule_${i}`, when: { variable: varId, op: '>=', value: varId === 'rpm' ? '95%' : num(FIELD_DEFAULTS[eff.color]) * 1.37 + 3 }, set: { color: '#FF2D2D' } });
    }
  }

  // iconos/textos que solo aparecen con un estado activo
  for (const { call, field, whenTrue } of extraCalls) {
    const varId = varIdForField(field);
    const a = call.args;
    if (call.fn === 'display.image' || call.fn === 'ui.drawImage') {
      const file = resolveImage(a.image);
      if (!file) continue;
      const pos = call.fn === 'display.image' ? vec(a.pos) : vec(a.p1);
      const size = call.fn === 'display.image' ? vec(a.size) : { x: vec(a.p2).x - pos.x, y: vec(a.p2).y - pos.y };
      const el = createElement('icon', Math.round(pos.x), Math.round(pos.y)) as IconElement;
      el.width = Math.round(size.x);
      el.height = Math.round(size.y);
      el.config.icon = file;
      el.config.variable = varId;
      el.config.showWhen = varId ? (whenTrue ? 'when_true' : 'when_false') : 'always';
      el.config.dimWhenOff = false;
      el.config.colorOn = hex(a.color);
      el.name = `Icono ${String(a.image).split('/').pop()?.replace(/\.[^.]+$/, '') ?? ''}`;
      if (!varId) warnings.push(`El icono ${String(a.image)} depende de car.${field} (no catalogado): se muestra siempre.`);
      elements.push(el);
    } else if (call.fn === 'display.text' || call.fn === 'ui.dwriteDrawText') {
      const pos = vec(a.pos);
      const letter = vec(a.letter, { x: num(a.size, 20) * 0.6, y: num(a.size, 20) });
      const text = String(a.text ?? '');
      const el = makeText(text, pos.x, pos.y, Math.max(letter.x, text.length * letter.x), letter.y, letter.y, 'left', hex(a.color), call.font, undefined, -1, elements.length);
      if (varId) el.rules.push({ id: `vis_${elements.length}`, when: { variable: varId, op: '==', value: !whenTrue }, set: { visible: false } });
      elements.push(el);
    }
  }

  if (fontsSeen.size) warnings.push(`Fuentes del script no disponibles en el editor (${[...fontsSeen].join(', ')}): se usa la fuente por defecto; ajusta tamaño/fuente en cada texto.`);
  if (elements.length === 0 && base.length === 0) warnings.push('El script no dibuja nada con los valores de prueba (¿usa una API no soportada?).');
  return { elements, background, warnings, calls: base.length };
}
