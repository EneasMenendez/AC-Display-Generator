import { pageConditions } from './model';
import type { DisplayElement, DisplayProject, PhysicalNeedle, Project } from './model';
import { buttonStateVar, displayHasTouch, isSwitchAction, switchVar, usedSwitches } from './touch';
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
    for (const c of pageConditions(page)) add(c.variable);
    if (page.trigger) {
      add(page.trigger.input);
      for (const c of [...page.trigger.enter, ...page.trigger.exit]) add(c.variable);
    }
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
        case 'shift_lights':
          add('rpm');
          break;
        case 'needle':
          add(el.config.variable);
          break;
        case 'button':
          // variable que ilumina el botón (interruptor táctil, luces, DRS…)
          add(buttonStateVar(el));
          break;
      }
    }
  }
  const b = display.settings.boot;
  if (b) {
    if (b.replayButton && b.replayButton !== 'none') add(b.replayButton);
    if (b.skipButton && b.skipButton !== 'none') add(b.skipButton);
    if (b.skipSpeedKmh > 0 || display.pages.some((p) => p.trigger)) add('speed');
    if (b.engineStart) add('rpm');
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

/**
 * Métricas de una fuente, en fracción del tamaño (em), medidas en el editor con canvas:
 *  - line: alto de la caja de línea (ascent + descent) que usa DirectWrite para colocar el texto
 *  - shift: desplazamiento que hay que aplicar en el juego para que el centro visual de las mayúsculas
 *    quede donde lo pinta el editor (textBaseline = 'middle')
 */
export interface FontMetrics {
  line: number;
  shift: number;
}

export interface GenerateOptions {
  fontMetrics?: Record<string, FontMetrics>;
}

export interface GeneratedConfig {
  lua: string;
  assets: AssetRef[];
  variables: string[];
}

/** Parte táctil de la configuración: estado inicial de los interruptores y gestos. */
function touchConfig(dp: DisplayProject): Record<string, unknown> {
  const t = dp.settings.touch;
  const switches: Record<string, { initial: boolean; remember: boolean }> = {};
  for (const key of usedSwitches(dp)) {
    const def = t?.switches?.find((x) => x.key === key);
    switches[key] = { initial: def?.initial ?? false, remember: def?.remember ?? false };
  }
  return {
    enabled: displayHasTouch(dp),
    hover: t?.hover !== false,
    swipePages: !!t?.swipePages,
    swipePct: t?.swipePct ?? 25,
    switches,
  };
}

export function generateConfigLua(project: Project, dp: DisplayProject, display: DisplayDef, opts: GenerateOptions = {}): GeneratedConfig {
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
    whenAny: p.whenAny,
    kind: p.kind ?? 'normal',
    duration: p.duration,
    trigger: p.trigger,
    elements: p.elements.filter((e) => e.visible || e.rules.some((r) => r.set.visible)).map((el) => serializeElement(el, addAsset)),
  }));
  const boot = { ...(dp.settings.boot ?? {}), sound: dp.settings.boot?.sound ? addAsset(dp.settings.boot.sound) : undefined };

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
    fontMetrics: opts.fontMetrics ?? {},
    settings: {
      units: dp.settings.units,
      brightness: dp.settings.brightness * display.emissive.brightness_default,
      nightBrightness: dp.settings.nightBrightness,
      nightMode: dp.settings.nightMode,
      refreshHz: dp.settings.refreshHz || 0,
      boot,
      pageSwitch: dp.settings.pageSwitch,
      touch: touchConfig(dp),
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
    anim: el.anim && (el.anim.delay > 0 || el.anim.fadeIn > 0 || el.anim.fadeOut > 0) ? el.anim : undefined,
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
    case 'rpm_bar':
    case 'bar':
      return {
        ...base,
        config: el.config,
        fillFile: el.config.fillImage ? addAsset(el.config.fillImage) : undefined,
        bgFile: el.config.bgImage ? addAsset(el.config.bgImage) : undefined,
      };
    case 'shift_lights':
    case 'needle':
      return { ...base, config: el.config, file: el.config.image ? addAsset(el.config.image) : undefined };
    case 'video':
      return { ...base, config: el.config, file: el.config.file ? addAsset(el.config.file) : undefined };
    case 'button':
      return {
        ...base,
        config: el.config,
        file: el.config.image ? addAsset(el.config.image) : undefined,
        fileOn: el.config.imageOn ? addAsset(el.config.imageOn) : undefined,
        /** variable que lo ilumina (resuelta aquí para que el runtime no repita la lógica) */
        stateVar: buttonStateVar(el),
        switchKey: isSwitchAction(el.config.action) ? el.config.switch || 'a' : undefined,
      };
    default:
      return { ...base, config: (el as { config: unknown }).config };
  }
}

