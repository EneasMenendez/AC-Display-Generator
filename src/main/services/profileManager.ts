import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { app } from 'electron';
import { resourcesDir } from './resources';
import { parseProfile, type DisplayProfile } from '@shared/profile';
import type { ProfileHit, ProfileSearchResult } from '@shared/types';
export type { ProfileHit, ProfileSearchResult };

/**
 * Profile Manager (secciones 5 y 25): busca perfiles dentro del coche, en la biblioteca local
 * o por selección manual. Valida con el esquema zod.
 */

export function libraryDir(): string {
  const dir = join(app.getPath('userData'), 'profiles');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function loadProfileFile(file: string): { profile?: DisplayProfile; errors: string[] } {
  try {
    const json = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const r = parseProfile(json);
    return r.ok ? { profile: r.profile, errors: [] } : { errors: r.errors };
  } catch (e) {
    return { errors: [`No se puede leer el JSON: ${(e as Error).message}`] };
  }
}

function candidateFiles(carPath: string): string[] {
  const ext = join(carPath, 'extension');
  const files: string[] = [];
  const single = join(ext, 'display_profile.json');
  if (existsSync(single)) files.push(single);
  const multi = join(ext, 'display_profiles');
  if (existsSync(multi)) for (const f of readdirSync(multi)) if (f.toLowerCase().endsWith('.json')) files.push(join(multi, f));
  return files;
}

export function findProfiles(carPath: string): ProfileSearchResult {
  const carId = basename(carPath).toLowerCase();
  const hits: ProfileHit[] = [];
  const errors: ProfileSearchResult['errors'] = [];

  for (const file of candidateFiles(carPath)) {
    const r = loadProfileFile(file);
    if (r.profile) hits.push({ profile: r.profile, file, source: 'car' });
    else errors.push({ file, errors: r.errors });
  }

  // biblioteca local del usuario y perfiles de ejemplo incluidos con la aplicación
  const dirs: { dir: string; source: ProfileHit['source'] }[] = [
    { dir: libraryDir(), source: 'library' },
    { dir: join(resourcesDir(), 'profiles'), source: 'bundled' },
  ];
  for (const { dir, source } of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      const file = join(dir, f);
      const r = loadProfileFile(file);
      if (!r.profile) {
        errors.push({ file, errors: r.errors });
        continue;
      }
      if (r.profile.car_ids.some((id) => id.toLowerCase() === carId) && !hits.some((h) => h.profile.id === r.profile!.id)) {
        hits.push({ profile: r.profile, file, source });
      }
    }
  }
  return { hits, errors };
}

export function loadProfileManual(file: string): ProfileHit | { errors: string[] } {
  const r = loadProfileFile(file);
  return r.profile ? { profile: r.profile, file, source: 'manual' } : { errors: r.errors };
}

/** Guarda un perfil en la biblioteca local (modo creador). */
export function saveToLibrary(profile: DisplayProfile): string {
  const file = join(libraryDir(), `${profile.id.replace(/[^A-Za-z0-9_.-]+/g, '_')}.json`);
  writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
  return file;
}

/** Coloca el perfil dentro del vehículo para su distribución (modo creador). */
export function saveToCar(profile: DisplayProfile, carPath: string): string {
  const ext = join(carPath, 'extension');
  if (!existsSync(ext)) mkdirSync(ext, { recursive: true });
  const file = join(ext, 'display_profile.json');
  writeFileSync(file, JSON.stringify(profile, null, 2), 'utf8');
  return file;
}
