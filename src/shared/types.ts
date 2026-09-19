import type { Project } from './model';
import type { DisplayProfile } from './profile';

/** Tipos compartidos entre el proceso principal (servicios) y el renderer (API window.acdg). */

export interface AppSettings {
  acRoot: string | null;
  lastCar: string | null;
  language: 'es' | 'en';
  convertToDds: boolean;
  theme: 'dark' | 'light';
}

export interface AppInfo {
  version: string;
  runtimeVersion: string;
  acRoot: string | null;
  acRoots: string[];
  cspVersion: string | null;
  contentManager: string | null;
  settings: AppSettings;
  projectsDir: string;
}

export interface CarSummary {
  id: string;
  path: string;
  name: string;
  brand: string;
  badge: string | null;
  hasProfile: boolean;
  hasAcdg: boolean;
}

export interface CarInfo extends CarSummary {
  valid: boolean;
  problems: string[];
  hasDataFolder: boolean;
  hasDataAcd: boolean;
  kn5Files: string[];
  mainKn5: string | null;
  hasExtension: boolean;
  hasExtConfig: boolean;
  skins: { id: string; hasExtConfig: boolean }[];
  installedDisplays: string[];
  scriptableDisplays: string[];
}

/** Display detectado en <coche>/extension (sección [SCRIPTABLE_DISPLAY...] en ext_config.ini, un include u otro .ini). */
export interface DetectedDisplay {
  section: string;
  iniFile: string;
  iniRelative: string;
  /** true si la sección se carga desde ext_config.ini (directa o por INCLUDE) */
  includedInExtConfig: boolean;
  meshes: string[];
  script: string | null;
  scriptRelative: string | null;
  scriptExists: boolean;
  scriptValid: boolean | null;
  scriptError?: string;
  keepBackground: boolean;
  skipFrames: number;
  resolution?: { width: number; height: number };
  active?: string;
  /** display generado por esta aplicación: carpeta y proyecto reutilizable */
  acdg: { displayId: string; projectFile: string | null; folder: string } | null;
  /** pistas extraídas de un script hecho a mano para importarlo */
  hints: { width?: number; height?: number; images: string[]; fonts: string[] };
}

export interface ExtensionScan {
  extDir: string;
  hasExtConfig: boolean;
  displays: DetectedDisplay[];
  luaFiles: string[];
  iniFiles: string[];
  /** scripts Lua de extension/ no referenciados por ningún display */
  orphanLua: { file: string; relative: string; valid: boolean; hints: DetectedDisplay['hints'] }[];
}

/** Resultado de importar un script Lua hecho a mano como elementos del editor. */
export interface LuaImportResult {
  elements: import('./model').DisplayElement[];
  /** imagen que el script dibuja a pantalla completa (fondo), ruta absoluta */
  background: string | null;
  warnings: string[];
  /** llamadas de dibujo registradas en la ejecución base */
  calls: number;
}

export interface Kn5Mesh {
  name: string;
  material: string;
  vertices: number;
  path: string;
}

export interface Kn5Material {
  name: string;
  shader: string;
  textures: { slot: string; texture: string }[];
}

export interface Kn5Info {
  version: number;
  textures: string[];
  /** resolución de las texturas DDS embebidas */
  textureSizes: Record<string, { width: number; height: number }>;
  materials: Kn5Material[];
  meshes: Kn5Mesh[];
}

export interface ProfileHit {
  profile: DisplayProfile;
  file: string;
  source: 'car' | 'library' | 'bundled' | 'manual';
}

export interface ProfileSearchResult {
  hits: ProfileHit[];
  errors: { file: string; errors: string[] }[];
}

export interface ImageInfo {
  file: string;
  format: 'png' | 'jpg' | 'dds' | 'unknown';
  width: number;
  height: number;
  hasAlpha: boolean;
  ddsFormat?: string;
  dataUrl: string | null;
  error?: string;
}

export interface AddedAsset {
  path: string;
  dataUrl: string;
  name?: string;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  format?: string;
  error?: string;
}

export interface RecentEntry {
  file: string;
  name: string;
  openedAt: string;
}

export type InstallTarget = { kind: 'car' } | { kind: 'skin'; skin: string };

