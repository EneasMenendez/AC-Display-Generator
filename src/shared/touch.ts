/**
 * Pantallas táctiles.
 *
 * Cómo funciona en Assetto Corsa (CSP):
 *  - La sección del display admite `INTERACTIVE = 1`: CSP proyecta el puntero del ratón sobre la malla
 *    y lo traduce a las coordenadas en píxeles de la textura del display (coste extra en mallas con
 *    muchos polígonos, por eso solo se activa cuando hay botones).
 *  - Dentro del script, el puntero se consulta con las funciones de IMGUI en coordenadas del display:
 *    `ui.rectHovered(p1, p2)`, `ui.mouseClicked()`, `ui.mouseDown()`, `ui.mouseReleased()`.
 *    Es el mismo método que usan los ejemplos oficiales de CSP (Alfa Giulia QV, Ferrari SF70H).
 *  - Las acciones sobre el coche se hacen con la API de control de CSP: `ac.setKERS`, `ac.setDRS`,
 *    `ac.setHeadlights`, `ac.setTractionControl`, `ac.setExtraSwitch`…
 *  - No hay API para el limitador de boxes (se lee, no se escribe) ni para el freno de mano.
 *  - En VR el puntero depende de la integración de CSP (el SDK la da por incompleta): el ratón siempre
 *    funciona.
 *
 * Este módulo es la fuente de verdad compartida: el editor lo usa para simular las pulsaciones y el
 * runtime Lua (resources/runtime/acdg_runtime.lua) replica la misma tabla de acciones por id.
 */

import type { ButtonElement, DisplayProject, Page } from './model';

export type TouchActionId =
  | 'none'
  | 'page_next'
  | 'page_prev'
  | 'page_first'
  | 'page_go'
  | 'page_back'
  | 'boot_replay'
  | 'switch_toggle'
  | 'switch_on'
  | 'switch_off'
  | 'headlights'
  | 'high_beams'
  | 'daytime'
  | 'flash'
  | 'turn_left'
  | 'turn_right'
  | 'hazards'
  | 'turn_off'
  | 'wipers_next'
  | 'wipers_off'
  | 'kers'
  | 'drs'
  | 'mguk_delivery_up'
  | 'mguk_delivery_down'
  | 'mguk_recovery_up'
  | 'mguk_recovery_down'
  | 'mguh_toggle'
  | 'tc_up'
  | 'tc_down'
  | 'abs_up'
  | 'abs_down'
  | 'brake_bias_up'
  | 'brake_bias_down'
  | 'engine_brake_up'
  | 'engine_brake_down'
  | 'neutral'
  | 'autoshifter'
  | 'extra_a'
  | 'extra_b'
  | 'extra_c'
  | 'extra_d';

export type TouchGroup = 'Páginas' | 'Interruptores' | 'Luces' | 'Ayudas' | 'ERS / DRS' | 'Coche';

/** Cómo se simula la acción en el editor (en el juego la hace la API de CSP). */
export interface TouchSim {
  kind: 'toggle' | 'hold' | 'add' | 'on' | 'off';
  /** variable del catálogo que se modifica en la previsualización */
  variable: string;
  /** incremento para kind = add */
  step?: number;
  min?: number;
  max?: number;
}

export interface TouchActionDef {
  id: TouchActionId;
  label: string;
  group: TouchGroup;
  /** variable booleana que indica que la acción está activa (ilumina el botón) */
  stateVar?: string;
  /** usa el campo "Paso / valor" */
  usesStep?: boolean;
  /** solo tiene sentido con el comportamiento "mientras se mantiene" */
  holdOnly?: boolean;
  /** nota que se muestra en el panel */
  note?: string;
  sim?: TouchSim;
}

const A = (
  id: TouchActionId,
  label: string,
  group: TouchGroup,
  extra: Omit<TouchActionDef, 'id' | 'label' | 'group'> = {},
): TouchActionDef => ({ id, label, group, ...extra });

