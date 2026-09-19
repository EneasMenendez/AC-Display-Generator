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

/** Cabecera con la que empiezan todos los scripts generados (sirve para reconocerlos). */
export const ACDG_LUA_HEADER = '-- Generado por AC Display Generator.';
/** Copia del proyecto que se guarda junto a los scripts en extension/. */
export const PROJECT_FILE = 'acdg_project.acdisplay';

/**
 * Todo se escribe plano en extension/ (sin subcarpetas): los recursos de cada display llevan su id
 * como prefijo para no chocar entre displays ni con archivos del coche.
 */
function assetTarget(source: string, displayId: string): string {
  if (source.startsWith('builtin:')) return `${displayId}_icon_${safeName(source.slice('builtin:'.length))}.png`;
  const base = source.split(/[\\/]/).pop() ?? source;
  return `${displayId}_${safeName(base)}`;
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
    const target = assetTarget(source, display.id);
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
    // las fuentes conservan su nombre (DWrite las busca por familia dentro de la carpeta) y se comparten entre displays
    assets.push({ source: file, target: safeName(file.split(/[\\/]/).pop() ?? file) });
    fonts[name] = { name, dir: '.' };
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
  /** nombre del script, relativo a extension/ (o skins/<skin>/) */
  script: string;
}

export function generateDisplayIni(profile: DisplayProfile, display: DisplayDef, opts: IniOptions): string {
  const lines: string[] = [];
  lines.push(`; Generado por AC Display Generator — display "${display.name}" (${display.id})`);
  lines.push(`; Perfil ${profile.id} v${profile.profile_version} — no editar a mano`);
  lines.push('');
  // forma canónica de CSP (misma que usan los coches de referencia); el display se identifica por la ruta de SCRIPT
  lines.push('[SCRIPTABLE_DISPLAY_...]');
  lines.push(`MESHES = ${display.meshes.join(', ')}`);
  lines.push(`SCRIPT = ${opts.script}`);
  lines.push(`KEEP_BACKGROUND = ${display.keep_background ? 1 : 0}`);
  lines.push(`SKIP_FRAMES = ${display.skip_frames}`);
  lines.push('');

  const em = display.emissive;
  if (em.mode === 'shader_replacement') {
    lines.push('[SHADER_REPLACEMENT_...]');
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

/**
 * display.lua autocontenido: configuración + runtime en un único archivo, sin `require`
 * (así no depende de cómo resuelva CSP package.path en scripts de coche).
 */
export function generateDisplayLua(configLua: string, runtimeLua: string, displayId: string): string {
  return [
    `${ACDG_LUA_HEADER} No editar a mano: abre ${PROJECT_FILE} en la aplicación y vuelve a generar.`,
    `-- Display: ${displayId}. Script autocontenido: configuración del display + runtime ACDG.`,
    '-- en los scripts de display `car` es el coche propietario; `sim` no siempre está definido como global',
    'sim = sim or ac.getSim()',
    '',
    '-- ===== display_config.lua =====',
    'local ACDG_CONFIG = (function()',
    configLua.trimEnd(),
    'end)()',
    '',
    '-- ===== acdg_runtime.lua =====',
    'local ACDG_RUNTIME = (function()',
    runtimeLua.trimEnd(),
    'end)()',
    '',
    "local dir = __dirname or '.'",
    '-- cualquier error se escribe en el log de CSP en vez de matar el script en silencio',
    'local okInit, errInit = pcall(ACDG_RUNTIME.init, ACDG_CONFIG, dir)',
    `if okInit then ac.warn('[ACDG] display "${displayId}" cargado desde ' .. tostring(dir) .. ' (runtime ' .. tostring(ACDG_RUNTIME.version) .. ')')`,
    `else ac.error('[ACDG] display "${displayId}": error al iniciar: ' .. tostring(errInit)) end`,
    'local errorLogged = false',
    '',
    'function script.update(dt)',
    '  local ok, err = pcall(ACDG_RUNTIME.update, dt)',
    '  if not ok and not errorLogged then',
    '    errorLogged = true',
    `    ac.error('[ACDG] display "${displayId}": error en update: ' .. tostring(err))`,
    '  end',
    'end',
    '',
  ].join('\n');
}

/* ---------- Bloque ACDG en ext_config.ini ---------- */

export function includeMarkers(displayId: string): { begin: string; end: string } {
  return { begin: `; ACDG BEGIN ${displayId}`, end: `; ACDG END ${displayId}` };
}

/**
 * Bloque que se escribe en ext_config.ini entre marcadores: contiene directamente las secciones del
 * display (el contenido de display.ini), sin [INCLUDE], para no depender de cómo resuelve CSP las rutas
 * de archivos incluidos. SCRIPT queda relativo a extension/, como en los coches de referencia.
 */
export function includeBlock(displayId: string, body: string, files: string[] = []): string {
  const m = includeMarkers(displayId);
  const list = files.length ? `${FILES_PREFIX}${files.join(', ')}\n` : '';
  return `${m.begin}\n${list}${body.trim()}\n${m.end}\n`;
}

const FILES_PREFIX = '; ACDG FILES: ';

export interface IncludeBlockInfo {
  displayId: string;
  /** texto entre marcadores */
  body: string;
  /** archivos escritos por la instalación (relativos a extension/) */
  files: string[];
  /** valor de SCRIPT de la sección */
  script: string | null;
}

/** Lee el bloque de un display de ext_config.ini (null si no existe). */
export function parseIncludeBlock(extConfig: string, displayId: string): IncludeBlockInfo | null {
  const m = includeMarkers(displayId);
  const re = new RegExp(`${escapeRe(m.begin)}\\r?\\n([\\s\\S]*?)${escapeRe(m.end)}`);
  const hit = re.exec(extConfig);
  if (!hit) return null;
  const body = hit[1];
  const files = body
    .split(/\r?\n/)
    .filter((l) => l.startsWith(FILES_PREFIX))
    .flatMap((l) => l.slice(FILES_PREFIX.length).split(',').map((x) => x.trim()).filter(Boolean));
  const script = /^\s*SCRIPT\s*=\s*([^\r\n;]+)/im.exec(body)?.[1].trim() ?? null;
  return { displayId, body, files, script };
}

/** Ids de todos los displays con bloque ACDG en ext_config.ini. */
export function listIncludeBlocks(extConfig: string): string[] {
  return [...extConfig.matchAll(/^; ACDG BEGIN (\S+)/gm)].map((m) => m[1]);
}

/**
 * Inserta o sustituye el bloque del display en el contenido de ext_config.ini.
 * Nunca toca el resto del archivo.
 */
export function upsertIncludeBlock(extConfig: string, displayId: string, body: string, files: string[] = []): string {
  const m = includeMarkers(displayId);
  const block = includeBlock(displayId, body, files);
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
  // el bloque propio (entre marcadores) no cuenta como conflicto
  const others = ownDisplayId ? removeIncludeBlock(extConfig, ownDisplayId) : extConfig;
  const sections = others.split(/^\s*\[/m);
  for (const sec of sections) {
    const header = sec.split(']')[0]?.trim() ?? '';
    if (!/^SCRIPTABLE_DISPLAY/i.test(header)) continue;
    const m = /MESHES\s*=\s*([^\r\n;]+)/i.exec(sec);
    if (!m) continue;
    const secMeshes = m[1].split(',').map((s) => s.trim().toLowerCase());
    if (meshes.some((x) => secMeshes.includes(x.toLowerCase()))) conflicts.push(`[${header}]`);
  }
  return conflicts;
}

/* ---------- LEEME ---------- */

export function generateReadme(project: Project, dp: DisplayProject, display: DisplayDef, script: string, files: string[]): string {
  return [
    'AC Display Generator — display generado',
    '========================================',
    '',
    `Proyecto : ${project.name}`,
    `Display  : ${display.name} (${display.id})`,
    `Mallas   : ${display.meshes.join(', ')}`,
    `Textura  : ${dp.canvas.width} x ${dp.canvas.height} px`,
    `Páginas  : ${dp.pages.map((p) => p.name).join(', ')}${dp.settings.pageSwitch.input !== 'none' ? ` (cambio con ${dp.settings.pageSwitch.input})` : ''}`,
    `Runtime  : ACDG v${RUNTIME_VERSION} (incluido en ${script})`,
    `Archivos : ${files.join(', ')}`,
    '',
    'Instalación manual (si has exportado el paquete sin instalar):',
    '  1. Copia estos archivos directamente en content/cars/<coche>/extension/ (o skins/<skin>/), sin subcarpetas.',
    '  2. Añade al final de ext_config.ini:',
    '',
    includeBlock(display.id, `[SCRIPTABLE_DISPLAY_...]\nMESHES = ${display.meshes.join(', ')}\nSCRIPT = ${script}\nKEEP_BACKGROUND = ${display.keep_background ? 1 : 0}\nSKIP_FRAMES = ${display.skip_frames}`, files).trimEnd().split('\n').map((l) => '       ' + l).join('\n'),
    '',
    '  3. Reinicia la sesión (o el juego): CSP lee la configuración del coche al cargar la pista.',
    '',
    `Para modificar el diseño abre ${PROJECT_FILE} con AC Display Generator y vuelve a generar.`,
    '',
  ].join('\n');
}
