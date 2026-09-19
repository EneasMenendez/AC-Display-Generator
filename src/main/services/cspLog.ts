import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import type { CspLogReport } from '@shared/types';

/**
 * Lee el registro de CSP (Documents/Assetto Corsa/logs/custom_shaders_patch.log) para diagnosticar
 * si el display se cargó en la última sesión: líneas [ACDG], errores de Lua y carga de configs del coche.
 */
export function readCspLog(carId: string): CspLogReport {
  const file = join(app.getPath('documents'), 'Assetto Corsa', 'logs', 'custom_shaders_patch.log');
  if (!existsSync(file)) return { file, exists: false, modified: null, started: null, carLoaded: false, acdgLines: [], errorLines: [], luaLines: [] };
  const txt = readFileSync(file, 'utf8');
  const lines = txt.split(/\r?\n/);
  const id = carId.toLowerCase();
  const acdgLines: string[] = [];
  const errorLines: string[] = [];
  const luaLines: string[] = [];
  let carLoaded = false;
  for (const l of lines) {
    const low = l.toLowerCase();
    if (low.includes('[acdg]') || low.includes('acdg/') || low.includes('acdg_')) acdgLines.push(l.trim());
    if (low.includes(id) && (low.includes('loading configs') || low.includes('configs for'))) carLoaded = true;
    // errores reales: fallos del runtime ACDG o errores de Lua en scripts de display del coche
    // (los avisos 🚨 de CSP sobre sus propias apps —Mumble, navegador…— y la línea "[ACDG] … cargado" no lo son)
    const isAcdgError = low.includes('[acdg]') && low.includes('error');
    const isCarDisplayError = (low.includes('car display') || low.includes(id)) && /(error|exception|failed|traceback|attempt to|stack)/.test(low) && !low.includes('cargado');
    if (isAcdgError || isCarDisplayError) errorLines.push(l.trim());
    if (low.includes('lua') && (low.includes('display') || low.includes(id))) luaLines.push(l.trim());
  }
  const started = /date & time: ([^,]+)/.exec(lines[0] ?? '')?.[1] ?? null;
  return {
    file,
    exists: true,
    modified: statSync(file).mtime.toISOString(),
    started,
    carLoaded,
    acdgLines: acdgLines.slice(-40),
    errorLines: errorLines.slice(-40),
    luaLines: luaLines.slice(-20),
  };
}