export const TOUCH_ACTIONS: TouchActionDef[] = [
  A('none', 'Sin acción (solo aspecto)', 'Páginas'),
  // páginas
  A('page_next', 'Página siguiente', 'Páginas'),
  A('page_prev', 'Página anterior', 'Páginas'),
  A('page_first', 'Primera página', 'Páginas'),
  A('page_go', 'Ir a una página concreta', 'Páginas', { note: 'Elige la página destino abajo.' }),
  A('page_back', 'Volver a la página anterior', 'Páginas'),
  A('boot_replay', 'Repetir la pantalla de arranque', 'Páginas'),
  // interruptores internos
  A('switch_toggle', 'Conmutar interruptor táctil', 'Interruptores', { note: 'Usa el interruptor como variable en reglas, iconos, condiciones de página…' }),
  A('switch_on', 'Activar interruptor táctil', 'Interruptores'),
  A('switch_off', 'Desactivar interruptor táctil', 'Interruptores'),
  // luces
  A('headlights', 'Luces (encender / apagar)', 'Luces', { stateVar: 'headlights', sim: { kind: 'toggle', variable: 'headlights' } }),
  A('high_beams', 'Luces largas', 'Luces', { stateVar: 'high_beams', sim: { kind: 'toggle', variable: 'high_beams' } }),
  A('daytime', 'Luces diurnas', 'Luces', { sim: { kind: 'toggle', variable: 'low_beams' } }),
  A('flash', 'Ráfaga', 'Luces', { holdOnly: true }),
  A('turn_left', 'Intermitente izquierdo', 'Luces', { stateVar: 'turn_left', sim: { kind: 'toggle', variable: 'turn_left' } }),
  A('turn_right', 'Intermitente derecho', 'Luces', { stateVar: 'turn_right', sim: { kind: 'toggle', variable: 'turn_right' } }),
  A('hazards', 'Luces de emergencia', 'Luces', { stateVar: 'hazards', sim: { kind: 'toggle', variable: 'hazards' } }),
  A('turn_off', 'Apagar intermitentes', 'Luces'),
  A('wipers_next', 'Limpiaparabrisas: velocidad siguiente', 'Luces', { sim: { kind: 'add', variable: 'car_wiperMode', step: 1, min: 0, max: 3 } }),
  A('wipers_off', 'Limpiaparabrisas: apagar', 'Luces', { sim: { kind: 'off', variable: 'car_wiperMode' } }),
  // ERS / DRS
  A('kers', 'KERS / ERS', 'ERS / DRS', { holdOnly: true, stateVar: 'kers_button', sim: { kind: 'hold', variable: 'kers_button' }, note: 'En los coches con KERS suele ser también el botón de launch control.' }),
  A('drs', 'DRS (abrir / cerrar)', 'ERS / DRS', { stateVar: 'drs_active', sim: { kind: 'toggle', variable: 'drs_active' } }),
  A('mguk_delivery_up', 'MGU-K entrega +', 'ERS / DRS', { sim: { kind: 'add', variable: 'car_mgukDelivery', step: 1, min: 0, max: 6 } }),
  A('mguk_delivery_down', 'MGU-K entrega −', 'ERS / DRS', { sim: { kind: 'add', variable: 'car_mgukDelivery', step: -1, min: 0, max: 6 } }),
  A('mguk_recovery_up', 'MGU-K recuperación +', 'ERS / DRS', { sim: { kind: 'add', variable: 'car_mgukRecovery', step: 1, min: 0, max: 10 } }),
  A('mguk_recovery_down', 'MGU-K recuperación −', 'ERS / DRS', { sim: { kind: 'add', variable: 'car_mgukRecovery', step: -1, min: 0, max: 10 } }),
  A('mguh_toggle', 'MGU-H: cargar batería / motor', 'ERS / DRS', { stateVar: 'car_mguhChargingBatteries', sim: { kind: 'toggle', variable: 'car_mguhChargingBatteries' } }),
  // ayudas
  A('tc_up', 'Control de tracción +', 'Ayudas', { sim: { kind: 'add', variable: 'tc_mode', step: 1, min: 0, max: 12 } }),
  A('tc_down', 'Control de tracción −', 'Ayudas', { sim: { kind: 'add', variable: 'tc_mode', step: -1, min: 0, max: 12 } }),
  A('abs_up', 'ABS +', 'Ayudas', { sim: { kind: 'add', variable: 'abs_mode', step: 1, min: 0, max: 12 } }),
  A('abs_down', 'ABS −', 'Ayudas', { sim: { kind: 'add', variable: 'abs_mode', step: -1, min: 0, max: 12 } }),
  A('brake_bias_up', 'Reparto de frenada hacia delante', 'Ayudas', { usesStep: true, sim: { kind: 'add', variable: 'brake_bias', step: 0.005, min: 0, max: 1 } }),
  A('brake_bias_down', 'Reparto de frenada hacia atrás', 'Ayudas', { usesStep: true, sim: { kind: 'add', variable: 'brake_bias', step: -0.005, min: 0, max: 1 } }),
  A('engine_brake_up', 'Freno motor +', 'Ayudas'),
  A('engine_brake_down', 'Freno motor −', 'Ayudas'),
  // coche
  A('neutral', 'Poner punto muerto', 'Coche'),
  A('autoshifter', 'Cambio automático', 'Coche', { stateVar: 'car_autoShift', sim: { kind: 'toggle', variable: 'car_autoShift' } }),
  A('extra_a', 'Interruptor Extra A del coche', 'Coche', { stateVar: 'extra_a', sim: { kind: 'toggle', variable: 'extra_a' } }),
  A('extra_b', 'Interruptor Extra B del coche', 'Coche', { stateVar: 'extra_b', sim: { kind: 'toggle', variable: 'extra_b' } }),
  A('extra_c', 'Interruptor Extra C del coche', 'Coche', { stateVar: 'extra_c', sim: { kind: 'toggle', variable: 'extra_c' } }),
  A('extra_d', 'Interruptor Extra D del coche', 'Coche', { stateVar: 'extra_d', sim: { kind: 'toggle', variable: 'extra_d' } }),
];

