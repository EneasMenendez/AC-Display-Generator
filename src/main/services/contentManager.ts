import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Ajustes de apariencia de Content Manager.
 *
 * CM guarda sus preferencias en `Values.data`: un primer byte de formato y, a continuación, el
 * contenido comprimido con LZF (literales con longitud y referencias hacia atrás). Al descomprimirlo
 * salen líneas `clave<TAB>valor`, entre ellas el color de acento si el usuario lo ha cambiado
 * (`AppAppearanceManager.AccentColor`, en formato WPF #AARRGGBB).
 *
 * Es un formato interno de CM, no una API: todo va entre comprobaciones y, si algo no cuadra, se
 * devuelve null y la aplicación usa su propio acento.
 */

/** Descompresión LZF (la que usa CM para Values.data). */
function lzfDecompress(data: Buffer): Buffer {
  const out: number[] = [];
  let ip = 0;
  while (ip < data.length) {
    const ctrl = data[ip++];
    if (ctrl < 32) {
      // tirada de literales: ctrl + 1 bytes tal cual
      const end = ip + ctrl + 1;
      if (end > data.length) throw new Error('literales fuera del archivo');
      for (; ip < end; ip++) out.push(data[ip]);
    } else {
      // referencia hacia atrás
      let length = ctrl >> 5;
      if (length === 7) {
        if (ip >= data.length) throw new Error('longitud incompleta');
        length += data[ip++];
      }
      if (ip >= data.length) throw new Error('referencia incompleta');
      let ref = out.length - ((ctrl & 0x1f) << 8) - data[ip++] - 1;
      if (ref < 0) throw new Error('referencia fuera de rango');
      for (let i = 0; i < length + 2; i++) out.push(out[ref++]);
    }
    if (out.length > 8 * 1024 * 1024) throw new Error('archivo demasiado grande');
  }
  return Buffer.from(out);
}

/** Rutas donde puede estar Values.data (instalación normal y portable junto al ejecutable). */
function candidates(cmExe: string | null): string[] {
  const list: string[] = [];
  const local = process.env.LOCALAPPDATA;
  const roaming = process.env.APPDATA;
  if (local) list.push(join(local, 'AcTools Content Manager', 'Values.data'));
  if (roaming) list.push(join(roaming, 'AcTools Content Manager', 'Values.data'));
  if (cmExe) list.push(join(dirname(cmExe), 'Values.data'));
  return list;
}

/** Pares clave → valor de Content Manager (vacío si no se puede leer). */
function readValues(cmExe: string | null): Map<string, string> {
  const out = new Map<string, string>();
  const file = candidates(cmExe).find((f) => existsSync(f));
  if (!file) return out;
  try {
    const raw = readFileSync(file);
    if (raw.length < 2) return out;
    const text = lzfDecompress(raw.subarray(1)).toString('utf8');
    for (const line of text.split('\n')) {
      const tab = line.indexOf('\t');
      if (tab > 0) out.set(line.slice(0, tab), line.slice(tab + 1));
    }
  } catch {
    // formato distinto (otra versión de CM): se ignora, la aplicación usa su propio acento
  }
  return out;
}

/** #AARRGGBB (WPF) o #RRGGBB → #RRGGBB, o null si no es un color. */
function toHex(value: string): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!m) return null;
  const v = m[1];
  return `#${(v.length === 8 ? v.slice(2) : v).toUpperCase()}`;
}

/**
 * Color de acento configurado en Content Manager, o null si no hay ninguno (CM usa el suyo por
 * defecto, no lo guarda) o si no se pudo leer el archivo.
 */
export function readCmAccent(cmExe: string | null = null): string | null {
  for (const [key, value] of readValues(cmExe)) {
    if (!/accent/i.test(key)) continue;
    const hex = toHex(value);
    if (hex) return hex;
  }
  return null;
}