export interface InstallOptions {
  carPath: string;
  target: InstallTarget;
  project: Project;
  profile: DisplayProfile;
  extraFiles: Record<string, Uint8Array>;
  convertToDds: boolean;
  install: boolean;
  exportDir?: string;
  /** secciones [SCRIPTABLE_DISPLAY...] ajenas a desactivar (comentar) porque usan la misma malla */
  disableSections?: { iniFile: string; section: string }[];
  /** guardar el perfil en <coche>/extension/display_profile.json si no existe */
  writeProfile?: boolean;
  /** displays del proyecto a generar (por defecto todos) */
  displayIds?: string[];
}

export interface InstallStep {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface InstallResult {
  ok: boolean;
  steps: InstallStep[];
  /** carpeta donde se escribió todo (extension/, skins/<skin>/ o la de exportación) */
  folder: string;
  /** archivos escritos (rutas absolutas) */
  files: string[];
  warnings: string[];
  errors: string[];
}

export interface BackupEntry {
  id: string;
  path: string;
  date: string;
  hasExtConfig: boolean;
  displays: string[];
}

export interface CspLogReport {
  file: string;
  exists: boolean;
  modified: string | null;
  /** fecha/hora del arranque del juego según la primera línea del log */
  started: string | null;
  /** el coche cargó su configuración en esa sesión */
  carLoaded: boolean;
  acdgLines: string[];
  errorLines: string[];
  luaLines: string[];
}

export interface BuiltinIcon {
  id: string;
  svg: string;
}

/** API expuesta por el preload en window.acdg */
export interface AcdgApi {
  appInfo(): Promise<AppInfo>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  pickAcRoot(): Promise<{ acRoot?: string; error?: string } | null>;

  listCars(acRoot: string): Promise<CarSummary[]>;
  pickCar(): Promise<string | null>;
  scanCar(carPath: string): Promise<CarInfo>;
  scanDisplays(carPath: string): Promise<ExtensionScan>;
  importLua(scriptFile: string, width: number, height: number): Promise<LuaImportResult>;
  readKn5(carPath: string, file: string): Promise<Kn5Info>;
  meshConflicts(carPath: string, meshes: string[], displayId: string): Promise<string[]>;

  findProfiles(carPath: string): Promise<ProfileSearchResult>;
  pickProfile(): Promise<ProfileHit | { errors: string[] } | null>;
  saveProfileToCar(profile: DisplayProfile, carPath: string): Promise<string>;
  saveProfileToLibrary(profile: DisplayProfile): Promise<string>;
  exportProfile(profile: DisplayProfile): Promise<string | null>;

  pickImage(): Promise<ImageInfo | null>;
  imageInfo(file: string): Promise<ImageInfo>;
  pickAsset(kind: 'icon' | 'font' | 'image'): Promise<AddedAsset | null>;
  addAssetFile(file: string, folder: string): Promise<AddedAsset>;
  addAssetBytes(path: string, bytes: Uint8Array): Promise<void>;
  allAssets(): Promise<Record<string, string>>;
  listIcons(): Promise<BuiltinIcon[]>;
  listFonts(): Promise<string[]>;

  newProject(): Promise<void>;
  recentProjects(): Promise<RecentEntry[]>;
  openProject(file?: string): Promise<{ project: Project; assets: Record<string, string>; file: string } | null>;
  saveProject(project: Project, thumbnail: Uint8Array | null, forceDialog: boolean): Promise<string | null>;
  currentProjectFile(): Promise<string | null>;
  pruneAssets(used: string[]): Promise<void>;

  install(opts: InstallOptions): Promise<InstallResult>;
  pickExportDir(): Promise<string | null>;
  listBackups(carPath: string, target: InstallTarget): Promise<BackupEntry[]>;
  restoreBackup(carPath: string, target: InstallTarget, id: string): Promise<string[]>;
  uninstall(carPath: string, target: InstallTarget, displayId: string): Promise<string[]>;
  installedProject(carPath: string, target: InstallTarget, displayId: string): Promise<string | null>;

  openPath(p: string): Promise<string>;
  cspLog(carId: string): Promise<CspLogReport>;
  launchCM(cmPath: string): Promise<boolean>;
  confirm(message: string, detail: string, buttons: string[]): Promise<number>;
}
