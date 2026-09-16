import { create } from 'zustand';
import type { DisplayElement, ElementType, Project } from '@shared/model';
import { createElement, newId } from '@shared/model';
import type { DisplayProfile } from '@shared/profile';
import type { AppInfo, BuiltinIcon, CarInfo } from '@shared/types';
import { VARIABLES } from '@shared/variables';

export type Screen = 'start' | 'wizard' | 'editor';

export type SimValues = Record<string, number | boolean>;

export interface Toast {
  text: string;
  kind: 'info' | 'err';
}

interface State {
  info: AppInfo | null;
  screen: Screen;
  car: CarInfo | null;
  profile: DisplayProfile | null;
  profileFile: string | null;
  project: Project | null;
  projectFile: string | null;
  dirty: boolean;
  assets: Record<string, string>;
  icons: BuiltinIcon[];
  fonts: string[];
  selection: string[];
  past: Project[];
  future: Project[];
  sim: SimValues;
  simAuto: boolean;
  ambient: number;
  showPreview: boolean;
  previewMode: boolean;
  physicalView: boolean;
  toast: Toast | null;
  zoom: number;
  pan: { x: number; y: number };
  hoverPos: { x: number; y: number } | null;

  setInfo(info: AppInfo): void;
  setScreen(s: Screen): void;
  setCar(car: CarInfo | null): void;
  setProfile(p: DisplayProfile | null, file: string | null): void;
  setAssets(a: Record<string, string>): void;
  addAssetUrl(path: string, url: string): void;
  setIcons(i: BuiltinIcon[]): void;
  setFonts(f: string[]): void;
  loadProject(p: Project, file: string | null): void;
  closeProject(): void;
  /** aplica un cambio al proyecto; commit=true guarda en el historial */
  patchProject(fn: (p: Project) => void, commit?: boolean): void;
  /** guarda el estado actual en el historial (antes de una transformación transitoria) */
  snapshot(): void;
  undo(): void;
  redo(): void;
  select(ids: string[], additive?: boolean): void;
  updateElement(id: string, patch: Partial<DisplayElement> | ((el: DisplayElement) => void), commit?: boolean): void;
  addElement(type: ElementType): void;
  removeSelected(): void;
  duplicateSelected(): void;
  reorder(id: string, dir: 'up' | 'down' | 'top' | 'bottom'): void;
  moveSelected(dx: number, dy: number): void;
  setSim(id: string, v: number | boolean): void;
  resetSim(): void;
  setSimAuto(v: boolean): void;
  setAmbient(v: number): void;
  togglePreview(): void;
  setPreviewMode(v: boolean): void;
  setPhysicalView(v: boolean): void;
  setToast(t: Toast | null): void;
  setZoom(z: number): void;
  setPan(p: { x: number; y: number }): void;
  setHoverPos(p: { x: number; y: number } | null): void;
  markSaved(file: string): void;
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const MAX_HISTORY = 100;

export function defaultSim(): SimValues {
  const s: SimValues = {};
  for (const v of VARIABLES) if (typeof v.preview !== 'string') s[v.id] = v.preview;
  return s;
}

export const useStore = create<State>((set, get) => ({
  info: null,
  screen: 'start',
  car: null,
  profile: null,
  profileFile: null,
  project: null,
  projectFile: null,
  dirty: false,
  assets: {},
  icons: [],
  fonts: [],
  selection: [],
  past: [],
  future: [],
  sim: defaultSim(),
  simAuto: false,
  ambient: 1,
  showPreview: true,
  previewMode: false,
  physicalView: false,
  toast: null,
  zoom: 0.5,
  pan: { x: 0, y: 0 },
  hoverPos: null,

  setInfo: (info) => set({ info }),
  setScreen: (screen) => set({ screen }),
  setCar: (car) => set({ car }),
  setProfile: (profile, profileFile) => set({ profile, profileFile }),
  setAssets: (assets) => set({ assets }),
  addAssetUrl: (path, url) => set((s) => ({ assets: { ...s.assets, [path]: url } })),
  setIcons: (icons) => set({ icons }),
  setFonts: (fonts) => set({ fonts }),
  loadProject: (project, projectFile) => set({ project, projectFile, dirty: false, past: [], future: [], selection: [], screen: 'editor' }),
  closeProject: () => set({ project: null, projectFile: null, dirty: false, past: [], future: [], selection: [], assets: {}, screen: 'start' }),

  patchProject: (fn, commit = true) =>
    set((s) => {
      if (!s.project) return {};
      const next = clone(s.project);
      fn(next);
      const past = commit ? [...s.past.slice(-MAX_HISTORY + 1), s.project] : s.past;
      return { project: next, past, future: commit ? [] : s.future, dirty: true };
    }),
  snapshot: () =>
    set((s) => (s.project ? { past: [...s.past.slice(-MAX_HISTORY + 1), clone(s.project)], future: [] } : {})),
  undo: () =>
    set((s) => {
      if (!s.project || s.past.length === 0) return {};
      const prev = s.past[s.past.length - 1];
      const ids = new Set(prev.pages.flatMap((p) => p.elements.map((e) => e.id)));
      return { project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], dirty: true, selection: s.selection.filter((id) => ids.has(id)) };
    }),
  redo: () =>
    set((s) => {
      if (!s.project || s.future.length === 0) return {};
      const next = s.future[0];
      const ids = new Set(next.pages.flatMap((p) => p.elements.map((e) => e.id)));
      return { project: next, past: [...s.past, s.project], future: s.future.slice(1), dirty: true, selection: s.selection.filter((id) => ids.has(id)) };
    }),

  select: (ids, additive = false) =>
    set((s) => {
      if (!additive) return { selection: ids };
      const cur = new Set(s.selection);
      for (const id of ids) cur.has(id) ? cur.delete(id) : cur.add(id);
      return { selection: [...cur] };
    }),

  updateElement: (id, patch, commit = true) =>
    get().patchProject((p) => {
      for (const page of p.pages) {
        const el = page.elements.find((e) => e.id === id);
        if (!el) continue;
        if (typeof patch === 'function') patch(el);
        else Object.assign(el, patch);
      }
    }, commit),

  addElement: (type) => {
    const s = get();
    if (!s.project) return;
    const cw = s.project.canvas.width;
    const ch = s.project.canvas.height;
    const el = createElement(type, 0, 0);
    el.x = Math.round(cw / 2 - el.width / 2);
    el.y = Math.round(ch / 2 - el.height / 2);
    if (type === 'rpm_bar') {
      el.width = Math.round(cw * 0.8);
      el.x = Math.round(cw * 0.1);
      el.y = Math.round(ch * 0.05);
    }
    // nombre único
    const names = new Set(s.project.pages[0].elements.map((e) => e.name));
    let n = 2;
    const base = el.name;
    while (names.has(el.name)) el.name = `${base} ${n++}`;
    s.patchProject((p) => p.pages[0].elements.push(el));
    set({ selection: [el.id] });
  },

  removeSelected: () => {
    const s = get();
    if (!s.project || s.selection.length === 0) return;
    const sel = new Set(s.selection);
    s.patchProject((p) => {
      for (const page of p.pages) page.elements = page.elements.filter((e) => !sel.has(e.id) || e.locked);
    });
    set({ selection: [] });
  },

  duplicateSelected: () => {
    const s = get();
    if (!s.project || s.selection.length === 0) return;
    const sel = new Set(s.selection);
    const newIds: string[] = [];
    s.patchProject((p) => {
      const page = p.pages[0];
      const copies: DisplayElement[] = [];
      for (const el of page.elements) {
        if (!sel.has(el.id)) continue;
        const c = clone(el);
        c.id = newId();
        c.name = `${el.name} copia`;
        c.x += 20;
        c.y += 20;
        c.rules = c.rules.map((r) => ({ ...r, id: newId('rule') }));
        copies.push(c);
        newIds.push(c.id);
      }
      page.elements.push(...copies);
    });
    set({ selection: newIds });
  },

  reorder: (id, dir) =>
    get().patchProject((p) => {
      const els = p.pages[0].elements;
      const i = els.findIndex((e) => e.id === id);
      if (i < 0) return;
      const [el] = els.splice(i, 1);
      const j = dir === 'up' ? Math.min(els.length, i + 1) : dir === 'down' ? Math.max(0, i - 1) : dir === 'top' ? els.length : 0;
      els.splice(j, 0, el);
    }),

  moveSelected: (dx, dy) => {
    const s = get();
    if (!s.project || s.selection.length === 0) return;
    const sel = new Set(s.selection);
    s.patchProject((p) => {
      for (const el of p.pages[0].elements) {
        if (sel.has(el.id) && !el.locked) {
          el.x = Math.round(el.x + dx);
          el.y = Math.round(el.y + dy);
        }
      }
    });
  },

  setSim: (id, v) => set((s) => ({ sim: { ...s.sim, [id]: v } })),
  resetSim: () => set({ sim: defaultSim() }),
  setSimAuto: (simAuto) => set({ simAuto }),
  setAmbient: (ambient) => set({ ambient }),
  togglePreview: () => set((s) => ({ showPreview: !s.showPreview })),
  setPreviewMode: (previewMode) => set({ previewMode, selection: previewMode ? [] : get().selection }),
  setPhysicalView: (physicalView) => set({ physicalView }),
  setToast: (toast) => set({ toast }),
  setZoom: (zoom) => set({ zoom }),
  setPan: (pan) => set({ pan }),
  setHoverPos: (hoverPos) => set({ hoverPos }),
  markSaved: (file) => set({ projectFile: file, dirty: false }),
}));

// acceso desde la consola de desarrollo / arnés de pruebas
(window as unknown as { acdgStore: typeof useStore }).acdgStore = useStore;

export function toast(text: string, kind: 'info' | 'err' = 'info'): void {
  useStore.getState().setToast({ text, kind });
  window.setTimeout(() => {
    if (useStore.getState().toast?.text === text) useStore.getState().setToast(null);
  }, kind === 'err' ? 6000 : 3000);
}

export function selectedElements(): DisplayElement[] {
  const s = useStore.getState();
  if (!s.project) return [];
  const sel = new Set(s.selection);
  return s.project.pages[0].elements.filter((e) => sel.has(e.id));
}
