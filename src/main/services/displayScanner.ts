import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import type { DetectedDisplay, ExtensionScan } from '@shared/types';
import { parseIni, type IniSection } from '@shared/ini';
import { validateLua } from './installer';

/**
 * Display Scanner: inspecciona <coche>/extension en busca de todo lo relacionado con displays.
 * - ext_config.ini (y los .ini que incluye) → secciones [SCRIPTABLE_DISPLAY...]
 * - otros .ini de la carpeta con secciones de display no incluidas (p. ej. starletDisplay.ini)
 * - scripts Lua referenciados: existencia, validez sintáctica, si son de ACDG (proyecto reutilizable)
 *   y pistas (resolución, imágenes, fuentes) para importar displays hechos a mano.
 */

const IMG_RE = /['"]([^'"\n]+?\.(?:dds|png|jpg|jpeg))['"]/gi;
const FONT_RE = /['"]([^'"\n]+?\.(?:ttf|otf))['"]/gi;

function listFiles(dir: string, ext: string, depth = 2): string[] {
  const out: string[] = [];
  if (!existsSync(dir) || depth < 0) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    try {
      const st = statSync(p);
      if (st.isDirectory()) {
        if (f === 'acdg' || f === '_backup') continue;
        out.push(...listFiles(p, ext, depth - 1));
      } else if (f.toLowerCase().endsWith(ext)) out.push(p);
    } catch {
      /* ignorar */
    }
  }
  return out;
}

/** Resuelve los [INCLUDE] de un ini (rutas relativas a la carpeta del ini). Devuelve los archivos existentes. */
function resolveIncludes(iniFile: string, sections: IniSection[]): string[] {
  const dir = dirname(iniFile);
  const out: string[] = [];
  for (const s of sections) {
    let targets: string[] = [];
    if (/^INCLUDE\s*:/i.test(s.name)) targets = [s.name.replace(/^INCLUDE\s*:\s*/i, '').trim()];
    else if (/^INCLUDE/i.test(s.name)) targets = Object.entries(s.values).filter(([k]) => /^INCLUDE/i.test(k)).map(([, v]) => v);
    for (const t of targets) {
      for (const part of t.split(',')) {
        const f = join(dir, part.trim());
        if (existsSync(f) && statSync(f).isFile()) out.push(f);
      }
    }
  }
  return out;
}

function scriptHints(scriptFile: string): DetectedDisplay['hints'] {
  const hints: DetectedDisplay['hints'] = { images: [], fonts: [] };
  let code = '';
  try {
    code = readFileSync(scriptFile, 'utf8');
  } catch {
    return hints;
  }
  const dir = dirname(scriptFile);
  const w = /DISPLAY_W(?:IDTH)?\s*=\s*(\d{2,5})/i.exec(code);
  const h = /DISPLAY_H(?:EIGHT)?\s*=\s*(\d{2,5})/i.exec(code);
  if (w && h) {
    hints.width = Number(w[1]);
    hints.height = Number(h[1]);
  } else {
    // el vec2 más grande suele ser el tamaño del display
    let best: [number, number] | null = null;
    for (const m of code.matchAll(/vec2\(\s*(\d{3,5})\s*,\s*(\d{3,5})\s*\)/g)) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (!best || a * b > best[0] * best[1]) best = [a, b];
    }
    if (best) [hints.width, hints.height] = best;
  }
  const seen = new Set<string>();
  for (const m of code.matchAll(IMG_RE)) {
    const rel = m[1].replace(/\\/g, '/');
    for (const cand of [join(dir, rel), join(dir, '..', rel)]) {
      if (existsSync(cand) && !seen.has(cand)) {
        seen.add(cand);
        hints.images.push(cand);
      }
    }
  }
  for (const m of code.matchAll(FONT_RE)) {
    const cand = join(dir, m[1]);
    if (existsSync(cand)) hints.fonts.push(cand);
  }
  return hints;
}

