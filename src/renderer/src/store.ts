import { create } from 'zustand';
import type { DisplayElement, DisplayProject, ElementType, Page, Project } from '@shared/model';
import { createElement, createPage, newId } from '@shared/model';
import type { DisplayProfile } from '@shared/profile';
import { uvRegionPx } from '@shared/uv';
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
  /** display y página que se están editando */
  activeDisplay: number;
  activePage: number;
  sim: SimValues;
  simAuto: boolean;
  ambient: number;
  showPreview: boolean;
  previewMode: boolean;
  physicalView: boolean;
  /** en previsualización, seguir las condiciones automáticas de página (como en el juego) */
  followPageRules: boolean;
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
  loadProject(p: Project, file: string | null, activeDisplay?: number): void;
  closeProject(): void;
  /** aplica un cambio al proyecto; commit=true guarda en el historial */
  patchProject(fn: (p: Project) => void, commit?: boolean): void;
  /** aplica un cambio al display activo */
  patchDisplay(fn: (d: DisplayProject, p: Project) => void, commit?: boolean): void;
  /** aplica un cambio a la página activa */
  patchPage(fn: (page: Page, d: DisplayProject) => void, commit?: boolean): void;
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
  setActiveDisplay(i: number): void;
  setActivePage(i: number): void;
  addPage(name?: string): void;
  removePage(i: number): void;
  movePage(from: number, to: number): void;
  addDisplay(d: DisplayProject): void;
  removeDisplay(i: number): void;
  setSim(id: string, v: number | boolean): void;
  resetSim(): void;
  setSimAuto(v: boolean): void;
  setAmbient(v: number): void;
  togglePreview(): void;
  setPreviewMode(v: boolean): void;
  setPhysicalView(v: boolean): void;
  setFollowPageRules(v: boolean): void;
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

/** Display activo del proyecto (o null). */
export function activeDisplayOf(s: { project: Project | null; activeDisplay: number }): DisplayProject | null {
  if (!s.project) return null;
  return s.project.displays[Math.min(s.activeDisplay, s.project.displays.length - 1)] ?? null;
}

