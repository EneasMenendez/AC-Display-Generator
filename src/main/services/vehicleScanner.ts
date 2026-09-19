import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { findConflictingDisplays, listIncludeBlocks } from '@shared/generator';
import type { CarInfo, CarSummary } from '@shared/types';
export type { CarInfo, CarSummary };

/**
 * Vehicle Scanner (sección 4): valida carpetas de coche, lista coches de una instalación y
 * detecta displays existentes.
 */

function readJsonSafe<T>(file: string): T | null {
  try {
    // ui_car.json a veces lleva BOM o caracteres de control; se limpia antes de parsear
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function decodeHtml(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}

/** true si ext_config.ini tiene algún bloque ACDG (o queda una carpeta acdg/ del formato antiguo). */
function hasAcdgInstall(extDir: string): boolean {
  const ext = join(extDir, 'ext_config.ini');
  try {
    if (existsSync(ext) && listIncludeBlocks(readFileSync(ext, 'utf8')).length > 0) return true;
  } catch {
    /* ignorar */
  }
  return existsSync(join(extDir, 'acdg'));
}

export function summarizeCar(carPath: string): CarSummary {
  const id = basename(carPath);
  const ui = readJsonSafe<{ name?: string; brand?: string }>(join(carPath, 'ui', 'ui_car.json'));
  const badge = join(carPath, 'ui', 'badge.png');
  return {
    id,
    path: carPath,
    name: ui?.name ? decodeHtml(ui.name) : id,
    brand: ui?.brand ? decodeHtml(ui.brand) : '',
    badge: existsSync(badge) ? `data:image/png;base64,${readFileSync(badge).toString('base64')}` : null,
    hasProfile: existsSync(join(carPath, 'extension', 'display_profile.json')) || existsSync(join(carPath, 'extension', 'display_profiles')),
    hasAcdg: hasAcdgInstall(join(carPath, 'extension')),
  };
}

export function listCars(acRoot: string): CarSummary[] {
  const carsDir = join(acRoot, 'content', 'cars');
  if (!existsSync(carsDir)) return [];
  const out: CarSummary[] = [];
  for (const entry of readdirSync(carsDir)) {
    const p = join(carsDir, entry);
    try {
      if (!statSync(p).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!existsSync(join(p, 'ui', 'ui_car.json')) && !existsSync(join(p, 'data.acd')) && !existsSync(join(p, 'data'))) continue;
    out.push(summarizeCar(p));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function scanCar(carPath: string): CarInfo {
  const summary = summarizeCar(carPath);
  const problems: string[] = [];
  const hasDataFolder = existsSync(join(carPath, 'data'));
  const hasDataAcd = existsSync(join(carPath, 'data.acd'));
  let kn5Files: string[] = [];
  try {
    kn5Files = readdirSync(carPath).filter((f) => f.toLowerCase().endsWith('.kn5'));
  } catch {
    problems.push('No se puede leer la carpeta del vehículo.');
  }
  if (!hasDataFolder && !hasDataAcd) problems.push('No se encontró data/ ni data.acd: no parece un vehículo de Assetto Corsa.');
  if (kn5Files.length === 0) problems.push('No se encontró ningún archivo .kn5 (modelo 3D).');
  if (!existsSync(join(carPath, 'ui', 'ui_car.json'))) problems.push('Falta ui/ui_car.json (no es bloqueante).');

  // El kn5 principal suele llamarse como la carpeta; si no, el más grande que no sea collider/lod
  let mainKn5: string | null = null;
  const byName = kn5Files.find((f) => f.toLowerCase() === `${summary.id.toLowerCase()}.kn5`);
  if (byName) mainKn5 = byName;
  else {
    const candidates = kn5Files.filter((f) => !/collider|_lod|driver|copiloto|farada/i.test(f));
    candidates.sort((a, b) => statSync(join(carPath, b)).size - statSync(join(carPath, a)).size);
    mainKn5 = candidates[0] ?? kn5Files[0] ?? null;
  }

  const extDir = join(carPath, 'extension');
  const extConfig = join(extDir, 'ext_config.ini');
  const hasExtConfig = existsSync(extConfig);
  const scriptableDisplays: string[] = [];
  if (hasExtConfig) {
    const txt = readFileSync(extConfig, 'utf8');
    for (const m of txt.matchAll(/^\s*\[(SCRIPTABLE_DISPLAY[^\]]*)\]/gim)) scriptableDisplays.push(m[1]);
  }

  const skins: CarInfo['skins'] = [];
  const skinsDir = join(carPath, 'skins');
  if (existsSync(skinsDir)) {
    for (const s of readdirSync(skinsDir)) {
      const sp = join(skinsDir, s);
      try {
        if (statSync(sp).isDirectory()) skins.push({ id: s, hasExtConfig: existsSync(join(sp, 'ext_config.ini')) });
      } catch {
        /* ignorar */
      }
    }
  }

  const installedDisplays: string[] = [];
  const extIni = join(extDir, 'ext_config.ini');
  if (existsSync(extIni)) {
    try {
      installedDisplays.push(...listIncludeBlocks(readFileSync(extIni, 'utf8')));
    } catch {
      /* ignorar */
    }
  }
  // formato antiguo: carpetas acdg/<id>/
  const acdgDir = join(extDir, 'acdg');
  if (existsSync(acdgDir)) {
    for (const d of readdirSync(acdgDir)) {
      if (d.startsWith('_') || installedDisplays.includes(d)) continue;
      if (existsSync(join(acdgDir, d, 'display_config.lua'))) installedDisplays.push(d);
    }
  }

  const blocking = problems.filter((p) => !p.includes('no es bloqueante'));
  return {
    ...summary,
    valid: blocking.length === 0,
    problems,
    hasDataFolder,
    hasDataAcd,
    kn5Files,
    mainKn5,
    hasExtension: existsSync(extDir),
    hasExtConfig,
    skins,
    installedDisplays,
    scriptableDisplays,
  };
}

/** Conflictos de mallas con displays ajenos en el ext_config del coche. */
export function findMeshConflicts(carPath: string, meshes: string[], ownDisplayId: string): string[] {
  const extConfig = join(carPath, 'extension', 'ext_config.ini');
  if (!existsSync(extConfig)) return [];
  return findConflictingDisplays(readFileSync(extConfig, 'utf8'), meshes, ownDisplayId);
}
