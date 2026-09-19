import type { Color, DisplayElement, DisplayProject, Page, Rule, RpmValue, TextStyle, Threshold } from '@shared/model';
import { resolveRpm } from '@shared/model';
import { formatBinding } from '@shared/format';
import { VARIABLE_MAP } from '@shared/variables';
import type { SimContext } from '../sim';

/**
 * Renderizador Canvas 2D del editor. Refleja la semántica de resources/runtime/acdg_runtime.lua:
 * misma geometría, mismos estados, mismas reglas. Cualquier cambio aquí debe replicarse en el runtime.
 */

export interface DrawEnv {
  images: Map<string, HTMLImageElement>;
  /** brillo global (proyecto × ambiente) */
  brightness: number;
  /** estado persistente entre frames (histéresis, suavizado) */
  state: Map<string, { on?: boolean; v?: number; text?: string; at?: number }>;
  dt: number;
}

/* ---------- utilidades ---------- */

export function parseColor(c: Color | undefined): [number, number, number, number] {
  if (!c || c[0] !== '#') return [255, 255, 255, 1];
  const hex = c.length === 7 ? c + 'FF' : c;
  if (hex.length !== 9) return [255, 255, 255, 1];
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), parseInt(hex.slice(7, 9), 16) / 255];
}

function css(c: Color | undefined, brightness: number, opacity: number): string {
  const [r, g, b, a] = parseColor(c);
  const k = Math.max(0, brightness);
  return `rgba(${Math.min(255, Math.round(r * k))},${Math.min(255, Math.round(g * k))},${Math.min(255, Math.round(b * k))},${(a * opacity).toFixed(3)})`;
}

