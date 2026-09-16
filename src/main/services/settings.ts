import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { AppSettings } from '@shared/types';
export type { AppSettings };

const DEFAULTS: AppSettings = { acRoot: null, lastCar: null, language: 'es', convertToDds: false, theme: 'dark' };

function file(): string {
  return join(app.getPath('userData'), 'config.json');
}

export function loadSettings(): AppSettings {
  try {
    if (existsSync(file())) return { ...DEFAULTS, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<AppSettings>) };
  } catch {
    /* config corrupta: se usan valores por defecto */
  }
  return { ...DEFAULTS };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  writeFileSync(file(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