/** Página activa del display activo (o null). */
export function activePageOf(s: { project: Project | null; activeDisplay: number; activePage: number }): Page | null {
  const d = activeDisplayOf(s);
  if (!d) return null;
  return d.pages[Math.min(s.activePage, d.pages.length - 1)] ?? null;
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
  activeDisplay: 0,
  activePage: 0,
  sim: defaultSim(),
  simAuto: false,
  ambient: 1,
  showPreview: true,
  previewMode: false,
  physicalView: false,
  followPageRules: false,
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
  loadProject: (project, projectFile, activeDisplay = 0) =>
    set({ project, projectFile, dirty: false, past: [], future: [], selection: [], screen: 'editor', activeDisplay, activePage: 0 }),
  closeProject: () => set({ project: null, projectFile: null, dirty: false, past: [], future: [], selection: [], assets: {}, screen: 'start', activeDisplay: 0, activePage: 0 }),

  patchProject: (fn, commit = true) =>
    set((s) => {
      if (!s.project) return {};
      const next = clone(s.project);
      fn(next);
      const past = commit ? [...s.past.slice(-MAX_HISTORY + 1), s.project] : s.past;
      return { project: next, past, future: commit ? [] : s.future, dirty: true };
    }),
  patchDisplay: (fn, commit = true) =>
    get().patchProject((p) => {
      const d = p.displays[Math.min(get().activeDisplay, p.displays.length - 1)];
      if (d) fn(d, p);
    }, commit),
  patchPage: (fn, commit = true) =>
    get().patchDisplay((d) => {
      const page = d.pages[Math.min(get().activePage, d.pages.length - 1)];
      if (page) fn(page, d);
    }, commit),
  snapshot: () =>
    set((s) => (s.project ? { past: [...s.past.slice(-MAX_HISTORY + 1), clone(s.project)], future: [] } : {})),
  undo: () =>
    set((s) => {
      if (!s.project || s.past.length === 0) return {};
      const prev = s.past[s.past.length - 1];
      const ids = new Set(prev.displays.flatMap((d) => d.pages.flatMap((p) => p.elements.map((e) => e.id))));
      return {
        project: prev,
        past: s.past.slice(0, -1),
        future: [s.project, ...s.future],
        dirty: true,
        selection: s.selection.filter((id) => ids.has(id)),
        activeDisplay: Math.min(s.activeDisplay, prev.displays.length - 1),
        activePage: Math.min(s.activePage, (prev.displays[Math.min(s.activeDisplay, prev.displays.length - 1)]?.pages.length ?? 1) - 1),
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.project || s.future.length === 0) return {};
      const next = s.future[0];
      const ids = new Set(next.displays.flatMap((d) => d.pages.flatMap((p) => p.elements.map((e) => e.id))));
      return {
        project: next,
        past: [...s.past, s.project],
        future: s.future.slice(1),
        dirty: true,
        selection: s.selection.filter((id) => ids.has(id)),
        activeDisplay: Math.min(s.activeDisplay, next.displays.length - 1),
        activePage: Math.min(s.activePage, (next.displays[Math.min(s.activeDisplay, next.displays.length - 1)]?.pages.length ?? 1) - 1),
      };
    }),

  select: (ids, additive = false) =>
    set((s) => {
      if (!additive) return { selection: ids };
      const cur = new Set(s.selection);
      for (const id of ids) cur.has(id) ? cur.delete(id) : cur.add(id);
      return { selection: [...cur] };
    }),

  updateElement: (id, patch, commit = true) =>
    get().patchPage((page) => {
      const el = page.elements.find((e) => e.id === id);
      if (!el) return;
      if (typeof patch === 'function') patch(el);
      else Object.assign(el, patch);
    }, commit),

  addElement: (type) => {
    const s = get();
    const d = activeDisplayOf(s);
    const page = activePageOf(s);
    if (!d || !page) return;
    // los elementos nuevos se colocan dentro del área visible de la malla (si no es toda la textura)
    const def = s.profile?.displays.find((x) => x.id === d.display_id);
    const area = def ? uvRegionPx({ uv_region: def.uv_region, texture_size: d.canvas }) : { x: 0, y: 0, width: d.canvas.width, height: d.canvas.height };
    const cw = area.width;
    const ch = area.height;
    const el = createElement(type, 0, 0);
    el.x = Math.round(cw / 2 - el.width / 2);
    el.y = Math.round(ch / 2 - el.height / 2);
    if (type === 'rpm_bar') {
      el.width = Math.round(cw * 0.8);
      el.x = Math.round(cw * 0.1);
      el.y = Math.round(ch * 0.05);
    }
    el.x += area.x;
    el.y += area.y;
    // nombre único
    const names = new Set(page.elements.map((e) => e.name));
    let n = 2;
    const base = el.name;
    while (names.has(el.name)) el.name = `${base} ${n++}`;
    s.patchPage((pg) => pg.elements.push(el));
    set({ selection: [el.id] });
  },

  removeSelected: () => {
    const s = get();
    if (!s.project || s.selection.length === 0) return;
    const sel = new Set(s.selection);
    s.patchPage((page) => {
      page.elements = page.elements.filter((e) => !sel.has(e.id) || e.locked);
    });
    set({ selection: [] });
  },

  duplicateSelected: () => {
    const s = get();
    if (!s.project || s.selection.length === 0) return;
    const sel = new Set(s.selection);
    const newIds: string[] = [];
    s.patchPage((page) => {
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
    get().patchPage((page) => {
      const els = page.elements;
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
    s.patchPage((page) => {
      for (const el of page.elements) {
        if (sel.has(el.id) && !el.locked) {
          el.x = Math.round(el.x + dx);
          el.y = Math.round(el.y + dy);
        }
      }
    });
  },

  setActiveDisplay: (i) => set({ activeDisplay: i, activePage: 0, selection: [] }),
  setActivePage: (i) => set({ activePage: i, selection: [] }),
  addPage: (name) => {
    const s = get();
    const d = activeDisplayOf(s);
    if (!d) return;
    const page = createPage(name ?? `Página ${d.pages.length + 1}`);
    s.patchDisplay((disp) => disp.pages.push(page));
    set({ activePage: d.pages.length, selection: [] });
  },
  removePage: (i) => {
    const s = get();
    const d = activeDisplayOf(s);
    if (!d || d.pages.length <= 1) return;
    s.patchDisplay((disp) => disp.pages.splice(i, 1));
    set({ activePage: Math.max(0, Math.min(s.activePage, d.pages.length - 2)), selection: [] });
  },
  movePage: (from, to) => {
    const s = get();
    s.patchDisplay((disp) => {
      if (from < 0 || from >= disp.pages.length || to < 0 || to >= disp.pages.length) return;
      const [pg] = disp.pages.splice(from, 1);
      disp.pages.splice(to, 0, pg);
    });
    set({ activePage: to });
  },
  addDisplay: (d) => {
    const s = get();
    if (!s.project) return;
    s.patchProject((p) => p.displays.push(d));
    set({ activeDisplay: s.project.displays.length, activePage: 0, selection: [] });
  },
  removeDisplay: (i) => {
    const s = get();
    if (!s.project || s.project.displays.length <= 1) return;
    s.patchProject((p) => p.displays.splice(i, 1));
    set({ activeDisplay: Math.max(0, Math.min(s.activeDisplay, s.project.displays.length - 2)), activePage: 0, selection: [] });
  },

  setSim: (id, v) => set((s) => ({ sim: { ...s.sim, [id]: v } })),
  resetSim: () => set({ sim: defaultSim() }),
  setSimAuto: (simAuto) => set({ simAuto }),
  setAmbient: (ambient) => set({ ambient }),
  togglePreview: () => set((s) => ({ showPreview: !s.showPreview })),
  setPreviewMode: (previewMode) => set({ previewMode, selection: previewMode ? [] : get().selection }),
  setPhysicalView: (physicalView) => set({ physicalView }),
  setFollowPageRules: (followPageRules) => set({ followPageRules }),
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
  const page = activePageOf(s);
  if (!page) return [];
  const sel = new Set(s.selection);
  return page.elements.filter((e) => sel.has(e.id));
}
