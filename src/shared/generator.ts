import type { DisplayElement, DisplayProject, Project } from './model';
import type { DisplayDef, DisplayProfile } from './profile';
import { VARIABLE_MAP, type VariableDef } from './variables';

/**
 * Generador: Project + DisplayProfile → archivos de texto (display.ini, display.lua, display_config.lua, LEEME.txt).
 * Es puro (sin acceso a disco) para poder probarlo con vitest; el Installer del proceso principal escribe los archivos.
 */

export const RUNTIME_VERSION = '0.1.0';

/* ---------- Serialización JS → Lua ---------- */

const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

export function luaString(s: string): string {
  return (
    "'" +
    s
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r') +
    "'"
  );
}

function luaKey(k: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !LUA_KEYWORDS.has(k) ? k : `[${luaString(k)}]`;
}

/** Marca un valor para emitirlo como código Lua literal (funciones, expresiones). */
export class LuaRaw {
  constructor(public code: string) {}
}

export function toLua(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (value instanceof LuaRaw) return value.code;
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return luaString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '{}';
    return `{\n${value.map((v) => padIn + toLua(v, indent + 1)).join(',\n')},\n${pad}}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([k, v]) => `${padIn}${luaKey(k)} = ${toLua(v, indent + 1)}`).join(',\n')},\n${pad}}`;
  }
  return 'nil';
}

/* ---------- Recolección de variables usadas ---------- */

export function collectVariables(display: DisplayProject): string[] {
  const ids = new Set<string>();
  const add = (id?: string) => id && ids.add(id);
  for (const page of display.pages) {
    if (page.when) add(page.when.variable);
    for (const el of page.elements) {
      for (const r of el.rules) add(r.when.variable);
      switch (el.type) {
        case 'text':
          add(el.binding.variable);
          break;
        case 'bar':
        case 'gauge':
          add(el.config.variable);
          break;
        case 'icon':
          add(el.config.variable);
          break;
        case 'gear':
          add('gear');
          break;
        case 'rpm_bar':
        case 'shift_light':
          add('rpm');
          break;
      }
    }
  }
  return [...ids].filter((id) => VARIABLE_MAP[id]);
}

function varFunction(def: VariableDef): LuaRaw {
  if (def.physics_only) {
    return new LuaRaw(`function() if car.physicsAvailable == false then return ${toLua(def.fallback)} end return ${def.lua} end`);
  }
  return new LuaRaw(`function() return ${def.lua} end`);
}

/* ---------- Assets ---------- */

export interface AssetRef {
  /** ruta dentro del proyecto/.acdisplay (assets/...) o "builtin:<id>" */
  source: string;
  /** ruta relativa dentro de la carpeta generada */
  target: string;
}

/** Nombre de archivo seguro para el paquete generado. */
export function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function assetTarget(source: string): string {
  if (source.startsWith('builtin:')) return `icons/${safeName(source.slice('builtin:'.length))}.png`;
  const base = source.split(/[\\/]/).pop() ?? source;
  return `assets/${safeName(base)}`;
}

/* ---------- display_config.lua ---------- */

export interface GeneratedConfig {
  lua: string;
  assets: AssetRef[];
  variables: string[];
}

