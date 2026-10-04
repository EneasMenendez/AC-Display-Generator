import type { ButtonElement } from '@shared/model';
import { TOUCH_ACTION_MAP, isSwitchAction, switchVar } from '@shared/touch';

/**
 * Simulación de las pulsaciones táctiles en el editor: réplica de la tabla ACTIONS del runtime Lua
 * (resources/runtime/acdg_runtime.lua). Las acciones sobre el coche no existen aquí, así que se
 * reflejan cambiando la variable equivalente de la simulación (luces, DRS, TC…) para poder ver el
 * resultado en la previsualización.
 */
export interface TouchSimApi {
  get(id: string): number | boolean | undefined;
  set(id: string, value: number | boolean): void;
  /** páginas normales: índice 0-based */
  stepPage(delta: number): void;
  gotoPage(index: number): void;
  /** índice de la página normal con ese id (o null) */
  indexOfPage(pageId: string | undefined): number | null;
  /** página anterior (acción "volver") */
  previousPage(): number;
  playBoot(): void;
  /** aviso para las acciones que solo ocurren en el juego */
  note(text: string): void;
}

export type TouchPhase = 'press' | 'hold' | 'release';

/** Ejecuta la acción de un botón táctil en la previsualización. */
export function fireTouch(el: ButtonElement, phase: TouchPhase, api: TouchSimApi): void {
  const c = el.config;
  const def = TOUCH_ACTION_MAP[c.action];
  if (!def || c.action === 'none') return;

  // interruptores internos
  if (isSwitchAction(c.action)) {
    if (phase !== 'press') return;
    const id = switchVar(c.switch || 'a');
    if (c.action === 'switch_toggle') api.set(id, api.get(id) !== true);
    else api.set(id, c.action === 'switch_on');
    return;
  }

  // páginas
  if (phase === 'press') {
    switch (c.action) {
      case 'page_next':
        api.stepPage(1);
        return;
      case 'page_prev':
        api.stepPage(-1);
        return;
      case 'page_first':
        api.gotoPage(0);
        return;
      case 'page_go': {
        const i = api.indexOfPage(c.pageId);
        if (i !== null) api.gotoPage(i);
        return;
      }
      case 'page_back':
        api.gotoPage(api.previousPage());
        return;
      case 'boot_replay':
        api.playBoot();
        return;
    }
  }

  const sim = def.sim;
  if (!sim) {
    if (phase === 'press') api.note(`${def.label}: solo tiene efecto en el juego`);
    return;
  }
  switch (sim.kind) {
    case 'toggle':
      if (phase === 'press') api.set(sim.variable, api.get(sim.variable) !== true);
      return;
    case 'on':
      if (phase === 'press') api.set(sim.variable, true);
      return;
    case 'off':
      if (phase === 'press') api.set(sim.variable, false);
      return;
    case 'hold':
      // mientras se mantiene (KERS): se activa al pulsar y se suelta al levantar
      api.set(sim.variable, phase !== 'release');
      return;
    case 'add': {
      if (phase !== 'press') return;
      const base = Number(api.get(sim.variable) ?? 0);
      const unit = sim.step ?? 1;
      const custom = c.step && c.step > 0 ? c.step * Math.sign(unit) : unit;
      let v = base + custom;
      if (sim.min !== undefined) v = Math.max(sim.min, v);
      if (sim.max !== undefined) v = Math.min(sim.max, v);
      api.set(sim.variable, v);
      return;
    }
  }
}