/* ---------- display.ini ---------- */

export interface IniOptions {
  /** nombre del script, relativo a extension/ (o skins/<skin>/) */
  script: string;
  /** pantalla táctil: CSP proyecta el puntero sobre la malla (INTERACTIVE = 1) */
  interactive?: boolean;
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
  // tamaño del render target = lienzo del proyecto (si no, CSP usa el de la textura original del kn5)
  lines.push(`RESOLUTION = ${display.texture_size.width}, ${display.texture_size.height}`);
  lines.push(`KEEP_BACKGROUND = ${display.keep_background ? 1 : 0}`);
  lines.push(`SKIP_FRAMES = ${display.skip_frames}`);
  if (opts.interactive) {
    // el puntero del ratón se proyecta sobre la malla y llega al script en píxeles de la textura
    lines.push('INTERACTIVE = 1 ; pantalla táctil: cuesta un raycast cuando se usa el ratón');
  }
  lines.push('');

  const em = display.emissive;
  if (em.mode === 'custom' && em.ini) {
    lines.push(em.ini.trim());
    lines.push('');
  }

  for (const block of display.extra_ini) {
    lines.push(block.trim());
    lines.push('');
  }
  return lines.join('\n');
}

/** id del bloque (al final de ext_config.ini) con la emisión de las pantallas */
export const EMISSIVE_BLOCK_ID = '_emissive';

/**
 * Emisión del material de cada display. Va en un bloque aparte al final del archivo para que
 * prevalezca sobre las secciones del coche (p. ej. [Material_DigitalScreen] con Emissive = 0.5,
 * demasiado bajo para verse de noche).
 */
export function generateEmissiveIni(displays: DisplayDef[]): string {
  const out: string[] = [];
  for (const display of displays) {
    const em = display.emissive;
    if (em.mode === 'shader_replacement') {
      out.push(`; ${display.name}: shader + emisión`);
      out.push('[SHADER_REPLACEMENT_...]');
      out.push(`MESHES = ${display.meshes.join(', ')}`);
      out.push(`SHADER = ${em.shader}`);
      out.push(`PROP_0 = ksEmissive, ${em.ks_emissive.join(', ')}`);
      out.push('PROP_1 = ksAmbient, 0');
      out.push('PROP_2 = ksDiffuse, 0');
      out.push('');
    } else if (em.mode === 'props') {
      // solo la emisión: el shader del coche (p. ej. DigitalScreen) se conserva
      out.push(`; ${display.name}: emisión de la pantalla`);
      out.push('[SHADER_REPLACEMENT_...]');
      out.push(`MESHES = ${display.meshes.join(', ')}`);
      out.push(`PROP_0 = ksEmissive, ${em.ks_emissive.join(', ')}`);
      out.push('');
    }
  }
  return out.join('\n').trimEnd();
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

/* ---------- Agujas físicas ([ANALOG_INDICATOR_...]) ---------- */

/** id del bloque de ext_config.ini con las agujas físicas (no es un display) */
export const NEEDLES_BLOCK_ID = '_needles';

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10000) / 10000);
}

