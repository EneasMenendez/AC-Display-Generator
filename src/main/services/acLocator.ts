import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

/**
 * Localiza la instalación de Assetto Corsa (sección 4 / 29 de los requerimientos):
 * registro de Steam → libraryfolders.vdf → ruta manual (configurada por el usuario).
 */

export function isAcRoot(dir: string): boolean {
  return existsSync(join(dir, 'AssettoCorsa.exe')) && existsSync(join(dir, 'content', 'cars'));
}

async function steamPathFromRegistry(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  for (const key of ['HKCU\\Software\\Valve\\Steam', 'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam']) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', key, '/v', key.startsWith('HKCU') ? 'SteamPath' : 'InstallPath']);
      const m = /REG_SZ\s+(.+)$/m.exec(stdout);
      if (m) return m[1].trim().replace(/\//g, '\\');
    } catch {
      /* clave no encontrada */
    }
  }
  return null;
}

function steamLibraries(steamPath: string): string[] {
  const libs = new Set<string>([steamPath]);
  const vdf = join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (existsSync(vdf)) {
    const txt = readFileSync(vdf, 'utf8');
    for (const m of txt.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '\\'));
  }
  return [...libs];
}

export async function detectAcRoots(): Promise<string[]> {
  const found: string[] = [];
  const steam = await steamPathFromRegistry();
  const candidates: string[] = [];
  if (steam) for (const lib of steamLibraries(steam)) candidates.push(join(lib, 'steamapps', 'common', 'assettocorsa'));
  candidates.push('C:\\Program Files (x86)\\Steam\\steamapps\\common\\assettocorsa');
  for (const c of candidates) if (isAcRoot(c) && !found.includes(c)) found.push(c);
  return found;
}

/** Ejecutable de Content Manager si está en la carpeta de AC o en su ubicación habitual. */
export function findContentManager(acRoot: string | null): string | null {
  const candidates = [
    acRoot ? join(acRoot, 'Content Manager.exe') : '',
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Content Manager', 'Content Manager.exe'),
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Lee el build de CSP instalado a partir de extension/installed.log o del manifest. */
export function detectCspVersion(acRoot: string): string | null {
  const manifest = join(acRoot, 'extension', 'config', 'data_manifest.ini');
  if (existsSync(manifest)) {
    const m = /SHADERS_PATCH\s*=\s*([^\r\n]+)/.exec(readFileSync(manifest, 'utf8'));
    if (m) return m[1].trim();
  }
  return null;
}
