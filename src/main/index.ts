import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';
import { registerIpc } from './ipc';
import { resourcesDir } from './services/resources';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#15171b',
    title: 'AC Display Generator',
    icon: join(resourcesDir(), 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.on('ready-to-show', () => win.show());
  if (process.env['ACDG_DEBUG']) attachDebugHarness(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

/**
 * Arnés de depuración (solo con ACDG_DEBUG=<carpeta>): vuelca la consola del renderer a stdout,
 * ejecuta el JS que encuentre en <carpeta>/cmd.js y guarda capturas en <carpeta>/shot.png.
 */
function attachDebugHarness(win: BrowserWindow): void {
  const dir = process.env['ACDG_DEBUG']!;
  const { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });
  // los diálogos nativos devuelven el contenido de <carpeta>/dialog.txt (una ruta o un índice) si existe
  const { dialog } = require('electron') as typeof import('electron');
  const scripted = (): string | null => {
    const f = join(dir, 'dialog.txt');
    if (!existsSync(f)) return null;
    const v = readFileSync(f, 'utf8').trim();
    unlinkSync(f);
    return v;
  };
  const origOpen = dialog.showOpenDialog.bind(dialog);
  const origSave = dialog.showSaveDialog.bind(dialog);
  const origMsg = dialog.showMessageBox.bind(dialog);
  dialog.showOpenDialog = ((...args: Parameters<typeof origOpen>) => {
    const v = scripted();
    return v !== null ? Promise.resolve({ canceled: false, filePaths: [v] }) : origOpen(...args);
  }) as typeof dialog.showOpenDialog;
  dialog.showSaveDialog = ((...args: Parameters<typeof origSave>) => {
    const v = scripted();
    return v !== null ? Promise.resolve({ canceled: false, filePath: v }) : origSave(...args);
  }) as typeof dialog.showSaveDialog;
  dialog.showMessageBox = ((...args: Parameters<typeof origMsg>) => {
    const v = scripted();
    return v !== null ? Promise.resolve({ response: Number(v), checkboxChecked: false }) : origMsg(...args);
  }) as typeof dialog.showMessageBox;
  setInterval(async () => {
    const cmd = join(dir, 'cmd.js');
    if (existsSync(cmd)) {
      const code = readFileSync(cmd, 'utf8');
      unlinkSync(cmd);
      try {
        const r = await win.webContents.executeJavaScript(code, true);
        writeFileSync(join(dir, 'cmd.out'), JSON.stringify(r ?? null, null, 2));
      } catch (e) {
        writeFileSync(join(dir, 'cmd.out'), `ERROR: ${(e as Error).message}`);
      }
    }
    const shot = join(dir, 'shot.request');
    if (existsSync(shot)) {
      unlinkSync(shot);
      win.webContents.invalidate();
      await new Promise((r) => setTimeout(r, 150));
      const img = await win.webContents.capturePage();
      writeFileSync(join(dir, 'shot.png'), img.toPNG());
    }
  }, 500);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