export function generateConfigLua(project: Project, dp: DisplayProject, display: DisplayDef): GeneratedConfig {
  const assets: AssetRef[] = [];
  const addAsset = (source: string): string => {
    const target = assetTarget(source);
    if (!assets.some((a) => a.source === source)) assets.push({ source, target });
    return target;
  };

  const variables = collectVariables(dp);
  const vars: Record<string, LuaRaw> = {};
  const varMeta: Record<string, unknown> = {};
  for (const id of variables) {
    const def = VARIABLE_MAP[id];
    vars[id] = varFunction(def);
    varMeta[id] = { unit: def.unit, type: def.type, fallback: def.fallback };
  }

  const pages = dp.pages.map((p) => ({
    id: p.id,
    name: p.name,
    when: p.when,
    elements: p.elements.filter((e) => e.visible || e.rules.some((r) => r.set.visible)).map((el) => serializeElement(el, addAsset)),
  }));

  const background = dp.background.file ? { file: addAsset(dp.background.file), color: dp.background.color } : { color: dp.background.color };

  const fonts: Record<string, { name: string; dir?: string }> = {};
  for (const [name, file] of Object.entries(dp.fonts)) {
    assets.push({ source: file, target: `fonts/${safeName(file.split(/[\\/]/).pop() ?? file)}` });
    fonts[name] = { name, dir: 'fonts' };
  }

  const config = {
    version: 1,
    runtimeVersion: RUNTIME_VERSION,
    display: {
      id: display.id,
      width: dp.canvas.width,
      height: dp.canvas.height,
      keepBackground: display.keep_background,
      maxDistance: display.max_distance_m,
    },
    background,
    settings: {
      units: dp.settings.units,
      brightness: dp.settings.brightness * display.emissive.brightness_default,
      nightBrightness: dp.settings.nightBrightness,
      nightMode: dp.settings.nightMode,
      pageSwitch: dp.settings.pageSwitch,
    },
    defaults: {
      rpmLimiter: display.defaults.rpm_limiter,
      maxFuel: display.defaults.max_fuel_l,
      lowFuelPct: 0.1,
      waterHot: display.defaults.water_temp_range[1] - 10,
      oilLowPressure: 1,
      batteryLow: 12,
    },
    fonts,
    vars,
    varMeta,
    pages,
  };

  const header = [
    '-- Generado por AC Display Generator. No editar a mano: abre el proyecto en la aplicación y vuelve a generar.',
    `-- Proyecto: ${project.name}  |  Perfil: ${project.profile.id} v${project.profile.version}  |  Display: ${display.id}`,
    `-- Fecha: ${new Date().toISOString()}`,
    '',
  ].join('\n');

  return { lua: `${header}return ${toLua(config)}\n`, assets, variables };
}

function serializeElement(el: DisplayElement, addAsset: (s: string) => string): Record<string, unknown> {
  const base = {
    id: el.id,
    type: el.type,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    rotation: el.rotation,
    visible: el.visible,
    opacity: el.opacity,
    rules: el.rules.map((r) => ({
      when: r.when,
      set: { ...r.set, image: r.set.image ? addAsset(r.set.image) : undefined },
    })),
  };
  switch (el.type) {
    case 'text':
      return { ...base, binding: el.binding, style: el.style };
    case 'icon':
      return { ...base, config: el.config, file: el.config.icon ? addAsset(el.config.icon) : undefined };
    case 'image':
      return { ...base, config: el.config, file: el.config.file ? addAsset(el.config.file) : undefined };
    default:
      return { ...base, config: (el as { config: unknown }).config };
  }
}

/* ---------- display.ini ---------- */

export interface IniOptions {
  /** ruta relativa desde extension/ (o skins/<skin>/) a la carpeta generada, con / */
  folder: string;
}

export function generateDisplayIni(profile: DisplayProfile, display: DisplayDef, opts: IniOptions): string {
  const lines: string[] = [];
  lines.push(`; Generado por AC Display Generator — display "${display.name}" (${display.id})`);
  lines.push(`; Perfil ${profile.id} v${profile.profile_version} — no editar a mano`);
  lines.push('');
  lines.push(`[SCRIPTABLE_DISPLAY_ACDG_${display.id.toUpperCase()}]`);
  lines.push(`ACTIVE = $" read('csp/version', 0) >= ${profile.csp_min_build} "`);
  lines.push(`MESHES = ${display.meshes.join(', ')}`);
  lines.push(`SCRIPT = ${opts.folder}/display.lua`);
  lines.push(`KEEP_BACKGROUND = ${display.keep_background ? 1 : 0}`);
  lines.push(`SKIP_FRAMES = ${display.skip_frames}`);
  lines.push('');

  const em = display.emissive;
  if (em.mode === 'shader_replacement') {
    lines.push(`[SHADER_REPLACEMENT_ACDG_${display.id.toUpperCase()}]`);
    lines.push(`ACTIVE = $" read('csp/version', 0) >= ${profile.csp_min_build} "`);
    lines.push(`MESHES = ${display.meshes.join(', ')}`);
    lines.push(`SHADER = ${em.shader}`);
    lines.push(`PROP_0 = ksEmissive, ${em.ks_emissive.join(', ')}`);
    lines.push('PROP_1 = ksAmbient, 0');
    lines.push('PROP_2 = ksDiffuse, 0');
    lines.push('');
  } else if (em.mode === 'custom' && em.ini) {
    lines.push(em.ini.trim());
    lines.push('');
  }

  for (const block of display.extra_ini) {
    lines.push(block.trim());
    lines.push('');
  }
  return lines.join('\n');
}

/* ---------- display.lua ---------- */