function parseIniFile(file: string): IniSection[] {
  try {
    return parseIni(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

export function scanExtension(carPath: string): ExtensionScan {
  const extDir = join(carPath, 'extension');
  const extConfig = join(extDir, 'ext_config.ini');
  const hasExtConfig = existsSync(extConfig);
  const displays: DetectedDisplay[] = [];
  const visited = new Set<string>();

  const scanIni = (file: string, includedInExtConfig: boolean, followIncludes: boolean): void => {
    const key = file.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);
    const sections = parseIniFile(file);
    for (const s of sections) {
      if (!/^SCRIPTABLE_DISPLAY/i.test(s.name)) continue;
      const meshes = (s.values.MESHES ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const scriptRel = s.values.SCRIPT?.trim() ?? null;
      // CSP resuelve SCRIPT respecto a la carpeta de configuración (extension/), también en archivos incluidos;
      // como respaldo se prueba junto al propio .ini
      let script: string | null = null;
      if (scriptRel) {
        const candidates = [join(extDir, scriptRel), join(dirname(file), scriptRel)];
        script = candidates.find((c) => existsSync(c)) ?? candidates[0];
      }
      const scriptExists = !!script && existsSync(script);
      let scriptValid: boolean | null = null;
      let scriptError: string | undefined;
      if (script && scriptExists) {
        const err = validateLua(readFileSync(script, 'utf8'), basename(script));
        scriptValid = !err;
        scriptError = err ?? undefined;
      }
      const acdgMatch = /^SCRIPTABLE_DISPLAY_ACDG_(.+)$/i.exec(s.name);
      let acdg: DetectedDisplay['acdg'] = null;
      if (acdgMatch && script) {
        const folder = dirname(script);
        const projectFile = join(folder, 'project.acdisplay');
        acdg = { displayId: acdgMatch[1].toLowerCase(), projectFile: existsSync(projectFile) ? projectFile : null, folder };
      }
      const res = s.values.RESOLUTION?.split(',').map((x) => Number(x.trim()));
      displays.push({
        section: s.name,
        iniFile: file,
        iniRelative: relative(extDir, file).replace(/\\/g, '/'),
        includedInExtConfig,
        meshes,
        script,
        scriptRelative: scriptRel,
        scriptExists,
        scriptValid,
        scriptError,
        keepBackground: (s.values.KEEP_BACKGROUND ?? '0').trim() === '1',
        skipFrames: Number(s.values.SKIP_FRAMES ?? 1) || 1,
        resolution: res && res.length === 2 && res.every((n) => n > 0) ? { width: res[0], height: res[1] } : undefined,
        active: s.values.ACTIVE?.trim(),
        acdg,
        hints: script && scriptExists && !acdg ? scriptHints(script) : { images: [], fonts: [] },
      });
    }
    if (followIncludes) for (const inc of resolveIncludes(file, sections)) scanIni(inc, includedInExtConfig, true);
  };

  if (hasExtConfig) scanIni(extConfig, true, true);
  // otros .ini de la carpeta extension que definen displays pero no están incluidos
  for (const ini of listFiles(extDir, '.ini', 1)) scanIni(ini, false, false);

  const luaFiles = listFiles(extDir, '.lua', 2).map((f) => relative(extDir, f).replace(/\\/g, '/'));
  const iniFiles = listFiles(extDir, '.ini', 1).map((f) => relative(extDir, f).replace(/\\/g, '/'));
  const referenced = new Set(displays.map((d) => d.script?.toLowerCase()));
  const orphanLua = listFiles(extDir, '.lua', 1)
    .filter((f) => !referenced.has(f.toLowerCase()) && !f.toLowerCase().includes(`${join('extension', 'acdg')}`.toLowerCase()))
    .map((f) => ({ file: f, relative: relative(extDir, f).replace(/\\/g, '/'), hints: scriptHints(f), valid: !validateLua(readFileSync(f, 'utf8'), basename(f)) }));

  return { extDir, hasExtConfig, displays, luaFiles, iniFiles, orphanLua };
}

/** Imágenes de la carpeta extension con aspecto de textura de display (para sugerir fondo). */
export function candidateImages(carPath: string): string[] {
  const extDir = join(carPath, 'extension');
  return [...listFiles(extDir, '.dds', 2), ...listFiles(extDir, '.png', 2)].filter((f) => !f.toLowerCase().includes(`${join('extension', 'acdg')}`.toLowerCase()) && extname(f));
}
