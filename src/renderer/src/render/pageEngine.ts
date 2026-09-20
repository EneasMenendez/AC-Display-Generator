import type { DisplayProject, Page, PageCondition } from '@shared/model';
import type { SimContext } from '../sim';
import { compare } from './compare';

/**
 * Máquina de páginas del editor: réplica de la del runtime Lua (arranque > funcionalidad > condición
 * automática > botón), para que la previsualización se comporte como el coche.
 */
export interface EngineResult {
  page: Page;
  /** página anterior mientras dura la transición (fundido) */
  from: Page | null;
  /** progreso de la transición 0–1 (1 = terminada) */
  k: number;
  pageTime: number;
  entrySpeed: number;
  /** true en el frame en que cambia la página */
  changed: boolean;
}

export class PageEngine {
  private current: Page | null = null;
  private previous: Page | null = null;
  private enteredAt = 0;
  private entrySpeed = 0;
  private boot = { active: false, idx: 0, startedAt: 0 };
  private edges = new Map<string, boolean>();
  private toggles = new Map<string, { on: boolean; since: number }>();
  private lastRpm = 0;
  private manual = 0;
  private lastButton = false;
  private trans = { from: null as Page | null, startedAt: -1e9 };
  private bootRequested = false;

  reset(): void {
    this.current = null;
    this.previous = null;
    this.boot = { active: false, idx: 0, startedAt: 0 };
    this.edges.clear();
    this.toggles.clear();
    this.manual = 0;
    this.trans = { from: null, startedAt: -1e9 };
  }

  /** reproduce la secuencia de arranque en el siguiente paso */
  requestBoot(): void {
    this.bootRequested = true;
  }

  /** página manual (botón de cambio) para las pruebas del editor */
  setManual(i: number): void {
    this.manual = Math.max(0, i);
  }

  private pressed(key: string, value: unknown): boolean {
    const was = this.edges.get(key) === true;
    const now = value === true;
    this.edges.set(key, now);
    return now && !was;
  }

  private all(list: PageCondition[] | undefined, ctx: SimContext): boolean {
    return !list || list.every((c) => compare(ctx.values[c.variable], c.op, c.value, ctx));
  }

  private any(list: PageCondition[] | undefined, ctx: SimContext): boolean {
    return !!list && list.some((c) => compare(ctx.values[c.variable], c.op, c.value, ctx));
  }

  private startBoot(bootPages: Page[], t: number, ctx: SimContext, bs: DisplayProject['settings']['boot']): void {
    if (bootPages.length === 0) return;
    if (bs.skipInReplay && ctx.values.is_replay === true) return;
    this.boot = { active: true, idx: 0, startedAt: t };
  }

  step(display: DisplayProject, ctx: SimContext, t: number): EngineResult | null {
    const pages = display.pages;
    if (pages.length === 0) return null;
    const bs = display.settings.boot;
    const bootPages = pages.filter((p) => p.kind === 'boot');
    const funcPages = pages
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.kind === 'function' && p.trigger)
      .sort((a, b) => (b.p.trigger!.priority ?? 0) - (a.p.trigger!.priority ?? 0) || a.i - b.i)
      .map(({ p }) => p);
    const normalPages = pages.filter((p) => !p.kind || p.kind === 'normal');

    if (this.bootRequested) {
      this.bootRequested = false;
      this.startBoot(bootPages, t, ctx, bs);
    }

    let page: Page | null = null;
    // arranque
    if (this.boot.active) {
      const pg = bootPages[this.boot.idx];
      if (!pg) this.boot.active = false;
      else {
        let skip = false;
        if (bs.skipButton !== 'none' && this.pressed('boot:skip', ctx.values[bs.skipButton])) skip = true;
        if (bs.skipSpeedKmh > 0 && Number(ctx.values.speed ?? 0) > bs.skipSpeedKmh) skip = true;
        if (skip) this.boot.active = false;
        else if (t - this.boot.startedAt >= (pg.duration ?? 3)) {
          this.boot.idx++;
          this.boot.startedAt = t;
          if (this.boot.idx >= bootPages.length) this.boot.active = false;
        }
        if (this.boot.active) page = bootPages[this.boot.idx];
      }
    } else {
      if (bs.replayButton !== 'none' && this.pressed('boot:replay', ctx.values[bs.replayButton])) {
        this.startBoot(bootPages, t, ctx, bs);
        if (this.boot.active) page = bootPages[0];
      }
      if (bs.engineStart) {
        const rpm = Number(ctx.values.rpm ?? 0);
        if (this.lastRpm < 100 && rpm > 300) {
          this.startBoot(bootPages, t, ctx, bs);
          if (this.boot.active) page = bootPages[0];
        }
        this.lastRpm = rpm;
      }
    }
    // funcionalidad
    if (!page) {
      for (const pg of funcPages) {
        const tr = pg.trigger!;
        const input = ctx.values[tr.input] === true;
        let active: boolean;
        if (tr.mode === 'hold') active = input && this.all(tr.enter, ctx);
        else {
          let st = this.toggles.get(pg.id);
          if (!st) {
            st = { on: false, since: 0 };
            this.toggles.set(pg.id, st);
          }
          const edge = this.pressed(`fn:${pg.id}`, input);
          if (st.on) {
            if (this.any(tr.exit, ctx) || (tr.exitAfterS > 0 && t - st.since > tr.exitAfterS) || (tr.mode === 'toggle' && edge)) st.on = false;
          } else if (edge && this.all(tr.enter, ctx)) {
            st.on = true;
            st.since = t;
          }
          active = st.on;
        }
        if (active) {
          page = pg;
          break;
        }
      }
    }
    // normales: condición automática > botón
    if (!page && normalPages.length) {
      page = normalPages.find((pg) => pg.when && compare(ctx.values[pg.when.variable], pg.when.op, pg.when.value, ctx)) ?? null;
      if (!page) {
        const ps = display.settings.pageSwitch;
        if (ps.input !== 'none') {
          const pr = ctx.values[ps.input] === true;
          if (pr && !this.lastButton) {
            this.manual++;
            if (this.manual >= normalPages.length) this.manual = ps.wrap === false ? normalPages.length - 1 : 0;
          }
          this.lastButton = pr;
        }
        if (this.manual >= normalPages.length) this.manual = 0;
        page = normalPages[this.manual];
      }
    }
    if (!page) page = pages[0];

    let changed = false;
    if (page !== this.current) {
      const returnPrev = this.current?.trigger?.returnTo === 'previous' && this.previous;
      if (returnPrev && page !== this.previous && page.kind !== 'boot' && !page.trigger && this.previous!.kind !== 'function') page = this.previous!;
      this.previous = this.current;
      this.trans = { from: this.current, startedAt: t };
      this.current = page;
      this.enteredAt = t;
      this.entrySpeed = Number(ctx.values.speed ?? 0);
      changed = true;
    }
    const fadeS = bs.transition === 'fade' ? bs.transitionS : 0;
    const k = fadeS > 0 && this.trans.from && t - this.trans.startedAt < fadeS ? Math.max(0, Math.min(1, (t - this.trans.startedAt) / fadeS)) : 1;
    return { page, from: k < 1 ? this.trans.from : null, k, pageTime: t - this.enteredAt, entrySpeed: this.entrySpeed, changed };
  }
}
