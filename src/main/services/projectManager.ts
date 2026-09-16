import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { app } from 'electron';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import type { Project } from '@shared/model';
import { migrateProject } from '@shared/model';
import { ddsToPng } from './imageManager';
import type { RecentEntry } from '@shared/types';
export type { RecentEntry };

/**
 * Project Manager (sección 19): archivo .acdisplay = ZIP con project.json + assets/ + thumbnail.png.
 * Los assets viven en memoria en el proceso principal (ProjectSession) mientras el proyecto está abierto.
 */

export interface ProjectSession {
  file: string | null;
  assets: Map<string, Uint8Array>;
}

export const session: ProjectSession = { file: null, assets: new Map() };

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.dds': 'application/octet-stream',
};

export function toDataUrl(path: string, data: Uint8Array): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.dds') {
    // el editor no puede mostrar DDS: se decodifica a PNG (BC1/BC3/RGBA8)
    try {
      const png = ddsToPng(Buffer.from(data));
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch {
      /* formato no soportado: se devuelve tal cual y el editor mostrará un marcador */
    }
  }
  const mime = MIME[ext] ?? 'application/octet-stream';
  return `data:${mime};base64,${Buffer.from(data).toString('base64')}`;
}

export function assetDataUrls(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of session.assets) out[k] = toDataUrl(k, v);
  return out;
}

export function newSession(): void {
  session.file = null;
  session.assets.clear();
}

/** Añade un archivo externo como asset del proyecto; devuelve su ruta interna. */
export function addAsset(externalFile: string, folder: 'assets' | 'assets/icons' | 'assets/fonts' = 'assets'): { path: string; dataUrl: string } {
  const data = new Uint8Array(readFileSync(externalFile));
  let name = basename(externalFile).replace(/[^A-Za-z0-9_.-]+/g, '_');
  let path = `${folder}/${name}`;
  let n = 1;
  while (session.assets.has(path) && !sameBytes(session.assets.get(path)!, data)) {
    const ext = extname(name);
    path = `${folder}/${name.slice(0, name.length - ext.length)}_${n++}${ext}`;
  }
  session.assets.set(path, data);
  return { path, dataUrl: toDataUrl(path, data) };
}

export function addAssetBytes(path: string, data: Uint8Array): void {
  session.assets.set(path, data);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function removeUnusedAssets(used: Set<string>): void {
  for (const k of [...session.assets.keys()]) if (!used.has(k)) session.assets.delete(k);
}

export function packProject(project: Project, thumbnailPng?: Uint8Array): Uint8Array {
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(project, null, 2)) };
  for (const [k, v] of session.assets) files[k] = v;
  if (thumbnailPng) files['thumbnail.png'] = thumbnailPng;
  return zipSync(files, { level: 6 });
}

export function saveProject(file: string, project: Project, thumbnailPng?: Uint8Array): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, packProject(project, thumbnailPng));
  session.file = file;
  addRecent(file, project.name);
}

export function openProject(file: string): { project: Project; assets: Record<string, string> } {
  const zip = unzipSync(new Uint8Array(readFileSync(file)));
  const raw = zip['project.json'];
  if (!raw) throw new Error('El archivo no contiene project.json: no es un proyecto .acdisplay válido.');
  const project = migrateProject(JSON.parse(strFromU8(raw)));
  session.file = file;
  session.assets.clear();
  for (const [k, v] of Object.entries(zip)) if (k.startsWith('assets/')) session.assets.set(k, v);
  addRecent(file, project.name);
  return { project, assets: assetDataUrls() };
}

/* ---------- recientes ---------- */

function recentFile(): string {
  return join(app.getPath('userData'), 'recent.json');
}

export function listRecent(): RecentEntry[] {
  try {
    const list = JSON.parse(readFileSync(recentFile(), 'utf8')) as RecentEntry[];
    return list.filter((r) => existsSync(r.file));
  } catch {
    return [];
  }
}

export function addRecent(file: string, name: string): void {
  const list = listRecent().filter((r) => r.file.toLowerCase() !== file.toLowerCase());
  list.unshift({ file, name, openedAt: new Date().toISOString() });
  writeFileSync(recentFile(), JSON.stringify(list.slice(0, 15), null, 2), 'utf8');
}

export function defaultProjectsDir(): string {
  const dir = join(app.getPath('documents'), 'AC Display Generator');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