export function generateDisplayLua(): string {
  return [
    '-- Generado por AC Display Generator. No editar a mano.',
    "local dir = __dirname or '.'",
    '-- en los scripts de display `car` es el coche propietario; `sim` no siempre está definido como global',
    'sim = sim or ac.getSim()',
    "local runtime = require('acdg_runtime')",
    "local config = require('display_config')",
    'runtime.init(config, dir)',
    '',
    'function script.update(dt)',
    '  runtime.update(dt)',
    'end',
    '',
  ].join('\n');
}

/* ---------- Bloque INCLUDE en ext_config.ini ---------- */

export function includeMarkers(displayId: string): { begin: string; end: string } {
  return { begin: `; ACDG BEGIN ${displayId}`, end: `; ACDG END ${displayId}` };
}

export function includeBlock(displayId: string, folder: string): string {
  const m = includeMarkers(displayId);
  return `${m.begin}\n[INCLUDE: ${folder}/display.ini]\n${m.end}\n`;
}

/**
 * Inserta o sustituye el bloque INCLUDE del display en el contenido de ext_config.ini.
 * Nunca toca el resto del archivo.
 */
export function upsertIncludeBlock(extConfig: string, displayId: string, folder: string): string {
  const m = includeMarkers(displayId);
  const block = includeBlock(displayId, folder);
  const re = new RegExp(`${escapeRe(m.begin)}[\\s\\S]*?${escapeRe(m.end)}\\r?\\n?`);
  if (re.test(extConfig)) return extConfig.replace(re, block);
  const sep = extConfig.length === 0 ? '' : extConfig.endsWith('\n') ? '\n' : '\n\n';
  return `${extConfig}${sep}${block}`;
}

export function removeIncludeBlock(extConfig: string, displayId: string): string {
  const m = includeMarkers(displayId);
  const re = new RegExp(`\\r?\\n?${escapeRe(m.begin)}[\\s\\S]*?${escapeRe(m.end)}\\r?\\n?`);
  return extConfig.replace(re, '\n');
}

export function hasIncludeBlock(extConfig: string, displayId: string): boolean {
  return extConfig.includes(includeMarkers(displayId).begin);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detecta secciones [SCRIPTABLE_DISPLAY...] ajenas que usan alguna de las mallas dadas.
 */
export function findConflictingDisplays(extConfig: string, meshes: string[], ownDisplayId?: string): string[] {
  const conflicts: string[] = [];
  const sections = extConfig.split(/^\s*\[/m);
  for (const sec of sections) {
    const header = sec.split(']')[0]?.trim() ?? '';
    if (!/^SCRIPTABLE_DISPLAY/i.test(header)) continue;
    if (ownDisplayId && header.toUpperCase() === `SCRIPTABLE_DISPLAY_ACDG_${ownDisplayId.toUpperCase()}`) continue;
    const m = /MESHES\s*=\s*([^\r\n;]+)/i.exec(sec);
    if (!m) continue;
    const secMeshes = m[1].split(',').map((s) => s.trim().toLowerCase());
    if (meshes.some((x) => secMeshes.includes(x.toLowerCase()))) conflicts.push(`[${header}]`);
  }
  return conflicts;
}

/* ---------- LEEME ---------- */

export function generateReadme(project: Project, dp: DisplayProject, display: DisplayDef, folder: string): string {
  return [
    'AC Display Generator — display generado',
    '========================================',
    '',
    `Proyecto : ${project.name}`,
    `Display  : ${display.name} (${display.id})`,
    `Mallas   : ${display.meshes.join(', ')}`,
    `Textura  : ${dp.canvas.width} x ${dp.canvas.height} px`,
    `Páginas  : ${dp.pages.map((p) => p.name).join(', ')}${dp.settings.pageSwitch.input !== 'none' ? ` (cambio con ${dp.settings.pageSwitch.input})` : ''}`,
    `Runtime  : acdg_runtime.lua v${RUNTIME_VERSION}`,
    '',
    'Instalación manual (si has exportado el paquete sin instalar):',
    `  1. Copia la carpeta "${folder}" dentro de content/cars/<coche>/extension/ (o skins/<skin>/).`,
    '  2. Añade al final de ext_config.ini:',
    '',
    includeBlock(display.id, folder).trimEnd().split('\n').map((l) => '       ' + l).join('\n'),
    '',
    'Para modificar el diseño abre project.acdisplay con AC Display Generator y vuelve a generar.',
    '',
  ].join('\n');
}
