import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resourcesDir } from './resources';
import luaparse from 'luaparse';
import type { Project } from '@shared/model';
import type { DisplayDef, DisplayProfile } from '@shared/profile';
import {
  generateConfigLua,
  generateDisplayIni,
  generateDisplayLua,
  generateReadme,
  hasIncludeBlock,
  removeIncludeBlock,
  upsertIncludeBlock,
  findConflictingDisplays,
} from '@shared/generator';
import { session, packProject } from './projectManager';
import { disableSection, enableAllSections } from '@shared/ini';
import { encodeDdsBc3, toRgba } from './imageManager';
import type { BackupEntry, InstallOptions, InstallResult, InstallStep, InstallTarget } from '@shared/types';
export type { BackupEntry, InstallOptions, InstallResult, InstallStep, InstallTarget };

/**
 * Installer + Backup Manager + Validator (secciones 20, 22 y 23).
 * Todo lo generado vive en <base>/acdg/<display_id>/ ; en ext_config.ini solo se añade el bloque INCLUDE.
 */

export function runtimeSource(): string {
  const f = join(resourcesDir(), 'runtime', 'acdg_runtime.lua');
  if (!existsSync(f)) throw new Error('No se encontró acdg_runtime.lua en los recursos de la aplicación.');
  return readFileSync(f, 'utf8');
}

export function validateLua(code: string, name: string): string | null {
  try {
    luaparse.parse(code, { luaVersion: '5.1', comments: false });
    return null;
  } catch (e) {
    const err = e as { message?: string; line?: number };
    return `${name}: ${err.message ?? 'error de sintaxis'}${err.line ? ` (línea ${err.line})` : ''}`;
  }
}

function baseDir(carPath: string, target: InstallTarget): string {
  return target.kind === 'car' ? join(carPath, 'extension') : join(carPath, 'skins', target.skin);
}