function blinkOn(t: number, hz: number | undefined): boolean {
  if (!hz || hz <= 0) return true;
  return (t * hz) % 1 < 0.5;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function rpmOf(v: RpmValue, ctx: SimContext): number {
  return resolveRpm(v, ctx.limiter);
}

function compare(a: unknown, op: Rule['when']['op'], b: unknown, ctx: SimContext): boolean {
  let x = typeof a === 'boolean' ? (a ? 1 : 0) : Number(a);
  let y: number;
  if (typeof b === 'boolean') y = b ? 1 : 0;
  else if (typeof b === 'string') y = rpmOf(b as RpmValue, ctx);
  else y = Number(b);
  if (!Number.isFinite(x)) x = 0;
  switch (op) {
    case '>':
      return x > y;
    case '>=':
      return x >= y;
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    case '==':
      return x === y;
    case '!=':
      return x !== y;
  }
}

export interface RuleResult {
  visible: boolean;
  opacity: number;
  color?: Color;
  image?: string;
}

/** Evalúa la condición de una página (misma semántica que el runtime). */
export function pageMatches(page: Page, ctx: SimContext): boolean {
  if (!page.when) return false;
  const v = ctx.values[page.when.variable];
  return compare(v, page.when.op, page.when.value, ctx);
}

export function applyRules(el: DisplayElement, ctx: SimContext): RuleResult {
  let visible = el.visible;
  let opacity = el.opacity;
  let color: Color | undefined;
  let image: string | undefined;
  for (const r of el.rules) {
    const v = ctx.values[r.when.variable];
    if (r.when.variable === 'is_replay' ? v === true : compare(v, r.when.op, r.when.value, ctx)) {
      if (r.set.visible !== undefined) visible = r.set.visible;
      if (r.set.opacity !== undefined) opacity = r.set.opacity;
      if (r.set.color !== undefined) color = r.set.color;
      if (r.set.image !== undefined) image = r.set.image;
      if (r.set.blinkHz && r.set.blinkHz > 0 && !blinkOn(ctx.t, r.set.blinkHz)) visible = false;
    }
  }
  return { visible, opacity, color, image };
}

/** Valor de variable con fallback cuando no hay físicas (replay). */
function varValue(ctx: SimContext, id: string | undefined): number | boolean | undefined {
  if (!id) return undefined;
  const def = VARIABLE_MAP[id];
  if (def?.physics_only && !ctx.physicsAvailable) return def.fallback as number | boolean;
  return ctx.values[id];
}

/* ---------- texto ---------- */

function drawText(g: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, style: TextStyle, color: string): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.font = `${style.bold ? 'bold ' : ''}${style.size}px "${style.font}", "Segoe UI", sans-serif`;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  try {
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${style.letterSpacing || 0}px`;
  } catch {
    /* navegadores sin soporte */
  }
  const tx = style.align === 'left' ? x : style.align === 'right' ? x + w : x + w / 2;
  g.textAlign = style.align === 'left' ? 'left' : style.align === 'right' ? 'right' : 'center';
  const ty = style.valign === 'top' ? y + style.size * 0.55 : style.valign === 'bottom' ? y + h - style.size * 0.55 : y + h / 2;
  g.fillText(text, tx, ty);
  g.restore();
}

/* ---------- barras ---------- */

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  if (rr <= 0) g.rect(x, y, w, h);
  else g.roundRect(x, y, w, h, rr);
}

function segmentedBar(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  vertical: boolean,
  reverse: boolean,
  n: number,
  gap: number,
  radius: number,
  active: number,
  colorFn: (i: number, isActive: boolean) => string | null,
): void {
  const len = vertical ? h : w;
  const segLen = Math.max(1, (len - gap * (n - 1)) / n);
  for (let i = 1; i <= n; i++) {
    const idx = reverse ? n - i + 1 : i;
    const off = (i - 1) * (segLen + gap);
    const c = colorFn(idx, idx <= active);
    if (!c) continue;
    g.fillStyle = c;
    if (vertical) roundRect(g, x, y + h - off - segLen, w, segLen, radius);
    else roundRect(g, x + off, y, segLen, h, radius);
    g.fill();
  }
}

function continuousBar(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  vertical: boolean,
  reverse: boolean,
  frac: number,
  radius: number,
  bg: string | null,
  fill: string,
): void {
  if (bg) {
    g.fillStyle = bg;
    roundRect(g, x, y, w, h, radius);
    g.fill();
  }
  frac = clamp01(frac);
  if (frac <= 0) return;
  g.fillStyle = fill;
  if (vertical) {
    const fh = h * frac;
    roundRect(g, x, reverse ? y : y + h - fh, w, fh, radius);
  } else {
    const fw = w * frac;
    roundRect(g, reverse ? x + w - fw : x, y, fw, h, radius);
  }
  g.fill();
}

function thresholdColor(value: number, base: Color, thresholds: Threshold[]): Color {
  let c = base;
  for (const t of thresholds) if (value >= t.value) c = t.color;
  return c;
}

/* ---------- elementos ---------- */

export function drawElement(g: CanvasRenderingContext2D, el: DisplayElement, ctx: SimContext, env: DrawEnv): void {
  const rr = applyRules(el, ctx);
  if (!rr.visible || rr.opacity <= 0) return;
  const B = env.brightness;
  const O = rr.opacity;
  const C = (c: Color | undefined): string => css(c, B, O);
  g.save();
  if (el.rotation) {
    g.translate(el.x + el.width / 2, el.y + el.height / 2);
    g.rotate((el.rotation * Math.PI) / 180);
    g.translate(-(el.x + el.width / 2), -(el.y + el.height / 2));
  }
  const { x, y, width: w, height: h } = el;

  switch (el.type) {
    case 'text': {
      const hz = el.binding.updateHz ?? 0;
      let text: string;
      if (hz > 0) {
        // frecuencia propia del texto: se congela entre actualizaciones (igual que el runtime)
        const st = env.state.get(el.id) ?? {};
        env.state.set(el.id, st);
        if (st.text === undefined || st.at === undefined || ctx.t - st.at >= 1 / hz || ctx.t < st.at) {
          st.text = formatBinding(el.binding, varValue(ctx, el.binding.variable));
          st.at = ctx.t;
        }
        text = st.text;
      } else text = formatBinding(el.binding, varValue(ctx, el.binding.variable));
      drawText(g, text, x, y, w, h, el.style, C(rr.color ?? el.style.color));
      break;
    }
    case 'gear': {
      const gear = Math.round(Number(varValue(ctx, 'gear') ?? 0));
      const txt = el.config.map[String(gear)] ?? String(gear);
      let color = rr.color;
      if (!color && el.config.limiterColor && ctx.values.limiter_on === true) color = el.config.limiterColor;
      drawText(g, txt, x, y, w, h, el.config.style, C(color ?? el.config.style.color));
      break;
    }
    case 'rpm_bar': {
      const c = el.config;
      const rpm = Number(ctx.values.rpm ?? 0);
      const minR = rpmOf(c.min, ctx);
      let maxR = rpmOf(c.max, ctx);
      if (maxR <= minR) maxR = minR + 1;
      const warnR = rpmOf(c.warning, ctx);
      const redR = rpmOf(c.redline, ctx);
      const frac = clamp01((rpm - minR) / (maxR - minR));
      const onLimiter = ctx.values.limiter_on === true || rpm >= maxR - 1;
      const limiterVisible = onLimiter && blinkOn(ctx.t, c.limiterBlinkHz);
      const zone = (r: number): Color => (r >= redR ? c.colors.redline : r >= warnR ? c.colors.warning : c.colors.normal);
      const vertical = c.orientation === 'vertical';
      if (c.style === 'segments') {
        const n = Math.max(1, Math.floor(c.segments));
        const active = Math.floor(frac * n + 0.0001);
        segmentedBar(g, x, y, w, h, vertical, c.reverse, n, c.gap, c.radius, active, (i, isActive) => {
          if (onLimiter) return C(limiterVisible ? c.colors.limiter : c.colors.off);
          if (!isActive) return C(c.colors.off);
          return C(c.perSegmentColors ? zone(minR + ((i - 0.5) / n) * (maxR - minR)) : zone(rpm));
        });
      } else {
        let fill = zone(rpm);
        if (onLimiter) fill = limiterVisible ? c.colors.limiter : c.colors.off;
        continuousBar(g, x, y, w, h, vertical, c.reverse, frac, c.radius, C(c.colors.off), C(fill));
      }
      break;
    }
    case 'shift_light': {
      const c = el.config;
      const st = env.state.get(el.id) ?? { on: false };
      env.state.set(el.id, st);
      const rpm = Number(ctx.values.rpm ?? 0);
      if (st.on) {
        if (rpm < rpmOf(c.rpmOff, ctx)) st.on = false;
      } else if (rpm >= rpmOf(c.rpmOn, ctx)) st.on = true;
      const lit = st.on && blinkOn(ctx.t, c.blinkHz);
      g.fillStyle = C(lit ? rr.color ?? c.colorOn : c.colorOff);
      if (c.shape === 'circle') {
        g.beginPath();
        g.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
        g.fill();
      } else {
        roundRect(g, x, y, w, h, c.radius);
        g.fill();
      }
      break;
    }
    case 'bar': {
      const c = el.config;
      const raw = Number(varValue(ctx, c.variable) ?? 0);
      const st = env.state.get(el.id) ?? { v: raw };
      env.state.set(el.id, st);
      if (c.smoothingMs > 0) st.v = (st.v ?? raw) + (raw - (st.v ?? raw)) * clamp01(env.dt / (c.smoothingMs / 1000));
      else st.v = raw;
      const value = st.v;
      const fill = rr.color ?? thresholdColor(value, c.colorFill, c.thresholds);
      const vertical = c.orientation === 'vertical';
      if (c.bipolar) {
        const frac = clamp01(Math.abs(value) / Math.max(Math.abs(c.max), Math.abs(c.min), 0.0001));
        g.fillStyle = C(c.colorBg);
        roundRect(g, x, y, w, h, c.radius);
        g.fill();
        if (frac > 0) {
          g.fillStyle = C(fill);
          if (vertical) {
            const cy = y + h / 2;
            const fh = (h / 2) * frac;
            roundRect(g, x, value >= 0 ? cy - fh : cy, w, fh, c.radius);
          } else {
            const cx = x + w / 2;
            const fw = (w / 2) * frac;
            roundRect(g, value >= 0 ? cx : cx - fw, y, fw, h, c.radius);
          }
          g.fill();
        }
        break;
      }
      const range = c.max - c.min || 1;
      const frac = clamp01((value - c.min) / range);
      if (c.style === 'segments') {
        const n = Math.max(1, Math.floor(c.segments));
        const active = Math.floor(frac * n + 0.0001);
        segmentedBar(g, x, y, w, h, vertical, c.reverse, n, c.gap, c.radius, active, (_i, isActive) => C(isActive ? fill : c.colorBg));
      } else {
        continuousBar(g, x, y, w, h, vertical, c.reverse, frac, c.radius, C(c.colorBg), C(fill));
      }
      break;
    }
    case 'icon': {
      const c = el.config;
      let on = true;
      if (c.variable) {
        let v = varValue(ctx, c.variable);
        if (typeof v === 'number') v = v !== 0;
        if (c.showWhen === 'when_true') on = v === true;
        else if (c.showWhen === 'when_false') on = v !== true;
      }
      let color: Color;
      if (on) color = rr.color ?? c.colorOn;
      else if (c.dimWhenOff) color = c.colorOff;
      else break;
      const img = env.images.get(rr.image ?? c.icon);
      if (img && img.complete && img.naturalWidth > 0) {
        drawTinted(g, img, x, y, w, h, color, B, O);
      } else {
        g.strokeStyle = C(color);
        g.lineWidth = 2;
        g.strokeRect(x, y, w, h);
      }
      break;
    }
    case 'image': {
      const img = env.images.get(rr.image ?? el.config.file);
      if (img && img.complete && img.naturalWidth > 0) {
        g.globalAlpha = O;
        const tint = rr.color ?? el.config.tint;
        const tinted = tint && tint.toUpperCase() !== '#FFFFFF' && tint.toUpperCase() !== '#FFFFFFFF';
        // fit/fill: se conserva la proporción y se centra en la caja (igual que ui.ImageFit en CSP)
        let dx = x;
        let dy = y;
        let dw = w;
        let dh = h;
        if (el.config.fit !== 'stretch') {
          const s = el.config.fit === 'fit' ? Math.min(w / img.naturalWidth, h / img.naturalHeight) : Math.max(w / img.naturalWidth, h / img.naturalHeight);
          dw = img.naturalWidth * s;
          dh = img.naturalHeight * s;
          dx = x + (w - dw) / 2;
          dy = y + (h - dh) / 2;
          g.save();
          g.beginPath();
          g.rect(x, y, w, h);
          g.clip();
        }
        if (tinted) drawTinted(g, img, dx, dy, dw, dh, tint, B, O);
        else g.drawImage(img, dx, dy, dw, dh);
        if (el.config.fit !== 'stretch') g.restore();
      } else {
        g.strokeStyle = C('#888888');
        g.setLineDash([6, 4]);
        g.strokeRect(x, y, w, h);
      }
      break;
    }
    case 'rect': {
      const c = el.config;
      g.fillStyle = C(rr.color ?? c.fill);
      roundRect(g, x, y, w, h, c.radius);
      g.fill();
      if (c.strokeWidth > 0) {
        g.strokeStyle = C(c.stroke);
        g.lineWidth = c.strokeWidth;
        g.stroke();
      }
      break;
    }
    case 'line': {
      g.strokeStyle = C(rr.color ?? el.config.color);
      g.lineWidth = el.config.thickness;
      g.beginPath();
      g.moveTo(x, y + h / 2);
      g.lineTo(x + w, y + h / 2);
      g.stroke();
      break;
    }
    case 'circle': {
      const c = el.config;
      const r = Math.min(w, h) / 2;
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      g.fillStyle = C(rr.color ?? c.fill);
      g.fill();
      if (c.strokeWidth > 0) {
        g.strokeStyle = C(c.stroke);
        g.lineWidth = c.strokeWidth;
        g.stroke();
      }
      break;
    }
    case 'gauge': {
      const c = el.config;
      const value = Number(varValue(ctx, c.variable) ?? 0);
      const range = c.max - c.min || 1;
      const frac = clamp01((value - c.min) / range);
      const cx = x + w / 2;
      const cy = y + h / 2;
      const radius = Math.min(w, h) / 2 - c.thickness / 2;
      let a0 = (c.startAngle * Math.PI) / 180;
      let a1 = (c.endAngle * Math.PI) / 180;
      if (!c.clockwise) [a0, a1] = [a1, a0];
      const fill = rr.color ?? thresholdColor(value, c.color, c.thresholds);
      g.lineWidth = c.thickness;
      g.lineCap = 'butt';
      if (c.style === 'segments') {
        const n = Math.max(1, Math.floor(c.segments));
        const active = Math.floor(frac * n + 0.0001);
        const sweep = (a1 - a0) / n;
        const gapA = (c.gap * Math.PI) / 180;
        for (let i = 1; i <= n; i++) {
          g.beginPath();
          g.arc(cx, cy, radius, a0 + (i - 1) * sweep + gapA / 2, a0 + i * sweep - gapA / 2, sweep < 0);
          g.strokeStyle = C(i <= active ? fill : c.bgColor);
          g.stroke();
        }
      } else {
        g.beginPath();
        g.arc(cx, cy, radius, a0, a1, a1 < a0);
        g.strokeStyle = C(c.bgColor);
        g.stroke();
        if (frac > 0) {
          g.beginPath();
          g.arc(cx, cy, radius, a0, a0 + (a1 - a0) * frac, a1 < a0);
          g.strokeStyle = C(fill);
          g.stroke();
        }
      }
      break;
    }
  }
  g.restore();
}

const tintCanvas = document.createElement('canvas');

/** Dibuja una imagen multiplicada por un color (equivalente al parámetro color de ui.drawImage). */
function drawTinted(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, color: Color, brightness: number, opacity: number): void {
  const [r, gg, b, a] = parseColor(color);
  const tw = Math.max(1, Math.round(w));
  const th = Math.max(1, Math.round(h));
  tintCanvas.width = tw;
  tintCanvas.height = th;
  const t = tintCanvas.getContext('2d')!;
  t.clearRect(0, 0, tw, th);
  t.drawImage(img, 0, 0, tw, th);
  t.globalCompositeOperation = 'multiply';
  t.fillStyle = `rgb(${Math.min(255, r * brightness)},${Math.min(255, gg * brightness)},${Math.min(255, b * brightness)})`;
  t.fillRect(0, 0, tw, th);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(img, 0, 0, tw, th);
  t.globalCompositeOperation = 'source-over';
  g.save();
  g.globalAlpha = a * opacity;
  g.drawImage(tintCanvas, x, y, w, h);
  g.restore();
}

/* ---------- escena completa ---------- */

export function drawScene(g: CanvasRenderingContext2D, project: DisplayProject, page: Page, ctx: SimContext, env: DrawEnv, bgImage: HTMLImageElement | null): void {
  const { width, height } = project.canvas;
  g.save();
  g.beginPath();
  g.rect(0, 0, width, height);
  g.clip();
  g.fillStyle = css(project.background.color, env.brightness, 1);
  g.fillRect(0, 0, width, height);
  if (bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
    if (env.brightness !== 1) {
      g.drawImage(bgImage, 0, 0, width, height);
      g.fillStyle = `rgba(0,0,0,${1 - clamp01(env.brightness)})`;
      g.fillRect(0, 0, width, height);
    } else g.drawImage(bgImage, 0, 0, width, height);
  }
  for (const el of page.elements) drawElement(g, el, ctx, env);
  g.restore();
}