export const TOUCH_ACTION_MAP: Record<string, TouchActionDef> = Object.fromEntries(TOUCH_ACTIONS.map((a) => [a.id, a]));

export const TOUCH_GROUPS: TouchGroup[] = ['Páginas', 'Interruptores', 'Luces', 'Ayudas', 'ERS / DRS', 'Coche'];

/** Interruptores táctiles disponibles (variables touch_a … touch_f del catálogo). */
export const TOUCH_SWITCHES = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
export type TouchSwitchKey = (typeof TOUCH_SWITCHES)[number];

export function switchVar(key: string): string {
  return `touch_${key}`;
}

/** Acciones que leen o escriben un interruptor táctil. */
export function isSwitchAction(id: TouchActionId): boolean {
  return id === 'switch_toggle' || id === 'switch_on' || id === 'switch_off';
}

/** Variable booleana que indica que el botón está "encendido" (o undefined). */
export function buttonStateVar(el: ButtonElement): string | undefined {
  const def = TOUCH_ACTION_MAP[el.config.action];
  if (!def) return undefined;
  if (isSwitchAction(el.config.action)) return switchVar(el.config.switch || 'a');
  return def.stateVar;
}

/** Zona táctil del botón (la caja más su margen). */
export function buttonHitRect(el: ButtonElement): { x: number; y: number; width: number; height: number } {
  const p = Math.max(0, el.config.padding || 0);
  return { x: el.x - p, y: el.y - p, width: el.width + 2 * p, height: el.height + 2 * p };
}

/** Botón táctil bajo un punto de la pantalla (el de más arriba en el orden de dibujo). */
export function buttonAt(page: Page, x: number, y: number, isVisible?: (el: ButtonElement) => boolean): ButtonElement | null {
  for (let i = page.elements.length - 1; i >= 0; i--) {
    const el = page.elements[i];
    if (el.type !== 'button') continue;
    if (isVisible ? !isVisible(el) : !el.visible) continue;
    const r = buttonHitRect(el);
    if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return el;
  }
  return null;
}

/** true si el display tiene algo táctil (botones o gestos) y hay que escribir INTERACTIVE = 1. */
export function displayHasTouch(dp: DisplayProject): boolean {
  const t = dp.settings.touch;
  if (!t || t.mode === 'off') return false;
  if (t.mode === 'on') return true;
  if (t.swipePages) return true;
  return dp.pages.some((p) => p.elements.some((e) => e.type === 'button'));
}

/** Interruptores táctiles que usa el display (ids a..f, en orden). */
export function usedSwitches(dp: DisplayProject): string[] {
  const used = new Set<string>();
  for (const p of dp.pages) {
    for (const e of p.elements) {
      if (e.type === 'button' && isSwitchAction(e.config.action)) used.add(e.config.switch || 'a');
      for (const r of e.rules) if (r.when.variable?.startsWith('touch_')) used.add(r.when.variable.slice('touch_'.length));
    }
  }
  return TOUCH_SWITCHES.filter((k) => used.has(k));
}
