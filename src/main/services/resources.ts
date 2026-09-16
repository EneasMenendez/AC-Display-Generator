import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/** Carpeta resources/ (runtime Lua, iconos, perfiles de ejemplo) tanto en desarrollo como empaquetada. */
export function resourcesDir(): string {
  const candidates = [join(process.resourcesPath ?? '', 'resources'), join(app.getAppPath(), 'resources'), join(process.cwd(), 'resources')];
  return candidates.find((c) => existsSync(join(c, 'runtime'))) ?? candidates[1];
}