export function displayFor(profile: DisplayProfile, displayId: string): DisplayDef {
  const d = profile.displays.find((x) => x.id === displayId);
  if (!d) throw new Error(`El perfil no contiene el display "${displayId}".`);
  return d;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
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
  const display = displayFor(profile, project.display_id);
  const folderRel = `acdg/${display.id}`;
  const base = opts.install ? baseDir(opts.carPath, opts.target) : opts.exportDir!;
  const folder = join(base, 'acdg', display.id);
  const result: InstallResult = { ok: false, steps, folder, warnings, errors };

  // --- validación previa ---
  if (!step('Validar proyecto y perfil', () => {
    if (project.canvas.width !== display.texture_size.width || project.canvas.height !== display.texture_size.height) {
      throw new Error(`El lienzo (${project.canvas.width}×${project.canvas.height}) no coincide con la textura del perfil (${display.texture_size.width}×${display.texture_size.height}).`);
    }
    if (project.background.file && !session.assets.has(project.background.file)) throw new Error('Falta la imagen de fondo en el proyecto.');
    if (opts.install && !existsSync(opts.carPath)) throw new Error('La carpeta del vehículo no existe.');
    if (opts.install && opts.target.kind === 'skin' && !existsSync(join(opts.carPath, 'skins', opts.target.skin))) throw new Error('La skin no existe.');
  })) return result;

  // --- generación en memoria ---
  const files: Record<string, Uint8Array | string> = {};
  let luaOk = true;
  if (!step('Generar Lua y configuración', () => {
    const gen = generateConfigLua(project, display);
    const runtime = runtimeSource();
    const displayLua = generateDisplayLua();
    for (const [name, code] of [
      ['display_config.lua', gen.lua],
      ['acdg_runtime.lua', runtime],
      ['display.lua', displayLua],
    ] as const) {
      const err = validateLua(code, name);
      if (err) {
        luaOk = false;
        throw new Error(`Lua inválido — ${err}`);
      }
      files[name] = code;
    }
    files['display.ini'] = generateDisplayIni(profile, display, { folder: folderRel });
    files['LEEME.txt'] = generateReadme(project, display, folderRel);
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
    for (const [k, v] of Object.entries(opts.extraFiles)) if (!files[k]) files[k] = v;
    files['project.acdisplay'] = packProject(project);
    return `${gen.variables.length} variables, ${gen.assets.length} recursos`;
  })) return result;

  if (opts.convertToDds && project.background.file) {
    step('Convertir fondo a DDS (DXT5 + mipmaps)', () => {
      const target = Object.keys(files).find((k) => k.startsWith('assets/') && files[k] === session.assets.get(project.background.file!));
      if (!target) return 'sin fondo';
      const { rgba, width, height } = toRgba(files[target] as Uint8Array);
      const dds = encodeDdsBc3(rgba, width, height, true);
      const ddsName = target.replace(/\.[^.]+$/, '.dds');
      delete files[target];
      files[ddsName] = new Uint8Array(dds);
      files['display_config.lua'] = (files['display_config.lua'] as string).replace(target, ddsName);
      return `${width}×${height}, ${Math.round(dds.length / 1024)} KB`;
    });
  }

  // --- backup ---
  const extConfig = join(base, 'ext_config.ini');
  if (opts.install) {
    step('Copia de seguridad', () => {
      const bdir = join(base, 'acdg', '_backup', timestamp());
      mkdirSync(bdir, { recursive: true });
      if (existsSync(extConfig)) cpSync(extConfig, join(bdir, 'ext_config.ini'));
      if (existsSync(folder)) cpSync(folder, join(bdir, display.id), { recursive: true });
      writeFileSync(join(bdir, 'BACKUP.txt'), `Copia creada por AC Display Generator antes de instalar "${display.id}".\nRestaura desde la aplicación (Restaurar original).\n`, 'utf8');
      pruneBackups(join(base, 'acdg', '_backup'), 10);
      return bdir;
    });
    if (existsSync(extConfig)) {
      const conflicts = findConflictingDisplays(readFileSync(extConfig, 'utf8'), display.meshes, display.id);
      if (conflicts.length) warnings.push(`ext_config.ini ya define un display sobre la misma malla: ${conflicts.join(', ')}. Puede haber conflicto visual.`);
    }
  }

  // --- escritura ---
  if (!step('Escribir archivos', () => {
    if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    for (const [rel, data] of Object.entries(files)) {
      const abs = join(folder, rel);
      mkdirSync(dirname(abs), { recursive: true });
      if (typeof data === 'string') writeFileSync(abs, data, 'utf8');
      else writeFileSync(abs, data);
    }
    return `${Object.keys(files).length} archivos en ${folder}`;
  })) return result;

  if (opts.install) {
    step('Añadir INCLUDE a ext_config.ini', () => {
      const current = existsSync(extConfig) ? readFileSync(extConfig, 'utf8') : '';
      const updated = upsertIncludeBlock(current, display.id, folderRel);
      mkdirSync(dirname(extConfig), { recursive: true });
      writeFileSync(extConfig, updated, 'utf8');
      return current === '' ? 'ext_config.ini creado' : hasIncludeBlock(current, display.id) ? 'actualizado' : 'añadido';
    });
    if (opts.disableSections?.length) {
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
    if (opts.writeProfile) {
      step('Guardar perfil en el vehículo', () => {
        const f = join(opts.carPath, 'extension', 'display_profile.json');
        if (existsSync(f)) return 'ya existía';
        writeFileSync(f, JSON.stringify(profile, null, 2), 'utf8');
        return 'display_profile.json creado';
      });
    }
  } else {
    step('Escribir instrucciones de instalación', () => {
      writeFileSync(join(base, 'INSTALAR.txt'), files['LEEME.txt'] as string, 'utf8');
    });
  }

  // --- validación posterior ---
  step('Comprobar instalación', () => {
    const required = ['display.ini', 'display.lua', 'acdg_runtime.lua', 'display_config.lua'];
    for (const f of required) if (!existsSync(join(folder, f))) throw new Error(`Falta ${f}`);
    if (opts.install && !hasIncludeBlock(readFileSync(extConfig, 'utf8'), display.id)) throw new Error('El bloque INCLUDE no se escribió.');
    const cfg = readFileSync(join(folder, 'display_config.lua'), 'utf8');
    if (/\{\{[A-Z_]+\}\}/.test(cfg)) throw new Error('Quedan marcadores de plantilla sin resolver.');
  });

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

export function listBackups(carPath: string, target: InstallTarget): BackupEntry[] {
  const dir = join(baseDir(carPath, target), 'acdg', '_backup');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory())
    .sort()
    .reverse()
    .map((d) => ({
      id: d,
      path: join(dir, d),
      date: d.replace('_', ' ').replace(/-(\d\d)-(\d\d)$/, ':$1:$2'),
      hasExtConfig: existsSync(join(dir, d, 'ext_config.ini')),
      displays: readdirSync(join(dir, d)).filter((x) => statSync(join(dir, d, x)).isDirectory()),
    }));
}

/** Restaura ext_config.ini y las carpetas de display de una copia de seguridad. */
export function restoreBackup(carPath: string, target: InstallTarget, backupId: string): string[] {
  const base = baseDir(carPath, target);
  const bdir = join(base, 'acdg', '_backup', backupId);
  if (!existsSync(bdir)) throw new Error('La copia de seguridad no existe.');
  const restored: string[] = [];
  const ext = join(bdir, 'ext_config.ini');
  if (existsSync(ext)) {
    cpSync(ext, join(base, 'ext_config.ini'));
    restored.push('ext_config.ini');
  }
  for (const d of readdirSync(bdir)) {
    const src = join(bdir, d);
    if (!statSync(src).isDirectory()) continue;
    const dst = join(base, 'acdg', d);
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
    restored.push(`acdg/${d}`);
  }
  return restored;
}

/** Elimina la carpeta generada y el bloque INCLUDE, dejando el coche como estaba. */
export function uninstall(carPath: string, target: InstallTarget, displayId: string): string[] {
  const base = baseDir(carPath, target);
  const done: string[] = [];
  const folder = join(base, 'acdg', displayId);
  if (existsSync(folder)) {
    rmSync(folder, { recursive: true, force: true });
    done.push(`Eliminada carpeta acdg/${displayId}`);
  }
  const extConfig = join(base, 'ext_config.ini');
  if (existsSync(extConfig)) {
    const txt = readFileSync(extConfig, 'utf8');
    if (hasIncludeBlock(txt, displayId)) {
      writeFileSync(extConfig, removeIncludeBlock(txt, displayId), 'utf8');
      done.push('Eliminado bloque INCLUDE de ext_config.ini');
    }
  }
  // reactivar las secciones que se desactivaron al instalar (en ext_config.ini y demás .ini de la carpeta)
  for (const f of readdirSync(base)) {
    if (!f.toLowerCase().endsWith('.ini')) continue;
    const p = join(base, f);
    const txt = readFileSync(p, 'utf8');
    const next = enableAllSections(txt);
    if (next !== txt) {
      writeFileSync(p, next, 'utf8');
      done.push(`Reactivado display original en ${f}`);
    }
  }
  return done;
}

/** Proyecto guardado dentro del coche por una instalación anterior. */
export function installedProjectFile(carPath: string, target: InstallTarget, displayId: string): string | null {
  const f = join(baseDir(carPath, target), 'acdg', displayId, 'project.acdisplay');
  return existsSync(f) ? f : null;
}
