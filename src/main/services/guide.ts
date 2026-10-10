import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { resourcesDir } from './resources';

/**
 * Guía de usuario «¿Cómo funciona el programa?» (resources/docs/guia.pdf, generada con
 * `npm run guide`). Se abre en una ventana propia con el visor de PDF de Chromium, así no depende
 * de que haya un lector de PDF instalado; si ya está abierta, solo se trae al frente.
 */

let guide: BrowserWindow | null = null;

export function openGuide(parent: BrowserWindow | null): void {
  if (guide && !guide.isDestroyed()) {
    if (guide.isMinimized()) guide.restore();
    guide.focus();
    return;
  }
  const file = join(resourcesDir(), 'docs', 'guia.pdf');
  if (!existsSync(file)) throw new Error('No se encuentra la guía (resources/docs/guia.pdf).');
  const bounds = parent?.getBounds();
  guide = new BrowserWindow({
    width: 980,
    height: Math.min(1100, bounds ? bounds.height : 1000),
    minWidth: 600,
    minHeight: 500,
    title: '¿Cómo funciona el programa? — AC Display Generator',
    icon: join(resourcesDir(), 'icon.ico'),
    backgroundColor: '#2b2c30',
    autoHideMenuBar: true,
    // el visor de PDF integrado de Chromium es un plugin
    webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  guide.setMenu(null);
  // el título del PDF sustituiría al nuestro
  guide.on('page-title-updated', (e) => e.preventDefault());
  guide.on('closed', () => (guide = null));
  guide.loadFile(file);
}
