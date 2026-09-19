import { useEffect, useRef } from 'react';
import type { DisplayElement } from '@shared/model';
import { useStore, activeDisplayOf, activePageOf } from '../store';
import { resolveSim } from '../sim';
import { drawScene, pageMatches, type DrawEnv } from '../render/draw';
import { hasUvRegion, uvRegionPx } from '@shared/uv';

/**
 * Lienzo WYSIWYG: zoom/pan, selección, arrastre, redimensionado con tiradores, marco de selección,
 * rejilla, ajuste a rejilla/bordes/centros y líneas guía.
 */

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_PX = 8;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'move'; startX: number; startY: number; orig: Map<string, Rect>; moved: boolean }
  | { kind: 'resize'; handle: Handle; startX: number; startY: number; orig: Map<string, Rect>; bbox: Rect }
  | { kind: 'marquee'; startX: number; startY: number; curX: number; curY: number; additive: boolean };

interface Guide {
  axis: 'x' | 'y';
  pos: number;
}

export function CanvasEditor() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());
  const imageKeys = useRef(new Set<string>());
  const drawState = useRef(new Map<string, { on?: boolean; v?: number }>());
  const drag = useRef<Drag | null>(null);
  const guides = useRef<Guide[]>([]);
  const space = useRef(false);
  const fitted = useRef(false);
  const lastT = useRef(performance.now());
  const t0 = useRef(performance.now());
  const heldCtx = useRef<{ display: string; at: number; ctx: ReturnType<typeof resolveSim> } | null>(null);

  // ---------- transformación vista ----------
  function view() {
    const s = useStore.getState();
    const p = activeDisplayOf(s)!;
    let ky = 1;
    if (s.physicalView && s.profile) {
      const d = s.profile.displays.find((x) => x.id === p.display_id);
      if (d?.physical_size_m) {
        // la proporción física corresponde al área visible de la malla, no a toda la textura
        const area = uvRegionPx({ uv_region: d.uv_region, texture_size: p.canvas });
        const physAspect = d.physical_size_m.width / d.physical_size_m.height;
        ky = area.width / physAspect / area.height;
      }
    }
    return { sx: s.zoom, sy: s.zoom * ky, px: s.pan.x, py: s.pan.y };
  }
  function toCanvas(clientX: number, clientY: number) {
    const r = canvasRef.current!.getBoundingClientRect();
    const v = view();
    return { x: (clientX - r.left - v.px) / v.sx, y: (clientY - r.top - v.py) / v.sy };
  }

  function fit() {
    const wrap = wrapRef.current;
    const s = useStore.getState();
    const dp = activeDisplayOf(s);
    if (!wrap || !dp) return;
    const W = dp.canvas.width;
    const H = dp.canvas.height;
    const zoom = Math.min((wrap.clientWidth - 40) / W, (wrap.clientHeight - 40) / H);
    s.setZoom(zoom);
    s.setPan({ x: (wrap.clientWidth - W * zoom) / 2, y: (wrap.clientHeight - H * zoom) / 2 });
  }

  // ---------- imágenes ----------
  function syncImages() {
    const s = useStore.getState();
    const want = new Map<string, string>();
    for (const [k, url] of Object.entries(s.assets)) want.set(k, url);
    for (const ic of s.icons) want.set(`builtin:${ic.id}`, `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(ic.svg)))}`);
    for (const [k, url] of want) {
      if (imageKeys.current.has(k)) continue;
      imageKeys.current.add(k);
      const img = new Image();
      img.src = url;
      images.current.set(k, img);
    }
  }

  // ---------- bucle de dibujo ----------
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      const s = useStore.getState();
      if (!canvas || !wrap || !activeDisplayOf(s)) return;
      const dpr = window.devicePixelRatio || 1;
      const cw = wrap.clientWidth;
      const ch = wrap.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
        canvas.style.width = `${cw}px`;
        canvas.style.height = `${ch}px`;
        if (!fitted.current) {
          fitted.current = true;
          fit();
        }
      }
      syncImages();
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastT.current) / 1000);
      lastT.current = now;
      const t = (now - t0.current) / 1000;

      // simulación automática de RPM (subida en bucle)
      if (s.simAuto) {
        const lim = Number(s.sim.rpm_limiter) || 8000;
        const cyc = (t % 4) / 4;
        s.setSim('rpm', Math.round(1000 + (lim - 1000) * Math.min(1, cyc * 1.15)));
      }

      const p = activeDisplayOf(s)!;
      const display = s.profile?.displays.find((d) => d.id === p.display_id);
      const defaults = display?.defaults ?? { rpm_limiter: 8000, rpm_warning_pct: 0.85, rpm_redline_pct: 0.95, max_fuel_l: 60, water_temp_range: [40, 130], oil_temp_range: [40, 150], oil_pressure_range: [0, 8], speed_max: 300 };
      // frecuencia de refresco del display: los valores solo cambian cada 1/Hz s (como en el juego)
      let simCtx = resolveSim(s.sim, defaults, t, s.ambient);
      const hz = p.settings.refreshHz || 0;
      if (hz > 0) {
        const held = heldCtx.current;
        if (held && held.display === p.display_id && t - held.at < 1 / hz && t >= held.at) simCtx = held.ctx;
        else heldCtx.current = { display: p.display_id, at: t, ctx: simCtx };
      } else heldCtx.current = null;
      const env: DrawEnv = { images: images.current, brightness: p.settings.brightness * s.ambient, state: drawState.current, dt };

      const g = canvas.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0f1114';
      g.fillRect(0, 0, cw, ch);
      const v = view();
      const W = p.canvas.width;
      const H = p.canvas.height;

      // sombra + escena
      g.save();
      g.translate(v.px, v.py);
      g.scale(v.sx, v.sy);
      g.shadowColor = '#000c';
      g.shadowBlur = 30 / v.sx;
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      g.shadowBlur = 0;
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      const bg = p.background.file ? images.current.get(p.background.file) ?? null : null;
      // en previsualización se puede seguir la lógica de páginas del juego (condiciones automáticas)
      let page = activePageOf(s)!;
      if (s.previewMode && s.followPageRules) page = p.pages.find((pg) => pageMatches(pg, simCtx)) ?? page;
      drawScene(g, p, page, simCtx, env, bg);
      g.restore();

      // área visible de la malla (UV): fuera de ella lo dibujado no se ve en el coche
      const area = display && hasUvRegion(display) ? uvRegionPx({ uv_region: display.uv_region, texture_size: p.canvas }) : null;
      if (area) {
        const ax = v.px + area.x * v.sx;
        const ay = v.py + area.y * v.sy;
        const aw = area.width * v.sx;
        const ah = area.height * v.sy;
        g.save();
        // oscurecer lo que queda fuera (en previsualización se oculta del todo)
        g.fillStyle = s.previewMode ? '#0f1114' : 'rgba(15,17,20,0.72)';
        g.beginPath();
        g.rect(v.px, v.py, W * v.sx, H * v.sy);
        g.rect(ax, ay, aw, ah);
        g.fill('evenodd');
        g.strokeStyle = s.previewMode ? '#4a5160' : '#ffb020';
        g.lineWidth = 1;
        g.setLineDash(s.previewMode ? [] : [6, 4]);
        g.strokeRect(Math.round(ax) + 0.5, Math.round(ay) + 0.5, Math.round(aw), Math.round(ah));
        g.setLineDash([]);
        if (!s.previewMode) {
          g.fillStyle = '#ffb020';
          g.font = '11px system-ui, sans-serif';
          g.textBaseline = 'bottom';
          g.fillText(`área visible ${area.width}×${area.height} px`, ax + 4, ay - 3 > v.py + 12 ? ay - 3 : ay + 14);
        }
        g.restore();
      }

      if (s.previewMode) return;

      // rejilla
      if (p.settings.grid > 0 && p.settings.grid * v.sx >= 6) {
        g.save();
        g.beginPath();
        g.rect(v.px, v.py, W * v.sx, H * v.sy);
        g.clip();
        g.strokeStyle = 'rgba(255,255,255,0.07)';
        g.lineWidth = 1;
        g.beginPath();
        for (let x = 0; x <= W; x += p.settings.grid) {
          const X = Math.round(v.px + x * v.sx) + 0.5;
          g.moveTo(X, v.py);
          g.lineTo(X, v.py + H * v.sy);
        }
        for (let y = 0; y <= H; y += p.settings.grid) {
          const Y = Math.round(v.py + y * v.sy) + 0.5;
          g.moveTo(v.px, Y);
          g.lineTo(v.px + W * v.sx, Y);
        }
        g.stroke();
        g.restore();
      }
      // borde del display
      g.strokeStyle = '#4a5160';
      g.lineWidth = 1;
      g.strokeRect(v.px - 0.5, v.py - 0.5, W * v.sx + 1, H * v.sy + 1);

      // selección
      const sel = new Set(s.selection);
      const els = activePageOf(s)!.elements;
      for (const el of els) {
        if (!sel.has(el.id)) continue;
        const X = v.px + el.x * v.sx;
        const Y = v.py + el.y * v.sy;
        const Wd = el.width * v.sx;
        const Hd = el.height * v.sy;
        g.save();
        if (el.rotation) {
          g.translate(X + Wd / 2, Y + Hd / 2);
          g.rotate((el.rotation * Math.PI) / 180);
          g.translate(-(X + Wd / 2), -(Y + Hd / 2));
        }
        g.strokeStyle = el.locked ? '#ffb020' : '#3d8bff';
        g.lineWidth = 1;
        g.setLineDash(el.locked ? [4, 3] : []);
        g.strokeRect(Math.round(X) + 0.5, Math.round(Y) + 0.5, Math.round(Wd), Math.round(Hd));
        g.setLineDash([]);
        if (s.selection.length === 1 && !el.locked) {
          for (const h of HANDLES) {
            const { hx, hy } = handlePos(h, X, Y, Wd, Hd);
            g.fillStyle = '#fff';
            g.strokeStyle = '#3d8bff';
            g.fillRect(hx - HANDLE_PX / 2, hy - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
            g.strokeRect(hx - HANDLE_PX / 2 + 0.5, hy - HANDLE_PX / 2 + 0.5, HANDLE_PX - 1, HANDLE_PX - 1);
          }
        }
        g.restore();
      }
      // guías
      if (guides.current.length) {
        g.strokeStyle = '#ff4fd8';
        g.lineWidth = 1;
        g.setLineDash([4, 3]);
        g.beginPath();
        for (const gd of guides.current) {
          if (gd.axis === 'x') {
            const X = Math.round(v.px + gd.pos * v.sx) + 0.5;
            g.moveTo(X, 0);
            g.lineTo(X, ch);
          } else {
            const Y = Math.round(v.py + gd.pos * v.sy) + 0.5;
            g.moveTo(0, Y);
            g.lineTo(cw, Y);
          }
        }
        g.stroke();
        g.setLineDash([]);
      }
      // marco de selección
      const d = drag.current;
      if (d?.kind === 'marquee') {
        const x0 = v.px + Math.min(d.startX, d.curX) * v.sx;
        const y0 = v.py + Math.min(d.startY, d.curY) * v.sy;
        const x1 = v.px + Math.max(d.startX, d.curX) * v.sx;
        const y1 = v.py + Math.max(d.startY, d.curY) * v.sy;
        g.fillStyle = 'rgba(61,139,255,0.12)';
        g.strokeStyle = '#3d8bff';
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- eventos ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (isTyping(e)) return;
        space.current = e.type === 'keydown';
        if (e.type === 'keydown') e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  function hitElement(x: number, y: number): DisplayElement | null {
    const s = useStore.getState();
    const els = activePageOf(s)!.elements;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!el.visible) continue;
      if (x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height) return el;
    }
    return null;
  }

  function hitHandle(clientX: number, clientY: number): Handle | null {
    const s = useStore.getState();
    if (s.selection.length !== 1) return null;
    const el = activePageOf(s)!.elements.find((e) => e.id === s.selection[0]);
    if (!el || el.locked) return null;
    const v = view();
    const r = canvasRef.current!.getBoundingClientRect();
    const mx = clientX - r.left;
    const my = clientY - r.top;
    const X = v.px + el.x * v.sx;
    const Y = v.py + el.y * v.sy;
    for (const h of HANDLES) {
      const { hx, hy } = handlePos(h, X, Y, el.width * v.sx, el.height * v.sy);
      if (Math.abs(mx - hx) <= HANDLE_PX && Math.abs(my - hy) <= HANDLE_PX) return h;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent) {
    const s = useStore.getState();
    if (!activePageOf(s)) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && space.current)) {
      drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: s.pan.x, panY: s.pan.y };
      return;
    }
    if (e.button !== 0 || s.previewMode) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const handle = hitHandle(e.clientX, e.clientY);
    if (handle) {
      const el = activePageOf(s)!.elements.find((el) => el.id === s.selection[0])!;
      s.snapshot();
      drag.current = { kind: 'resize', handle, startX: x, startY: y, orig: new Map([[el.id, rectOf(el)]]), bbox: rectOf(el) };
      return;
    }
    const el = hitElement(x, y);
    if (el) {
      if (e.shiftKey) s.select([el.id], true);
      else if (!s.selection.includes(el.id)) s.select([el.id]);
      const sel = useStore.getState().selection;
      const orig = new Map<string, Rect>();
      for (const it of activePageOf(s)!.elements) if (sel.includes(it.id) && !it.locked) orig.set(it.id, rectOf(it));
      drag.current = { kind: 'move', startX: x, startY: y, orig, moved: false };
    } else {
      drag.current = { kind: 'marquee', startX: x, startY: y, curX: x, curY: y, additive: e.shiftKey };
      if (!e.shiftKey) s.select([]);
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const s = useStore.getState();
    if (!activePageOf(s)) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    s.setHoverPos({ x: Math.round(x), y: Math.round(y) });
    const d = drag.current;
    if (!d) {
      const h = hitHandle(e.clientX, e.clientY);
      const c = canvasRef.current!;
      c.style.cursor = space.current ? 'grab' : h ? cursorFor(h) : hitElement(x, y) ? 'move' : 'default';
      return;
    }
    if (d.kind === 'pan') {
      s.setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) });
      return;
    }
    if (d.kind === 'marquee') {
      d.curX = x;
      d.curY = y;
      return;
    }
    if (d.kind === 'move') {
      if (d.orig.size === 0) return;
      let dx = x - d.startX;
      let dy = y - d.startY;
      if (!d.moved && Math.abs(dx) < 2 / s.zoom && Math.abs(dy) < 2 / s.zoom) return;
      if (!d.moved) {
        d.moved = true;
        s.snapshot();
      }
      // bbox del grupo
      const bb = unionRect([...d.orig.values()]);
      const target = { x: bb.x + dx, y: bb.y + dy, width: bb.width, height: bb.height };
      const snapped = snap(target, [...d.orig.keys()], e.altKey);
      dx = snapped.x - bb.x;
      dy = snapped.y - bb.y;
      s.patchPage((page) => {
        for (const el of page.elements) {
          const o = d.orig.get(el.id);
          if (o) {
            el.x = Math.round(o.x + dx);
            el.y = Math.round(o.y + dy);
          }
        }
      }, false);
      return;
    }
    if (d.kind === 'resize') {
      const o = d.bbox;
      let nx = o.x;
      let ny = o.y;
      let nw = o.width;
      let nh = o.height;
      const dx = x - d.startX;
      const dy = y - d.startY;
      if (d.handle.includes('e')) nw = o.width + dx;
      if (d.handle.includes('s')) nh = o.height + dy;
      if (d.handle.includes('w')) {
        nx = o.x + dx;
        nw = o.width - dx;
      }
      if (d.handle.includes('n')) {
        ny = o.y + dy;
        nh = o.height - dy;
      }
      if (e.shiftKey && o.width > 0 && o.height > 0) {
        const ratio = o.width / o.height;
        if (d.handle.length === 2) {
          if (Math.abs(nw / ratio) > Math.abs(nh)) nh = nw / ratio;
          else nw = nh * ratio;
          if (d.handle.includes('n')) ny = o.y + o.height - nh;
          if (d.handle.includes('w')) nx = o.x + o.width - nw;
        }
      }
      if (nw < 4) {
        if (d.handle.includes('w')) nx = o.x + o.width - 4;
        nw = 4;
      }
      if (nh < 4) {
        if (d.handle.includes('n')) ny = o.y + o.height - 4;
        nh = 4;
      }
      const snapped = snapResize({ x: nx, y: ny, width: nw, height: nh }, d.handle, [...d.orig.keys()], e.altKey);
      const id = [...d.orig.keys()][0];
      s.updateElement(id, { x: Math.round(snapped.x), y: Math.round(snapped.y), width: Math.round(snapped.width), height: Math.round(snapped.height) }, false);
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    const s = useStore.getState();
    const d = drag.current;
    drag.current = null;
    guides.current = [];
    if (!d || !activePageOf(s)) return;
    if (d.kind === 'marquee') {
      const x0 = Math.min(d.startX, d.curX);
      const y0 = Math.min(d.startY, d.curY);
      const x1 = Math.max(d.startX, d.curX);
      const y1 = Math.max(d.startY, d.curY);
      if (x1 - x0 < 2 && y1 - y0 < 2) return;
      const ids = activePageOf(s)!.elements.filter((el) => el.visible && el.x < x1 && el.x + el.width > x0 && el.y < y1 && el.y + el.height > y0).map((el) => el.id);
      s.select(ids, d.additive);
    }
    if (d.kind === 'move' && !d.moved && !e.shiftKey) {
      const { x, y } = toCanvas(e.clientX, e.clientY);
      const el = hitElement(x, y);
      if (el) s.select([el.id]);
    }
  }

  function onWheel(e: React.WheelEvent) {
    const s = useStore.getState();
    const r = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const z = Math.max(0.05, Math.min(8, s.zoom * factor));
    const k = z / s.zoom;
    s.setPan({ x: mx - (mx - s.pan.x) * k, y: my - (my - s.pan.y) * k });
    s.setZoom(z);
  }

  // ---------- ajuste ----------
  function snapCandidates(exclude: string[]) {
    const s = useStore.getState();
    const p = activeDisplayOf(s)!;
    const xs = [0, p.canvas.width / 2, p.canvas.width];
    const ys = [0, p.canvas.height / 2, p.canvas.height];
    if (p.settings.snapToElements) {
      for (const el of activePageOf(s)!.elements) {
        if (exclude.includes(el.id) || !el.visible) continue;
        xs.push(el.x, el.x + el.width / 2, el.x + el.width);
        ys.push(el.y, el.y + el.height / 2, el.y + el.height);
      }
    }
    return { xs, ys };
  }

  function snap(r: Rect, exclude: string[], disabled: boolean): Rect {
    const s = useStore.getState();
    const p = activeDisplayOf(s)!;
    guides.current = [];
    if (disabled || !p.settings.snap) return r;
    const th = 6 / s.zoom;
    const { xs, ys } = snapCandidates(exclude);
    let bestX: { d: number; off: number; pos: number } | null = null;
    let bestY: { d: number; off: number; pos: number } | null = null;
    for (const edge of [0, r.width / 2, r.width]) {
      for (const c of xs) {
        const d = Math.abs(r.x + edge - c);
        if (d <= th && (!bestX || d < bestX.d)) bestX = { d, off: c - edge, pos: c };
      }
    }
    for (const edge of [0, r.height / 2, r.height]) {
      for (const c of ys) {
        const d = Math.abs(r.y + edge - c);
        if (d <= th && (!bestY || d < bestY.d)) bestY = { d, off: c - edge, pos: c };
      }
    }
    let x = r.x;
    let y = r.y;
    if (bestX) {
      x = bestX.off;
      guides.current.push({ axis: 'x', pos: bestX.pos });
    } else if (p.settings.grid > 0) x = Math.round(x / p.settings.grid) * p.settings.grid;
    if (bestY) {
      y = bestY.off;
      guides.current.push({ axis: 'y', pos: bestY.pos });
    } else if (p.settings.grid > 0) y = Math.round(y / p.settings.grid) * p.settings.grid;
    return { ...r, x, y };
  }

  function snapResize(r: Rect, handle: Handle, exclude: string[], disabled: boolean): Rect {
    const s = useStore.getState();
    const p = activeDisplayOf(s)!;
    guides.current = [];
    if (disabled || !p.settings.snap) return r;
    const th = 6 / s.zoom;
    const { xs, ys } = snapCandidates(exclude);
    const out = { ...r };
    const g = p.settings.grid;
    const snapTo = (val: number, cands: number[]): { v: number; hit: boolean } => {
      let best: number | null = null;
      for (const c of cands) if (Math.abs(val - c) <= th && (best === null || Math.abs(val - c) < Math.abs(val - best))) best = c;
      if (best !== null) return { v: best, hit: true };
      return { v: g > 0 ? Math.round(val / g) * g : val, hit: false };
    };
    if (handle.includes('e')) {
      const t = snapTo(r.x + r.width, xs);
      out.width = t.v - r.x;
      if (t.hit) guides.current.push({ axis: 'x', pos: t.v });
    }
    if (handle.includes('w')) {
      const t = snapTo(r.x, xs);
      out.width = r.x + r.width - t.v;
      out.x = t.v;
      if (t.hit) guides.current.push({ axis: 'x', pos: t.v });
    }
    if (handle.includes('s')) {
      const t = snapTo(r.y + r.height, ys);
      out.height = t.v - r.y;
      if (t.hit) guides.current.push({ axis: 'y', pos: t.v });
    }
    if (handle.includes('n')) {
      const t = snapTo(r.y, ys);
      out.height = r.y + r.height - t.v;
      out.y = t.v;
      if (t.hit) guides.current.push({ axis: 'y', pos: t.v });
    }
    if (out.width < 4) out.width = 4;
    if (out.height < 4) out.height = 4;
    return out;
  }

  // exponer "ajustar a ventana" para la barra superior
  useEffect(() => {
    const h = () => fit();
    window.addEventListener('acdg:fit', h);
    return () => window.removeEventListener('acdg:fit', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="canvas-area" ref={wrapRef} onWheel={onWheel}>
      <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => useStore.getState().setHoverPos(null)} onContextMenu={(e) => e.preventDefault()} />
    </div>
  );
}

function rectOf(el: DisplayElement): Rect {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

function unionRect(rs: Rect[]): Rect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.width));
  const y1 = Math.max(...rs.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function handlePos(h: Handle, X: number, Y: number, W: number, H: number): { hx: number; hy: number } {
  const hx = h.includes('w') ? X : h.includes('e') ? X + W : X + W / 2;
  const hy = h.includes('n') ? Y : h.includes('s') ? Y + H : Y + H / 2;
  return { hx, hy };
}

function cursorFor(h: Handle): string {
  return { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' }[h];
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
