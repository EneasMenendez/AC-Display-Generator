import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { Project } from '@shared/model';
import type { DisplayProfile } from '@shared/profile';
import { detectAcRoots, detectCspVersion, findContentManager, isAcRoot } from './services/acLocator';
import { listCars, scanCar, findMeshConflicts } from './services/vehicleScanner';
import { readKn5 } from './services/kn5Reader';
import { scanExtension } from './services/displayScanner';
import { importLuaDisplay } from './services/luaImporter';
import { findProfiles, loadProfileManual, saveToCar, saveToLibrary } from './services/profileManager';
import { readImageInfo } from './services/imageManager';
import * as pm from './services/projectManager';
import * as inst from './services/installer';
import { loadSettings, saveSettings, type AppSettings } from './services/settings';
import { RUNTIME_VERSION } from '@shared/generator';
import { resourcesDir } from './services/resources';
import { readCspLog } from './services/cspLog';
import { backgroundUrl, clearBackground, setBackground } from './services/background';

const execFileAsync = promisify(execFile);

function win(): BrowserWindow {
  return BrowserWindow.getAllWindows()[0];
}


export function registerIpc(): void {
  // ---------- aplicación / ajustes ----------
  ipcMain.handle('app:info', async () => {
    const settings = loadSettings();
    const roots = await detectAcRoots();
    let acRoot = settings.acRoot && isAcRoot(settings.acRoot) ? settings.acRoot : roots[0] ?? null;
    if (acRoot !== settings.acRoot) saveSettings({ acRoot });
    return {
      version: app.getVersion(),
      runtimeVersion: RUNTIME_VERSION,
      acRoot,
      acRoots: roots,
      cspVersion: acRoot ? detectCspVersion(acRoot) : null,
      contentManager: findContentManager(acRoot),
      backgroundUrl: backgroundUrl(),
      settings: { ...settings, acRoot },
      projectsDir: pm.defaultProjectsDir(),
    };
  });
  ipcMain.handle('settings:save', (_e, patch: Partial<AppSettings>) => saveSettings(patch));
  ipcMain.handle('appearance:pickBackground', async () => {
    const r = await dialog.showOpenDialog(win(), {
      title: 'Imagen de fondo de la aplicación',
      filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return setBackground(r.filePaths[0]);
  });
  ipcMain.handle('appearance:clearBackground', () => clearBackground());
  ipcMain.handle('ac:pickRoot', async () => {
    const r = await dialog.showOpenDialog(win(), { title: 'Carpeta de Assetto Corsa', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    if (!isAcRoot(p)) return { error: 'La carpeta no contiene AssettoCorsa.exe y content/cars.' };
    saveSettings({ acRoot: p });
    return { acRoot: p };
  });

  // ---------- vehículos ----------
  ipcMain.handle('cars:list', (_e, acRoot: string) => listCars(acRoot));
  ipcMain.handle('car:pick', async () => {
    const r = await dialog.showOpenDialog(win(), { title: 'Carpeta del vehículo', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('car:scan', (_e, carPath: string) => scanCar(carPath));
  ipcMain.handle('car:scanDisplays', (_e, carPath: string) => scanExtension(carPath));
  ipcMain.handle('car:importLua', (_e, scriptFile: string, width: number, height: number) => importLuaDisplay(scriptFile, width, height));
  ipcMain.handle('car:kn5', (_e, carPath: string, file: string) => readKn5(join(carPath, file)));
  ipcMain.handle('car:meshConflicts', (_e, carPath: string, meshes: string[], displayId: string) => findMeshConflicts(carPath, meshes, displayId));
  ipcMain.handle('car:cleanDisplays', (_e, carPath: string, meshes: string[]) => inst.cleanDisplays(carPath, meshes));
  ipcMain.handle('needles:remove', (_e, carPath: string, target: inst.InstallTarget) => inst.removeNeedles(carPath, target));

  // ---------- perfiles ----------
  ipcMain.handle('profiles:find', (_e, carPath: string) => findProfiles(carPath));
  ipcMain.handle('profiles:pick', async () => {
    const r = await dialog.showOpenDialog(win(), { title: 'Seleccionar perfil', filters: [{ name: 'Perfil de display', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    return loadProfileManual(r.filePaths[0]);
  });
  ipcMain.handle('profiles:saveToCar', (_e, profile: DisplayProfile, carPath: string) => saveToCar(profile, carPath));
  ipcMain.handle('profiles:saveToLibrary', (_e, profile: DisplayProfile) => saveToLibrary(profile));
  ipcMain.handle('profiles:export', async (_e, profile: DisplayProfile) => {
    const r = await dialog.showSaveDialog(win(), { title: 'Exportar perfil', defaultPath: 'display_profile.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(r.filePath, JSON.stringify(profile, null, 2), 'utf8');
    return r.filePath;
  });

  // ---------- imágenes / assets ----------
  ipcMain.handle('image:pick', async () => {
    const r = await dialog.showOpenDialog(win(), {
      title: 'Imagen de fondo',
      filters: [{ name: 'Imágenes', extensions: ['png', 'dds', 'jpg', 'jpeg'] }],
      properties: ['openFile'],
    });
    if (r.canceled) return null;
    return readImageInfo(r.filePaths[0]);
  });
  ipcMain.handle('image:info', (_e, file: string) => readImageInfo(file));
  ipcMain.handle('asset:pick', async (_e, kind: 'icon' | 'font' | 'image' | 'video' | 'audio') => {
    const filters =
      kind === 'font'
        ? [{ name: 'Fuentes', extensions: ['ttf', 'otf'] }]
        : kind === 'video'
          ? [{ name: 'Vídeo (códecs de Windows)', extensions: ['mp4', 'webm', 'wmv', 'mov', 'avi'] }]
          : kind === 'audio'
            ? [{ name: 'Audio', extensions: ['mp3', 'wav', 'ogg'] }]
            : [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'dds'] }];
    const titles = { font: 'Importar fuente', video: 'Importar vídeo', audio: 'Importar sonido', image: 'Importar imagen', icon: 'Importar icono' };
    const r = await dialog.showOpenDialog(win(), { title: titles[kind], filters, properties: ['openFile'] });
    if (r.canceled) return null;
    const folder = kind === 'font' ? 'assets/fonts' : kind === 'icon' ? 'assets/icons' : 'assets';
    const added = pm.addAsset(r.filePaths[0], folder);
    if (kind === 'font') return { ...added, name: basename(r.filePaths[0]).replace(/\.[^.]+$/, '') };
    if (kind === 'image') {
      const info = readImageInfo(r.filePaths[0]);
      // para DDS el editor necesita un PNG decodificado
      return { ...added, dataUrl: info.dataUrl ?? added.dataUrl, width: info.width, height: info.height, hasAlpha: info.hasAlpha, format: info.format, error: info.error };
    }
    return added;
  });
  ipcMain.handle('asset:addFile', (_e, file: string, folder: 'assets' | 'assets/icons' | 'assets/fonts') => pm.addAsset(file, folder));
  ipcMain.handle('asset:addBytes', (_e, path: string, bytes: Uint8Array) => pm.addAssetBytes(path, new Uint8Array(bytes)));
  ipcMain.handle('asset:all', () => pm.assetDataUrls());
  ipcMain.handle('icons:list', () => {
    const dir = join(resourcesDir(), 'icons');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => ({ id: f.replace(/\.svg$/, ''), svg: readFileSync(join(dir, f), 'utf8') }));
  });
  ipcMain.handle('fonts:list', async () => {
    const names = new Set<string>(['Segoe UI', 'Arial', 'Consolas', 'Impact', 'Verdana', 'Tahoma', 'Calibri', 'Bahnschrift']);
    try {
      const { stdout } = await execFileAsync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts']);
      for (const line of stdout.split(/\r?\n/)) {
        const m = /^\s+(.+?) \((TrueType|OpenType)\)\s+REG_SZ/.exec(line);
        if (m) names.add(m[1].replace(/ (Bold|Italic|Bold Italic|Light|Semibold|Black|Semilight)$/i, ''));
      }
    } catch {
      /* sin registro: lista básica */
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  });

  // ---------- proyectos ----------
  ipcMain.handle('project:new', () => pm.newSession());
  ipcMain.handle('project:recent', () => pm.listRecent());
  ipcMain.handle('project:open', async (_e, file?: string) => {
    let f = file;
    if (!f) {
      const r = await dialog.showOpenDialog(win(), {
        title: 'Abrir proyecto',
        defaultPath: pm.defaultProjectsDir(),
        filters: [{ name: 'Proyecto AC Display', extensions: ['acdisplay'] }],
        properties: ['openFile'],
      });
      if (r.canceled) return null;
      f = r.filePaths[0];
    }
    return { ...pm.openProject(f), file: f };
  });
  ipcMain.handle('project:save', async (_e, project: Project, thumbnail: Uint8Array | null, forceDialog: boolean) => {
    let f = pm.session.file;
    if (!f || forceDialog) {
      const r = await dialog.showSaveDialog(win(), {
        title: 'Guardar proyecto',
        defaultPath: join(pm.defaultProjectsDir(), `${project.name.replace(/[^A-Za-z0-9_ -]+/g, '_') || 'display'}.acdisplay`),
        filters: [{ name: 'Proyecto AC Display', extensions: ['acdisplay'] }],
      });
      if (r.canceled || !r.filePath) return null;
      f = r.filePath;
    }
    pm.saveProject(f, project, thumbnail ? new Uint8Array(thumbnail) : undefined);
    return f;
  });
  ipcMain.handle('project:currentFile', () => pm.session.file);
  ipcMain.handle('project:pruneAssets', (_e, used: string[]) => pm.removeUnusedAssets(new Set(used)));

  // ---------- instalación ----------
  ipcMain.handle('install:run', (_e, opts: Omit<inst.InstallOptions, 'extraFiles'> & { extraFiles: Record<string, Uint8Array> }) => {
    const extra: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(opts.extraFiles)) extra[k] = new Uint8Array(v);
    return inst.install({ ...opts, extraFiles: extra });
  });
  ipcMain.handle('install:pickExportDir', async () => {
    const r = await dialog.showOpenDialog(win(), { title: 'Carpeta de exportación', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('install:backups', (_e, carPath: string, target: inst.InstallTarget) => inst.listBackups(carPath, target));
  ipcMain.handle('install:restore', (_e, carPath: string, target: inst.InstallTarget, id: string) => inst.restoreBackup(carPath, target, id));
  ipcMain.handle('install:uninstall', (_e, carPath: string, target: inst.InstallTarget, displayId: string) => inst.uninstall(carPath, target, displayId));
  ipcMain.handle('install:installedProject', (_e, carPath: string, target: inst.InstallTarget, displayId: string) => inst.installedProjectFile(carPath, target, displayId));

  // ---------- shell ----------
  ipcMain.handle('shell:openPath', (_e, p: string) => shell.openPath(p));
  ipcMain.handle('csp:log', (_e, carId: string) => readCspLog(carId));
  ipcMain.handle('shell:launchCM', async (_e, cmPath: string) => {
    // TODO(v1.2): lanzar directamente una sesión con el coche mediante el esquema acmanager://
    try {
      const child = execFile(cmPath, [], () => undefined);
      child.unref();
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('dialog:confirm', async (_e, message: string, detail: string, buttons: string[]) => {
    const r = await dialog.showMessageBox(win(), { type: 'question', message, detail, buttons, cancelId: buttons.length - 1, defaultId: 0 });
    return r.response;
  });
}
