import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { app } from 'electron';

/**
 * Imagen de fondo de la aplicación. Se copia a los datos del programa para que siga ahí aunque el
 * original se mueva, y se entrega al renderer como data URL (igual que el resto de recursos).
 */

const EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];

function dir(): string {
  return app.getPath('userData');
}

/** Archivo de fondo guardado, o null. */
export function backgroundFile(): string | null {
  try {
    const hit = readdirSync(dir()).find((f) => f.startsWith('background.') && EXTS.includes(extname(f).toLowerCase()));
    return hit ? join(dir(), hit) : null;
  } catch {
    return null;
  }
}

/** Fondo guardado como data URL para el renderer (null si no hay o no se puede leer). */
export function backgroundUrl(): string | null {
  const f = backgroundFile();
  if (!f) return null;
  try {
    const ext = extname(f).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.bmp' ? 'image/bmp' : 'image/jpeg';
    return `data:${mime};base64,${readFileSync(f).toString('base64')}`;
  } catch {
    return null;
  }
}

/** Guarda una imagen como fondo (sustituye la anterior) y devuelve su data URL. */
export function setBackground(file: string): string | null {
  const ext = extname(file).toLowerCase();
  if (!EXTS.includes(ext)) throw new Error('Formato no admitido: usa JPG, PNG, WEBP o BMP.');
  if (!existsSync(file)) throw new Error('La imagen no existe.');
  // la imagen viaja al renderer como data URL en cada arranque: con uno o dos MB sobra
  const mb = statSync(file).size / (1024 * 1024);
  if (mb > 12) throw new Error(`La imagen ocupa ${mb.toFixed(1)} MB; usa uno de menos de 12 MB (basta con la resolución de tu pantalla).`);
  clearBackground();
  copyFileSync(file, join(dir(), `background${ext}`));
  return backgroundUrl();
}

/** Quita el fondo guardado. */
export function clearBackground(): void {
  try {
    for (const f of readdirSync(dir())) {
      if (f.startsWith('background.') && EXTS.includes(extname(f).toLowerCase())) rmSync(join(dir(), f), { force: true });
    }
  } catch {
    /* sin carpeta de datos todavía */
  }
}