/** Cuerpo del bloque de agujas físicas: una sección [ANALOG_INDICATOR_...] por aguja. */
export function generateNeedlesIni(needles: PhysicalNeedle[]): string {
  const out: string[] = [];
  for (const n of needles) {
    if (!n.object.trim()) continue;
    const lut = [...n.lut].sort((a, b) => a.value - b.value);
    out.push(`; ${n.name}`);
    out.push('[ANALOG_INDICATOR_...]');
    out.push(`INPUT = ${n.input.trim().toUpperCase()}`);
    out.push(`OBJECT_NAME = ${n.object.trim()}`);
    if (n.lowerBound !== undefined) out.push(`LOWER_BOUND = ${fmtNum(n.lowerBound)}`);
    if (n.upperBound !== undefined) out.push(`UPPER_BOUND = ${fmtNum(n.upperBound)}`);
    out.push(`INPUT_LAG_UP = ${fmtNum(n.lagUp)}`);
    out.push(`INPUT_LAG_DOWN = ${fmtNum(n.lagDown)}`);
    if (n.speedLag !== undefined && n.speedLag > 0) out.push(`SPEED_LAG = ${fmtNum(n.speedLag)}`);
    out.push(`LUT = (| ${lut.map((p) => `${fmtNum(p.value)}=${fmtNum(p.angle)}`).join(' | ')} |)`);
    if (n.extra?.trim()) out.push(n.extra.trim());
    out.push('');
  }
  return out.join('\n').trimEnd();
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
/** bloques que van al FINAL de ext_config.ini (deben prevalecer sobre las secciones del coche) */
const TAIL_BLOCKS = new Set(['_emissive']);

export function upsertIncludeBlock(extConfig: string, displayId: string, body: string, files: string[] = []): string {
  const block = includeBlock(displayId, body, files);
  if (TAIL_BLOCKS.has(displayId)) {
    // bloque de cola: se quita de donde esté y se añade al final del archivo
    const rest = removeIncludeBlock(extConfig, displayId).replace(/\s+$/, '');
    return `${rest}${rest.length ? '\n\n' : ''}${block}`;
  }
  // los demás bloques ACDG van juntos al principio del archivo, en orden de instalación, para que los
  // displays se carguen antes que el resto de la configuración del coche
  const blocks: { id: string; text: string }[] = [];
  let rest = extConfig;
  for (const id of listIncludeBlocks(extConfig)) {
    if (TAIL_BLOCKS.has(id)) continue;
    const m = includeMarkers(id);
    const re = new RegExp(`${escapeRe(m.begin)}[\\s\\S]*?${escapeRe(m.end)}\\r?\\n?`);
    const hit = re.exec(rest);
    if (!hit) continue;
    blocks.push({ id, text: id === displayId ? block : hit[0].trimEnd() + '\n' });
    rest = rest.replace(re, '');
  }
  if (!blocks.some((b) => b.id === displayId)) blocks.push({ id: displayId, text: block });
  rest = rest.replace(/^\s+/, '');
  // [HEADER] (metadatos de CSP) se conserva como primera sección si existe
  let header = '';
  const h = /^\[HEADER\][^\[]*/i.exec(rest);
  if (h) {
    header = h[0].trimEnd() + '\n\n';
    rest = rest.slice(h[0].length).replace(/^\s+/, '');
  }
  return `${header}${blocks.map((b) => b.text).join('\n')}${rest.length ? '\n' + rest : ''}`;
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
    '  2. Añade al principio de ext_config.ini (antes de cualquier otra sección):',
    '',
    includeBlock(display.id, `[SCRIPTABLE_DISPLAY_...]\nMESHES = ${display.meshes.join(', ')}\nSCRIPT = ${script}\nRESOLUTION = ${display.texture_size.width}, ${display.texture_size.height}\nKEEP_BACKGROUND = ${display.keep_background ? 1 : 0}\nSKIP_FRAMES = ${display.skip_frames}`, files).trimEnd().split('\n').map((l) => '       ' + l).join('\n'),
    '',
    '  3. Reinicia la sesión (o el juego): CSP lee la configuración del coche al cargar la pista.',
    '',
    `Para modificar el diseño abre ${PROJECT_FILE} con AC Display Generator y vuelve a generar.`,
    '',
  ].join('\n');
}
