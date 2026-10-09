import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { app } from 'electron';
import { resourcesDir } from './resources';
import { validateLua } from './luaCheck';
import type { DisplayDef, DisplayProfile } from '@shared/profile';
import {
  ACDG_LUA_HEADER,
  EMISSIVE_BLOCK_ID,
  NEEDLES_BLOCK_ID,
  generateEmissiveIni,
  PROJECT_FILE,
  generateNeedlesIni,
  generateConfigLua,
  generateDisplayIni,
  generateDisplayLua,
  generateReadme,
  hasIncludeBlock,
  listIncludeBlocks,
  parseIncludeBlock,
  removeIncludeBlock,
  upsertIncludeBlock,
  findConflictingDisplays,
} from '@shared/generator';
import { displayHasTouch } from '@shared/touch';
import { session, packProject } from './projectManager';
import { disableSection, enableAllSections, enableSectionsMatching, parseIni } from '@shared/ini';
import { encodeDdsBc3, toRgba } from './imageManager';
import type { BackupEntry, CleanDisplaysResult, InstallOptions, InstallResult, InstallStep, InstallTarget } from '@shared/types';
import { scanExtension } from './displayScanner';
export type { BackupEntry, InstallOptions, InstallResult, InstallStep, InstallTarget };

/**
 * Installer + Backup Manager + Validator (secciones 20, 22 y 23).
 * Todo lo generado se escribe directamente en <base> (extension/ o skins/<skin>/), sin subcarpetas:
 *   <display_id>.lua                    script autocontenido (config + runtime)
 *   <display_id>_<recurso>.png/.dds     imágenes e iconos usados por ese display
 *   <fuente>.ttf                        fuentes (compartidas entre displays)
 *   acdg_project.acdisplay              copia del proyecto para reeditar desde el vehículo
 * En ext_config.ini se añade la sección del display entre marcadores, con la lista de archivos escritos
 * (`; ACDG FILES:`) para poder actualizar y desinstalar sin tocar nada ajeno.
 * Las copias de seguridad se guardan en la carpeta de datos de la aplicación, no en el coche.
 */

function runtimeSource(): string {
  const f = join(resourcesDir(), 'runtime', 'acdg_runtime.lua');
  if (!existsSync(f)) throw new Error('No se encontró acdg_runtime.lua en los recursos de la aplicación.');
  return readFileSync(f, 'utf8');
}

export { validateLua };

function baseDir(carPath: string, target: InstallTarget): string {
  return target.kind === 'car' ? join(carPath, 'extension') : join(carPath, 'skins', target.skin);
}

