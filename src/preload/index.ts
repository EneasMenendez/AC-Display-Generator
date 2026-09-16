import { contextBridge, ipcRenderer } from 'electron';

/** Puente tipado renderer ↔ main. Cada método corresponde a un canal registrado en src/main/ipc.ts. */
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

export const api = {
  appInfo: () => invoke('app:info'),
  saveSettings: (patch: Record<string, unknown>) => invoke('settings:save', patch),
  pickAcRoot: () => invoke('ac:pickRoot'),

  listCars: (acRoot: string) => invoke('cars:list', acRoot),
  pickCar: () => invoke('car:pick'),
  scanCar: (carPath: string) => invoke('car:scan', carPath),
  scanDisplays: (carPath: string) => invoke('car:scanDisplays', carPath),
  importLua: (scriptFile: string, width: number, height: number) => invoke('car:importLua', scriptFile, width, height),
  readKn5: (carPath: string, file: string) => invoke('car:kn5', carPath, file),
  meshConflicts: (carPath: string, meshes: string[], displayId: string) => invoke('car:meshConflicts', carPath, meshes, displayId),

  findProfiles: (carPath: string) => invoke('profiles:find', carPath),
  pickProfile: () => invoke('profiles:pick'),
  saveProfileToCar: (profile: unknown, carPath: string) => invoke('profiles:saveToCar', profile, carPath),
  saveProfileToLibrary: (profile: unknown) => invoke('profiles:saveToLibrary', profile),
  exportProfile: (profile: unknown) => invoke('profiles:export', profile),

  pickImage: () => invoke('image:pick'),
  imageInfo: (file: string) => invoke('image:info', file),
  pickAsset: (kind: 'icon' | 'font' | 'image') => invoke('asset:pick', kind),
  addAssetFile: (file: string, folder: string) => invoke('asset:addFile', file, folder),
  addAssetBytes: (path: string, bytes: Uint8Array) => invoke('asset:addBytes', path, bytes),
  allAssets: () => invoke('asset:all'),
  listIcons: () => invoke('icons:list'),
  listFonts: () => invoke('fonts:list'),

  newProject: () => invoke('project:new'),
  recentProjects: () => invoke('project:recent'),
  openProject: (file?: string) => invoke('project:open', file),
  saveProject: (project: unknown, thumbnail: Uint8Array | null, forceDialog: boolean) => invoke('project:save', project, thumbnail, forceDialog),
  currentProjectFile: () => invoke('project:currentFile'),
  pruneAssets: (used: string[]) => invoke('project:pruneAssets', used),

  install: (opts: unknown) => invoke('install:run', opts),
  pickExportDir: () => invoke('install:pickExportDir'),
  listBackups: (carPath: string, target: unknown) => invoke('install:backups', carPath, target),
  restoreBackup: (carPath: string, target: unknown, id: string) => invoke('install:restore', carPath, target, id),
  uninstall: (carPath: string, target: unknown, displayId: string) => invoke('install:uninstall', carPath, target, displayId),
  installedProject: (carPath: string, target: unknown, displayId: string) => invoke('install:installedProject', carPath, target, displayId),

  openPath: (p: string) => invoke('shell:openPath', p),
  cspLog: (carId: string) => invoke('csp:log', carId),
  launchCM: (cmPath: string) => invoke('shell:launchCM', cmPath),
  confirm: (message: string, detail: string, buttons: string[]) => invoke('dialog:confirm', message, detail, buttons),
};

contextBridge.exposeInMainWorld('acdg', api);
