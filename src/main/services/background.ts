import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { app, nativeImage } from 'electron';
import type { BackgroundImage } from '@shared/types';

/**
 * Imagen de fondo de la aplicación. Se reescala y se reguarda como JPEG en los datos del programa
 * (así sigue ahí aunque el original se mueva, y no se arrastran 8 MB en cada arranque) y se entrega
 * al renderer en crudo: allí se convierte en un blob, porque un data URL de varios MB no cabe en una
 * variable CSS — el navegador lo descarta sin avisar.
 */

/** ancho máximo que se guarda: de sobra para pantallas 1440p y 4K escaladas */
const MAX_WIDTH = 2560;
const MAX_INPUT_MB = 40;
const FILE = 'background.jpg';

function file(): string {
  return join(app.getPath('userData'), FILE);
}

/** Imagen de fondo guardada (bytes listos para el renderer), o null. */
export function backgroundImage(): BackgroundImage | null {
  try {
    const f = file();
    if (!existsSync(f)) {
      // versiones anteriores guardaban el archivo original (PNG de varios MB): se reconvierte
      const old = previousFile();
      if (!old) return null;
      const converted = setBackground(old);
      rmSync(old, { force: true });
      return converted;
    }
    return { data: new Uint8Array(readFileSync(f)), mime: 'image/jpeg' };
  } catch {
    return null;
  }
}

/** Fondo guardado por una versión anterior, en su formato original. */
function previousFile(): string | null {
  try {
    const dir = app.getPath('userData');
    const hit = readdirSync(dir).find((f) => /^background\.(png|webp|bmp|jpeg)$/i.test(f));
    return hit ? join(dir, hit) : null;
  } catch {
    return null;
  }
}

/** Guarda una imagen como fondo (reescalada) y la devuelve. */
export function setBackground(source: string): BackgroundImage | null {
  if (!existsSync(source)) throw new Error('La imagen no existe.');
  if (!['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(extname(source).toLowerCase())) {
    throw new Error('Formato no admitido: usa JPG, PNG, WEBP o BMP.');
  }
  const mb = statSync(source).size / (1024 * 1024);
  if (mb > MAX_INPUT_MB) throw new Error(`La imagen ocupa ${mb.toFixed(1)} MB; usa una de menos de ${MAX_INPUT_MB} MB.`);

  let img = nativeImage.createFromPath(source);
  if (img.isEmpty()) throw new Error('No se pudo leer la imagen.');
  const size = img.getSize();
  if (size.width > MAX_WIDTH) img = img.resize({ width: MAX_WIDTH, quality: 'good' });
  writeFileSync(file(), img.toJPEG(88));
  // si quedaba un fondo de una versión anterior en otro formato, sobra
  const previous = previousFile();
  if (previous) rmSync(previous, { force: true });
  return { data: new Uint8Array(readFileSync(file())), mime: 'image/jpeg' };
}

/** Quita el fondo guardado (incluidos los formatos que guardaban versiones anteriores). */
export function clearBackground(): void {
  try {
    const dir = app.getPath('userData');
    for (const f of readdirSync(dir)) {
      if (/^background\.(jpg|jpeg|png|webp|bmp)$/i.test(f)) rmSync(join(dir, f), { force: true });
    }
  } catch {
    /* sin carpeta de datos todavía */
  }
}