/** Carpeta de copias de seguridad de un vehículo/skin dentro de los datos de la aplicación. */
function backupRoot(carPath: string, target: InstallTarget): string {
  const key = `${basename(carPath)}${target.kind === 'skin' ? `__${target.skin}` : ''}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
  return join(app.getPath('userData'), 'backups', key);
}

function displayFor(profile: DisplayProfile, displayId: string): DisplayDef {
  const d = profile.displays.find((x) => x.id === displayId);
  if (!d) throw new Error(`El perfil no contiene el display "${displayId}".`);
  return d;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** true si el .lua lo generó esta aplicación (cabecera). */
function isAcdgScript(file: string): boolean {
  try {
    return readFileSync(file, 'utf8').startsWith(ACDG_LUA_HEADER);
  } catch {
    return false;
  }
}

/**
 * Nombre del script del display: <id>.lua, salvo que ya exista un .lua ajeno con ese nombre
 * (p. ej. el display.lua original importado), en cuyo caso <id>_acdg.lua para no pisarlo.
 */
function scriptFileName(base: string, displayId: string): string {
  const plain = `${displayId}.lua`;
  const f = join(base, plain);
  if (existsSync(f) && !isAcdgScript(f)) return `${displayId}_acdg.lua`;
  return plain;
}

/** Archivos escritos por una instalación anterior del display (según el bloque de ext_config.ini). */
function previousFiles(extConfigText: string, displayId: string): string[] {
  const block = parseIncludeBlock(extConfigText, displayId);
  return block ? block.files : [];
}

/** Elimina restos de la instalación anterior: archivos listados en el bloque y la carpeta acdg/<id>/ del formato antiguo. */
function removePrevious(base: string, extConfigText: string, displayId: string): string[] {
  const removed: string[] = [];
  for (const rel of previousFiles(extConfigText, displayId)) {
    const f = join(base, rel);
    if (!existsSync(f)) continue;
    // un .lua solo se borra si es nuestro
    if (rel.toLowerCase().endsWith('.lua') && !isAcdgScript(f)) continue;
    rmSync(f, { force: true });
    removed.push(rel);
  }
  const legacy = join(base, 'acdg', displayId);
  if (existsSync(legacy)) {
    rmSync(legacy, { recursive: true, force: true });
    removed.push(`acdg/${displayId}/`);
    const acdgDir = join(base, 'acdg');
    const rest = readdirSync(acdgDir).filter((x) => x !== '_backup');
    if (rest.length === 0) rmSync(acdgDir, { recursive: true, force: true });
  }
  return removed;
}

export function install(opts: InstallOptions): InstallResult {
  const steps: InstallStep[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const step = (name: string, fn: () => string | void): boolean => {
    try {
      const detail = fn() ?? undefined;
      steps.push({ name, ok: true, detail: detail || undefined });
      return true;
    } catch (e) {
      const msg = (e as Error).message;
      steps.push({ name, ok: false, detail: msg });
      errors.push(`${name}: ${msg}`);
      return false;
    }
  };

  const { project, profile } = opts;
  const base = opts.install ? baseDir(opts.carPath, opts.target) : opts.exportDir!;
  const extConfig = join(base, 'ext_config.ini');
  const readExt = (): string => (existsSync(extConfig) ? readFileSync(extConfig, 'utf8') : '');
  const selected = project.displays.filter((d) => !opts.displayIds || opts.displayIds.includes(d.display_id));
  const result: InstallResult = { ok: false, steps, folder: base, files: [], warnings, errors };

  // --- validación previa (todos los displays) ---
  if (!step('Validar proyecto y perfil', () => {
    if (selected.length === 0) throw new Error('No hay ningún display seleccionado para generar.');
    for (const dp of selected) {
      const def = displayFor(profile, dp.display_id);
      if (dp.canvas.width !== def.texture_size.width || dp.canvas.height !== def.texture_size.height) {
        throw new Error(`${dp.name}: el lienzo (${dp.canvas.width}×${dp.canvas.height}) no coincide con la textura del perfil (${def.texture_size.width}×${def.texture_size.height}).`);
      }
      if (dp.background.file && !session.assets.has(dp.background.file)) throw new Error(`${dp.name}: falta la imagen de fondo en el proyecto.`);
    }
    if (opts.install && !existsSync(opts.carPath)) throw new Error('La carpeta del vehículo no existe.');
    if (opts.install && opts.target.kind === 'skin' && !existsSync(join(opts.carPath, 'skins', opts.target.skin))) throw new Error('La skin no existe.');
    return selected.length === 1 ? selected[0].name : `${selected.length} displays`;
  })) return result;

  // --- backup único (en los datos de la aplicación) ---
  if (opts.install) {
    step('Copia de seguridad', () => {
      const root = backupRoot(opts.carPath, opts.target);
      const bdir = join(root, timestamp());
      mkdirSync(bdir, { recursive: true });
      const ext = readExt();
      if (ext) cpSync(extConfig, join(bdir, 'ext_config.ini'));
      const copied = new Set<string>();
      for (const dp of selected) {
        for (const rel of [...previousFiles(ext, dp.display_id), PROJECT_FILE]) {
          const f = join(base, rel);
          if (!existsSync(f) || copied.has(rel)) continue;
          copied.add(rel);
          mkdirSync(dirname(join(bdir, rel)), { recursive: true });
          cpSync(f, join(bdir, rel));
        }
        const legacy = join(base, 'acdg', dp.display_id);
        if (existsSync(legacy)) cpSync(legacy, join(bdir, 'acdg', dp.display_id), { recursive: true });
      }
      writeFileSync(join(bdir, 'backup.json'), JSON.stringify({ car: opts.carPath, target: opts.target, displays: selected.map((d) => d.display_id), files: [...copied] }, null, 2), 'utf8');
      writeFileSync(join(bdir, 'BACKUP.txt'), `Copia creada por AC Display Generator antes de instalar ${selected.map((d) => `"${d.display_id}"`).join(', ')} en ${base}.\nRestaura desde la aplicación (Restaurar original).\n`, 'utf8');
      pruneBackups(root, 10);
      return bdir;
    });
  }

  let luaOk = true;
  const runtime = runtimeSource();
  const many = selected.length > 1;
  let projectWritten = false;

  for (const dp of selected) {
    const display = displayFor(profile, dp.display_id);
    const tag = many ? `[${dp.name}] ` : '';
    const scriptName = opts.install ? scriptFileName(base, display.id) : `${display.id}.lua`;

    // --- generación en memoria ---
    const files: Record<string, Uint8Array | string> = {};
    let ok = step(`${tag}Generar Lua y configuración`, () => {
      const gen = generateConfigLua(project, dp, display, { fontMetrics: opts.fontMetrics });
      const displayLua = generateDisplayLua(gen.lua, runtime, display.id);
      for (const [name, code] of [
        ['display_config.lua', gen.lua],
        ['acdg_runtime.lua', runtime],
        [scriptName, displayLua],
      ] as const) {
        const err = validateLua(code, name);
        if (err) {
          luaOk = false;
          throw new Error(`Lua inválido — ${err}`);
        }
      }
      files[scriptName] = displayLua;
      for (const a of gen.assets) {
        if (a.source.startsWith('builtin:')) {
          const bytes = opts.extraFiles[a.target];
          if (!bytes) throw new Error(`Falta el icono integrado ${a.source} (no se pudo rasterizar).`);
          files[a.target] = bytes;
        } else {
          const bytes = session.assets.get(a.source);
          if (!bytes) throw new Error(`Falta el recurso ${a.source} en el proyecto.`);
          files[a.target] = bytes;
        }
      }
      return `${gen.variables.length} variables, ${gen.assets.length} recursos, ${dp.pages.length} página${dp.pages.length === 1 ? '' : 's'}`;
    });
    if (!ok) continue;

    if (opts.convertToDds && dp.background.file) {
      step(`${tag}Convertir fondo a DDS (DXT5 + mipmaps)`, () => {
        const target = Object.keys(files).find((k) => k !== scriptName && files[k] === session.assets.get(dp.background.file!));
        if (!target) return 'sin fondo';
        const { rgba, width, height } = toRgba(files[target] as Uint8Array);
        const dds = encodeDdsBc3(rgba, width, height, true);
        const ddsName = target.replace(/\.[^.]+$/, '.dds');
        delete files[target];
        files[ddsName] = new Uint8Array(dds);
        files[scriptName] = (files[scriptName] as string).replaceAll(target, ddsName);
        return `${width}×${height}, ${Math.round(dds.length / 1024)} KB`;
      });
    }

    const ini = generateDisplayIni(profile, display, { script: scriptName, interactive: displayHasTouch(dp) });
    const readme = generateReadme(project, dp, display, scriptName, Object.keys(files));

    if (opts.install && existsSync(extConfig)) {
      const conflicts = findConflictingDisplays(readExt(), display.meshes, display.id);
      const disabled = new Set((opts.disableSections ?? []).map((d) => `[${d.section}]`));
      const remaining = conflicts.filter((c) => !disabled.has(c));
      if (remaining.length) warnings.push(`${tag}ext_config.ini ya define un display sobre la misma malla: ${remaining.join(', ')}. Puede haber conflicto visual.`);
    }

    // --- escritura ---
    ok = step(`${tag}Escribir archivos`, () => {
      mkdirSync(base, { recursive: true });
      const removed = opts.install ? removePrevious(base, readExt(), display.id) : [];
      for (const [rel, data] of Object.entries(files)) {
        const abs = join(base, rel);
        if (typeof data === 'string') writeFileSync(abs, data, 'utf8');
        else writeFileSync(abs, data);
        result.files.push(abs);
      }
      if (!projectWritten) {
        writeFileSync(join(base, PROJECT_FILE), packProject(project));
        result.files.push(join(base, PROJECT_FILE));
        projectWritten = true;
      }
      return `${Object.keys(files).length} archivos en ${base}${removed.length ? ` (limpiados ${removed.length} de la instalación anterior)` : ''}`;
    });
    if (!ok) continue;

    if (opts.install) {
      step(`${tag}Añadir sección a ext_config.ini`, () => {
        const current = readExt();
        // la sección se escribe directamente (sin INCLUDE) entre marcadores, con la lista de archivos generados
        const body = ini
          .split('\n')
          .filter((l) => !l.startsWith(';'))
          .join('\n');
        const updated = upsertIncludeBlock(current, display.id, body, Object.keys(files));
        mkdirSync(dirname(extConfig), { recursive: true });
        writeFileSync(extConfig, updated, 'utf8');
        return current === '' ? 'ext_config.ini creado' : hasIncludeBlock(current, display.id) ? 'actualizado' : 'añadido';
      });
    } else {
      step(`${tag}Escribir instrucciones de instalación`, () => {
        writeFileSync(join(base, many ? `INSTALAR_${display.id}.txt` : 'INSTALAR.txt'), readme, 'utf8');
      });
    }

    // --- validación posterior ---
    step(`${tag}Comprobar instalación`, () => {
      const script = join(base, scriptName);
      if (!existsSync(script)) throw new Error(`Falta ${scriptName}`);
      const code = readFileSync(script, 'utf8');
      if (opts.install) {
        const block = parseIncludeBlock(readExt(), display.id);
        if (!block) throw new Error('El bloque de ext_config.ini no se escribió.');
        if (block.script?.toLowerCase() !== scriptName.toLowerCase()) throw new Error(`ext_config.ini apunta a ${block.script ?? '?'} en vez de ${scriptName}.`);
      }
      // el script final no debe depender de require ni dejar marcadores de plantilla
      if (/\brequire\(/.test(code)) throw new Error(`${scriptName} contiene require().`);
      if (/\{\{[A-Z_]+\}\}/.test(code)) throw new Error('Quedan marcadores de plantilla sin resolver.');
      for (const rel of Object.keys(files)) if (!existsSync(join(base, rel))) throw new Error(`Falta ${rel}`);
    });
  }

  if (opts.install && opts.disableSections?.length) {
    step('Desactivar displays existentes sobre la misma malla', () => {
      const done: string[] = [];
      for (const d of opts.disableSections!) {
        if (!existsSync(d.iniFile)) continue;
        const txt = readFileSync(d.iniFile, 'utf8');
        const next = disableSection(txt, d.section);
        if (next !== txt) {
          writeFileSync(d.iniFile, next, 'utf8');
          done.push(`[${d.section}] en ${basename(d.iniFile)}`);
        }
      }
      return done.join(', ') || 'nada que desactivar';
    });
  }
  // --- emisión de las pantallas: bloque al final de ext_config.ini (prevalece sobre el material del coche) ---
  if (opts.install) {
    step('Emisión de las pantallas', () => {
      const defs = selected.map((dp) => displayFor(profile, dp.display_id));
      const body = generateEmissiveIni(defs);
      const current = readExt();
      if (!body) {
        if (hasIncludeBlock(current, EMISSIVE_BLOCK_ID)) {
          writeFileSync(extConfig, removeIncludeBlock(current, EMISSIVE_BLOCK_ID), 'utf8');
          return 'como el coche (bloque anterior eliminado)';
        }
        return 'como el coche';
      }
      writeFileSync(extConfig, upsertIncludeBlock(current, EMISSIVE_BLOCK_ID, body), 'utf8');
      return defs.map((d) => `${d.name}: ${d.emissive.mode === 'shader_replacement' ? `${d.emissive.shader} + ` : ''}ksEmissive ${d.emissive.ks_emissive[0]}`).join(' · ');
    });
  }

  // --- agujas físicas: bloque [ANALOG_INDICATOR_...] propio, y se desactivan las secciones ajenas del mismo objeto ---
  if (opts.install) {
    step('Agujas físicas', () => {
      const needles = (project.physicalNeedles ?? []).filter((n) => n.object.trim());
      const current = readExt();
      if (needles.length === 0) {
        if (hasIncludeBlock(current, NEEDLES_BLOCK_ID)) {
          writeFileSync(extConfig, removeIncludeBlock(current, NEEDLES_BLOCK_ID), 'utf8');
          return 'sin agujas: bloque anterior eliminado';
        }
        return 'sin agujas';
      }
      const updated = upsertIncludeBlock(current, NEEDLES_BLOCK_ID, generateNeedlesIni(needles));
      mkdirSync(dirname(extConfig), { recursive: true });
      writeFileSync(extConfig, updated, 'utf8');
      const disabled = disableForeignIndicators(base, needles.map((n) => n.object));
      return `${needles.length} aguja${needles.length === 1 ? '' : 's'} (${needles.map((n) => n.object).join(', ')})${disabled.length ? ` · desactivadas ${disabled.length} secciones ajenas: ${disabled.join(', ')}` : ''}`;
    });
  }
  if (opts.install && opts.writeProfile) {
    step('Guardar perfil en el vehículo', () => {
      const f = join(opts.carPath, 'extension', 'display_profile.json');
      const txt = JSON.stringify(profile, null, 2);
      if (existsSync(f) && readFileSync(f, 'utf8') === txt) return 'sin cambios';
      const existed = existsSync(f);
      writeFileSync(f, txt, 'utf8');
      return existed ? 'display_profile.json actualizado' : 'display_profile.json creado';
    });
  }

  result.ok = errors.length === 0 && luaOk;
  return result;
}

function pruneBackups(dir: string, keep: number): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory())
    .sort();
  while (entries.length > keep) rmSync(join(dir, entries.shift()!), { recursive: true, force: true });
}

function readBackupMeta(dir: string): { displays: string[]; files: string[] } {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'backup.json'), 'utf8')) as { displays?: string[]; files?: string[] };
    return { displays: m.displays ?? [], files: m.files ?? [] };
  } catch {
    // formato antiguo: una carpeta por display
    return { displays: readdirSync(dir).filter((x) => x !== 'acdg' && statSync(join(dir, x)).isDirectory()), files: [] };
  }
}

export function listBackups(carPath: string, target: InstallTarget): BackupEntry[] {
  // copias nuevas (datos de la aplicación) + copias del formato antiguo dentro del coche
  const dirs = [backupRoot(carPath, target), join(baseDir(carPath, target), 'acdg', '_backup')];
  const out: BackupEntry[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const d of readdirSync(dir)) {
      if (!statSync(join(dir, d)).isDirectory()) continue;
      out.push({
        id: d,
        path: join(dir, d),
        date: d.replace('_', ' ').replace(/-(\d\d)-(\d\d)$/, ':$1:$2'),
        hasExtConfig: existsSync(join(dir, d, 'ext_config.ini')),
        displays: readBackupMeta(join(dir, d)).displays,
      });
    }
  }
  return out.sort((a, b) => b.id.localeCompare(a.id));
}

/** Restaura ext_config.ini y los archivos generados de una copia de seguridad. */
export function restoreBackup(carPath: string, target: InstallTarget, backupId: string): string[] {
  const base = baseDir(carPath, target);
  const bdir = [join(backupRoot(carPath, target), backupId), join(base, 'acdg', '_backup', backupId)].find((d) => existsSync(d));
  if (!bdir) throw new Error('La copia de seguridad no existe.');
  const restored: string[] = [];
  const ext = join(bdir, 'ext_config.ini');
  if (existsSync(ext)) {
    cpSync(ext, join(base, 'ext_config.ini'));
    restored.push('ext_config.ini');
  }
  for (const f of readdirSync(bdir)) {
    if (['ext_config.ini', 'backup.json', 'BACKUP.txt'].includes(f)) continue;
    const src = join(bdir, f);
    if (statSync(src).isDirectory()) {
      // formato antiguo: carpetas acdg/<id>
      const dst = f === 'acdg' ? join(base, 'acdg') : join(base, 'acdg', f);
      if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
      cpSync(src, dst, { recursive: true });
      restored.push(f === 'acdg' ? 'acdg/' : `acdg/${f}`);
    } else {
      cpSync(src, join(base, f));
      restored.push(f);
    }
  }
  return restored;
}

/** Elimina los archivos generados y la sección de ext_config.ini, dejando el coche como estaba. */
export function uninstall(carPath: string, target: InstallTarget, displayId: string): string[] {
  const base = baseDir(carPath, target);
  const done: string[] = [];
  const extConfig = join(base, 'ext_config.ini');
  const txt = existsSync(extConfig) ? readFileSync(extConfig, 'utf8') : '';
  const removed = removePrevious(base, txt, displayId);
  if (removed.length) done.push(`Eliminados ${removed.join(', ')}`);
  if (hasIncludeBlock(txt, displayId)) {
    const next = removeIncludeBlock(txt, displayId);
    writeFileSync(extConfig, next, 'utf8');
    done.push('Eliminada la sección de ext_config.ini');
    // la copia del proyecto y la emisión se conservan mientras quede algún display instalado
    if (listIncludeBlocks(next).filter((id) => !id.startsWith('_')).length === 0) {
      if (existsSync(join(base, PROJECT_FILE))) {
        rmSync(join(base, PROJECT_FILE), { force: true });
        done.push(`Eliminado ${PROJECT_FILE}`);
      }
      if (hasIncludeBlock(next, EMISSIVE_BLOCK_ID)) {
        writeFileSync(extConfig, removeIncludeBlock(next, EMISSIVE_BLOCK_ID), 'utf8');
        done.push('Eliminado el bloque de emisión');
      }
    }
  }
  // reactivar las secciones que se desactivaron al instalar (en ext_config.ini y demás .ini de la
  // carpeta). Si las agujas físicas siguen instaladas, las secciones [ANALOG_INDICATOR...] originales
  // se quedan desactivadas: si no, volverían a mover los mismos objetos que nuestras agujas.
  const needlesInstalled = hasIncludeBlock(existsSync(extConfig) ? readFileSync(extConfig, 'utf8') : '', NEEDLES_BLOCK_ID);
  if (existsSync(base)) {
    for (const f of readdirSync(base)) {
      if (!f.toLowerCase().endsWith('.ini')) continue;
      const p = join(base, f);
      const t = readFileSync(p, 'utf8');
      const next = needlesInstalled ? enableSectionsMatching(t, /^(?!ANALOG_INDICATOR)/i) : enableAllSections(t);
      if (next !== t) {
        writeFileSync(p, next, 'utf8');
        done.push(`Reactivado display original en ${f}`);
      }
    }
  }
  return done;
}

/**
 * Limpieza al empezar un proyecto: desactiva (comentando con ;ACDG-OFF;) todas las secciones de display
 * ajenas de extension/ que usen alguna de las mallas del proyecto, para que no se superpongan con lo
 * que genere la aplicación. Reversible: "Desinstalar" las reactiva. Antes se guarda copia de seguridad.
 */
export function cleanDisplays(carPath: string, meshes: string[]): CleanDisplaysResult {
  const target: InstallTarget = { kind: 'car' };
  const scan = scanExtension(carPath);
  const wanted = new Set(meshes.map((m) => m.toLowerCase()));
  const victims = scan.displays.filter((d) => !d.acdg && d.meshes.some((m) => wanted.has(m.toLowerCase())));
  const result: CleanDisplaysResult = { disabled: [], backup: null };
  if (victims.length === 0) return result;
  const root = backupRoot(carPath, target);
  const bdir = join(root, timestamp());
  mkdirSync(bdir, { recursive: true });
  const touched = new Map<string, string>();
  for (const v of victims) {
    if (!existsSync(v.iniFile)) continue;
    const txt = touched.get(v.iniFile) ?? readFileSync(v.iniFile, 'utf8');
    const next = disableSection(txt, v.section);
    if (next === txt) continue;
    touched.set(v.iniFile, next);
    result.disabled.push({ iniFile: v.iniFile, iniRelative: v.iniRelative, section: v.section, meshes: v.meshes });
  }
  if (result.disabled.length === 0) return result;
  for (const [file] of touched) cpSync(file, join(bdir, basename(file)));
  writeFileSync(join(bdir, 'backup.json'), JSON.stringify({ car: carPath, target, displays: [], files: [...touched.keys()].map((f) => basename(f)), reason: 'clean-displays' }, null, 2), 'utf8');
  writeFileSync(join(bdir, 'BACKUP.txt'), `Copia creada por AC Display Generator antes de desactivar los displays existentes (${result.disabled.map((d) => `[${d.section}] en ${d.iniRelative}`).join(', ')}).\n`, 'utf8');
  pruneBackups(root, 10);
  for (const [file, next] of touched) writeFileSync(file, next, 'utf8');
  result.backup = bdir;
  return result;
}

/**
 * Desactiva (;ACDG-OFF;) las secciones [ANALOG_INDICATOR...] ajenas de extension/ que muevan alguno de
 * los objetos dados, para que no compitan con las agujas del proyecto. Devuelve "[sección] en archivo".
 */
function disableForeignIndicators(base: string, objects: string[]): string[] {
  const wanted = new Set(objects.map((o) => o.trim().toLowerCase()).filter(Boolean));
  const done: string[] = [];
  if (!existsSync(base)) return done;
  for (const f of readdirSync(base)) {
    if (!f.toLowerCase().endsWith('.ini')) continue;
    const file = join(base, f);
    let txt = readFileSync(file, 'utf8');
    // las secciones dentro de bloques ACDG son nuestras
    const own = txt.replace(/; ACDG BEGIN [\s\S]*?; ACDG END [^\r\n]*/g, (m) => m.replace(/\[ANALOG_INDICATOR/gi, '[ACDG_OWN_INDICATOR'));
    const secs = parseIni(own).filter((s) => /^ANALOG_INDICATOR/i.test(s.name));
    let changed = false;
    for (const sec of secs) {
      const obj = (sec.values.OBJECT_NAME ?? sec.values.NAME ?? '').trim().toLowerCase();
      if (!obj || !wanted.has(obj)) continue;
      const next = disableSection(txt, sec.name);
      if (next !== txt) {
        txt = next;
        changed = true;
        done.push(`[${sec.name}] en ${f}`);
      }
    }
    if (changed) writeFileSync(file, txt, 'utf8');
  }
  return done;
}

/** Elimina el bloque de agujas físicas y reactiva las secciones [ANALOG_INDICATOR...] desactivadas. */
export function removeNeedles(carPath: string, target: InstallTarget): string[] {
  const base = baseDir(carPath, target);
  const done: string[] = [];
  const extConfig = join(base, 'ext_config.ini');
  if (existsSync(extConfig)) {
    const txt = readFileSync(extConfig, 'utf8');
    if (hasIncludeBlock(txt, NEEDLES_BLOCK_ID)) {
      writeFileSync(extConfig, removeIncludeBlock(txt, NEEDLES_BLOCK_ID), 'utf8');
      done.push('Eliminado el bloque de agujas de ext_config.ini');
    }
  }
  if (existsSync(base)) {
    for (const f of readdirSync(base)) {
      if (!f.toLowerCase().endsWith('.ini')) continue;
      const p = join(base, f);
      const t = readFileSync(p, 'utf8');
      const next = enableSectionsMatching(t, /^ANALOG_INDICATOR/i);
      if (next !== t) {
        writeFileSync(p, next, 'utf8');
        done.push(`Reactivadas las agujas originales en ${f}`);
      }
    }
  }
  return done;
}

/** Proyecto guardado dentro del coche por una instalación anterior. */
export function installedProjectFile(carPath: string, target: InstallTarget, displayId: string): string | null {
  const base = baseDir(carPath, target);
  const candidates = [join(base, PROJECT_FILE), join(base, 'acdg', displayId, 'project.acdisplay')];
  return candidates.find((f) => existsSync(f)) ?? null;
}
