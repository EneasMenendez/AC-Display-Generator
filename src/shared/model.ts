/**
 * Modelo de datos del proyecto (.acdisplay/project.json).
 * Es la única fuente de verdad: el editor lo renderiza y el generador lo traduce a display_config.lua.
 */

import type { TouchActionId } from './touch';

export const PROJECT_FORMAT_VERSION = 2;

/** Color en formato #RRGGBB o #RRGGBBAA. */
export type Color = string;

/**
 * Valor de RPM: número absoluto o porcentaje del limitador real del coche ("85%").
 * El runtime lo resuelve con car.rpmLimiter; el editor con defaults.rpm_limiter del perfil.
 */
export type RpmValue = number | `${number}%`;

export type Orientation = 'horizontal' | 'vertical';
export type BarStyle = 'continuous' | 'segments';
export type TextAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

export type ElementType =
  | 'text'
  | 'rpm_bar'
  | 'shift_light'
  | 'bar'
  | 'gear'
  | 'icon'
  | 'image'
  | 'rect'
  | 'line'
  | 'circle'
  | 'gauge'
  | 'shift_lights'
  | 'needle'
  | 'video'
  | 'button';

export type RuleOp = '>' | '>=' | '<' | '<=' | '==' | '!=';

/** Regla de estado: cuando la variable cumple la condición se aplican las propiedades de `set`. */
export interface Rule {
  id: string;
  when: { variable: string; op: RuleOp; value: number | boolean | RpmValue };
  set: {
    color?: Color;
    visible?: boolean;
    opacity?: number;
    blinkHz?: number;
    image?: string;
  };
}

export interface ElementBase {
  /** animación de entrada/salida (opcional) */
  anim?: ElementAnim;
  id: string;
  type: ElementType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  rules: Rule[];
}

export interface TextStyle {
  font: string;
  size: number;
  color: Color;
  align: TextAlign;
  valign: VAlign;
  bold: boolean;
  letterSpacing: number;
}

export type TimeFormat = 'm:ss.mmm' | "m'ss\"mm" | 'm:ss.m' | 'ss.mmm' | 'h:mm:ss';

export interface TextBinding {
  /** id de variable del catálogo; si es undefined se usa staticText */
  variable?: string;
  staticText?: string;
  decimals: number;
  prefix: string;
  suffix: string;
  /** unidad de presentación (km/h, mph, °C, °F, bar, psi, L, gal) — vacío = unidad base */
  unit?: string;
  timeFormat?: TimeFormat;
  /** sustituciones de valor → texto (ej. marcha -1 → R) */
  map?: Record<string, string>;
  padZeros: number;
  showSign: boolean;
  /** frecuencia de actualización propia del texto (Hz); 0/undefined = la del display */
  updateHz?: number;
}

export interface TextElement extends ElementBase {
  type: 'text';
  binding: TextBinding;
  style: TextStyle;
}

/**
 * Luminancia y destello de una luz encendida.
 * - size: radio del halo en px (0 = sin halo); intensity: opacidad del halo (0–1)
 * - luminance: brillo de la luz (1 = color tal cual; >1 satura hacia blanco y, en pantallas HDR/emisivas, sobreexpone para que CSP la haga florecer)
 * - core: núcleo caliente (0–1): centro blanquecino de la luz, proporcional a la luminancia
 */
export interface Glow {
  size: number;
  intensity: number;
  luminance?: number;
  core?: number;
}

export const DEFAULT_GLOW: Glow = { size: 0, intensity: 0.6, luminance: 1, core: 0.5 };

export interface RpmBarConfig {
  orientation: Orientation;
  /** sentido de llenado: false = izquierda→derecha / abajo→arriba */
  reverse: boolean;
  style: BarStyle;
  segments: number;
  gap: number;
  radius: number;
  min: RpmValue;
  max: RpmValue;
  warning: RpmValue;
  redline: RpmValue;
  colors: { normal: Color; warning: Color; redline: Color; limiter: Color; off: Color };
  /** parpadeo cuando el coche toca el limitador; 0 = sin parpadeo */
  limiterBlinkHz: number;
  /** fracción del ciclo de parpadeo que está encendido (0,1–0,9); por defecto 0,5 */
  blinkDuty?: number;
  /** destello de los segmentos encendidos (estilo segmentos) */
  glow?: Glow;
  /** colorea cada segmento según su propia zona (true) o toda la barra según el régimen actual (false) */
  perSegmentColors: boolean;
  /** textura personalizada (estilo continuo): se descubre según el llenado; asset del proyecto */
  fillImage?: string;
  /** textura de fondo (parte sin llenar) */
  bgImage?: string;
  /** teñir la textura de llenado con el color de la zona actual */
  tintImage?: boolean;
}

export interface RpmBarElement extends ElementBase {
  type: 'rpm_bar';
  config: RpmBarConfig;
}

export interface ShiftLightConfig {
  rpmOn: RpmValue;
  rpmOff: RpmValue;
  shape: 'circle' | 'rect';
  colorOn: Color;
  colorOff: Color;
  blinkHz: number;
  blinkDuty?: number;
  radius: number;
  glow?: Glow;
}

export interface ShiftLightElement extends ElementBase {
  type: 'shift_light';
  config: ShiftLightConfig;
}

/** Tira de luces de cambio: varios LEDs que se encienden progresivamente entre dos regímenes. */
export interface ShiftLightsConfig {
  count: number;
  orientation: Orientation;
  shape: 'circle' | 'rect';
  gap: number;
  radius: number;
  /** régimen al que se enciende el primer LED */
  rpmStart: RpmValue;
  /** régimen al que están todos encendidos */
  rpmEnd: RpmValue;
  /** orden de encendido */
  pattern: 'left_to_right' | 'edges_to_center' | 'center_to_edges';
  /** colores por tramos, en orden de encendido (p. ej. 4 verdes, 3 amarillos, 3 rojos) */
  zones: { count: number; color: Color }[];
  colorOff: Color;
  /** los LEDs apagados se dibujan con colorOff (true) o se ocultan */
  dimOff: boolean;
  /** al llegar al limitador todos parpadean con limiterColor; 0 = sin parpadeo */
  limiterBlinkHz: number;
  limiterColor: Color;
  blinkDuty?: number;
  /** destello de los LEDs encendidos */
  glow?: Glow;
  /** textura opcional del LED (se tiñe con el color); asset del proyecto */
  image?: string;
}

export interface ShiftLightsElement extends ElementBase {
  type: 'shift_lights';
  config: ShiftLightsConfig;
}

/**
 * Aguja: gira alrededor de un eje (pivot, en píxeles respecto a la esquina superior izquierda del elemento)
 * entre angleMin y angleMax según la variable. Sin imagen se dibuja una aguja simple desde el eje hasta
 * el centro del borde superior de la caja.
 */
export interface NeedleConfig {
  variable: string;
  min: number;
  max: number;
  /** ángulo (grados, horario) para min y para max; 0 = la aguja tal y como está dibujada */
  angleMin: number;
  angleMax: number;
  pivot: { x: number; y: number };
  /** textura de la aguja (asset del proyecto), dibujada sin girar en la caja del elemento */
  image?: string;
  /** color de la aguja simple / tinte de la textura */
  color: Color;
  thickness: number;
  hubRadius: number;
  hubColor: Color;
  /** suavizado en ms; 0 = instantáneo */
  smoothingMs: number;
  /** limitar el valor a [min, max] */
  clamp: boolean;
}

export interface NeedleElement extends ElementBase {
  type: 'needle';
  config: NeedleConfig;
}

/** Vídeo (ui.MediaPlayer de CSP): se reinicia al entrar en la página; en el editor se previsualiza con HTML5. */
export interface VideoElement extends ElementBase {
  type: 'video';
  config: {
    /** asset del proyecto (mp4/webm/wmv…) */
    file: string;
    fit: 'stretch' | 'fit' | 'fill';
    loop: boolean;
    muted: boolean;
    volume: number;
    /** velocidad de reproducción (1 = normal) */
    rate: number;
    tint: Color;
    /** al terminar (sin bucle): mantener el último frame u ocultarse */
    onEnd: 'hold' | 'hide';
  };
}

/**
 * Botón táctil. En el juego funciona con `INTERACTIVE = 1` en la sección del display: CSP proyecta el
 * puntero sobre la malla y el runtime consulta `ui.rectHovered` / `ui.mouseClicked` en coordenadas de
 * la textura. Ver src/shared/touch.ts para el catálogo de acciones.
 */
export interface ButtonConfig {
  /** qué hace al pulsarlo */
  action: TouchActionId;
  /** página destino (action = page_go) */
  pageId?: string;
  /** interruptor táctil que usa (acciones switch_*): a…f → variable touch_a…touch_f */
  switch: string;
  /** paso de las acciones numéricas (reparto de frenada…); 0 = el de la acción */
  step: number;
  /** tap = al pulsar; hold = mientras se mantiene; repeat = repite mientras se mantiene */
  behavior: 'tap' | 'hold' | 'repeat';
  /** intervalo de repetición en ms (behavior = repeat) */
  repeatMs: number;
  /** forma del fondo; none = solo texto/imagen */
  shape: 'rect' | 'circle' | 'none';
  fill: Color;
  /** color con el puntero encima */
  fillHover: Color;
  /** color mientras se mantiene pulsado */
  fillActive: Color;
  /** color cuando su acción está activa (interruptor puesto, luces encendidas…) */
  fillOn: Color;
  stroke: Color;
  strokeWidth: number;
  radius: number;
  /** imagen del botón (asset del proyecto) */
  image?: string;
  /** imagen cuando está activo */
  imageOn?: string;
  label: string;
  /** texto cuando está activo (vacío = el mismo) */
  labelOn?: string;
  style: TextStyle;
  /** color del texto cuando está activo */
  colorOn: Color;
  /** iluminar el botón cuando su acción está activa */
  litWhenOn: boolean;
  /** destello del botón encendido */
  glow?: Glow;
  /** amplía la zona táctil respecto a la caja dibujada (px) */
  padding: number;
}

export interface ButtonElement extends ElementBase {
  type: 'button';
  config: ButtonConfig;
}

export interface Threshold {
  value: number;
  color: Color;
}

export interface BarConfig {
  variable: string;
  min: number;
  max: number;
  orientation: Orientation;
  reverse: boolean;
  style: BarStyle;
  segments: number;
  gap: number;
  radius: number;
  colorFill: Color;
  colorBg: Color;
  thresholds: Threshold[];
  /** barra con centro en cero (delta, G laterales) */
  bipolar: boolean;
  /** suavizado en ms; 0 = instantáneo */
  smoothingMs: number;
  /** textura personalizada (estilo continuo): se descubre según el llenado */
  fillImage?: string;
  bgImage?: string;
  /** teñir la textura de llenado con el color de la barra/umbral */
  tintImage?: boolean;
}

export interface BarElement extends ElementBase {
  type: 'bar';
  config: BarConfig;
}

export interface GearConfig {
  style: TextStyle;
  map: Record<string, string>;
  limiterColor?: Color;
}

export interface GearElement extends ElementBase {
  type: 'gear';
  config: GearConfig;
}

export interface IconConfig {
  /** id de icono integrado ("builtin:abs") o ruta de asset del proyecto ("assets/icons/x.png") */
  icon: string;
  variable?: string;
  /** cuándo se muestra: always | when_true | when_false */
  showWhen: 'always' | 'when_true' | 'when_false';
  colorOn: Color;
  colorOff: Color;
  /** si es false se oculta en vez de usar colorOff */
  dimWhenOff: boolean;
}

export interface IconElement extends ElementBase {
  type: 'icon';
  config: IconConfig;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  config: { file: string; tint: Color; fit: 'stretch' | 'fit' | 'fill' };
}

export interface RectElement extends ElementBase {
  type: 'rect';
  config: { fill: Color; stroke: Color; strokeWidth: number; radius: number };
}

export interface LineElement extends ElementBase {
  type: 'line';
  config: { color: Color; thickness: number };
}

export interface CircleElement extends ElementBase {
  type: 'circle';
  config: { fill: Color; stroke: Color; strokeWidth: number };
}

export interface GaugeConfig {
  variable: string;
  min: number;
  max: number;
  startAngle: number;
  endAngle: number;
  thickness: number;
  color: Color;
  bgColor: Color;
  clockwise: boolean;
  thresholds: Threshold[];
  style: 'arc' | 'segments';
  segments: number;
  gap: number;
}

export interface GaugeElement extends ElementBase {
  type: 'gauge';
  config: GaugeConfig;
}

export type DisplayElement =
  | TextElement
  | RpmBarElement
  | ShiftLightElement
  | BarElement
  | GearElement
  | IconElement
  | ImageElement
  | RectElement
  | LineElement
  | CircleElement
  | GaugeElement
  | ShiftLightsElement
  | NeedleElement
  | VideoElement
  | ButtonElement;

/** Condición que activa automáticamente una página (p. ej. "Boxes" cuando car.isInPitlane). */
export interface PageCondition {
  variable: string;
  op: RuleOp;
  value: number | boolean | RpmValue;
}

/** normal = página de datos; boot = pantalla de arranque (secuencia temporizada); function = pantalla de funcionalidad (activada por botón) */
export type PageKind = 'normal' | 'boot' | 'function';

/** Activador de una pantalla de funcionalidad (launch control, ajustes, estrategia…). */
export interface PageTrigger {
  /** variable booleana del catálogo que la activa: kers_button, extra_a…h, drs_active, handbrake_on, clutch_full, pit_limiter… */
  input: string;
  /** hold = mientras se mantiene; toggle = una pulsación entra y otra sale; latch = entra con el botón y sale por condición */
  mode: 'hold' | 'toggle' | 'latch';
  /** condiciones que deben cumplirse para entrar (todas) */
  enter: PageCondition[];
  /** condiciones que la cierran (cualquiera) — modos toggle y latch */
  exit: PageCondition[];
  /** se cierra sola pasados estos segundos; 0 = nunca */
  exitAfterS: number;
  /** si varias están activas gana la de mayor prioridad */
  priority: number;
  /** al salir: volver a la página anterior o a la principal */
  returnTo: 'previous' | 'main';
}

export interface Page {
  id: string;
  name: string;
  /** orden de dibujo: el primero se pinta debajo */
  elements: DisplayElement[];
  /** si se cumple, esta página se muestra automáticamente (prioridad por orden); si no, se usa la seleccionada por botón */
  when?: PageCondition;
  /** condiciones automáticas adicionales: la página se muestra si se cumple `when` O cualquiera de estas */
  whenAny?: PageCondition[];
  kind?: PageKind;
  /** duración en segundos (pantallas de arranque) */
  duration?: number;
  trigger?: PageTrigger;
}

/** Animación de entrada/salida de un elemento respecto al momento en que se muestra su página. */
export interface ElementAnim {
  /** segundos hasta aparecer */
  delay: number;
  /** duración del fundido de entrada */
  fadeIn: number;
  /** fundido de salida antes de acabar la página (solo pantallas de arranque) */
  fadeOut: number;
  /** desplazamiento de entrada */
  from: 'none' | 'up' | 'down' | 'left' | 'right';
  distance: number;
}

/** Secuencia de arranque de un display. */
export interface BootSettings {
  /** botón que vuelve a reproducirla ('none' o variable booleana) */
  replayButton: string;
  /** reproducirla también al arrancar el motor (rpm de 0 a >300) */
  engineStart: boolean;
  /** botón para saltarla */
  skipButton: string;
  /** saltarla si el coche supera esta velocidad (km/h); 0 = no */
  skipSpeedKmh: number;
  /** omitirla en replays */
  skipInReplay: boolean;
  /** transición al terminar (y entre pantallas de funcionalidad) */
  transition: 'cut' | 'fade';
  transitionS: number;
  /** sonido de arranque (asset del proyecto) */
  sound?: string;
  soundVolume: number;
}

export const DEFAULT_BOOT: BootSettings = { replayButton: 'none', engineStart: false, skipButton: 'none', skipSpeedKmh: 0, skipInReplay: true, transition: 'fade', transitionS: 0.5, soundVolume: 1 };
export const DEFAULT_ANIM: ElementAnim = { delay: 0, fadeIn: 0, fadeOut: 0, from: 'none', distance: 60 };

export function createTrigger(input = 'kers_button'): PageTrigger {
  return { input, mode: 'hold', enter: [], exit: [], exitAfterS: 0, priority: 1, returnTo: 'previous' };
}

/** Entrada de CSP (botón del volante / tecla extra) que pasa a la siguiente página. */
export type PageSwitchInput = 'none' | 'extraA' | 'extraB' | 'extraC' | 'extraD' | 'extraE' | 'extraF' | 'extraG' | 'extraH';

/**
 * Botón físico del coche: una malla (o parte de ella) del modelo 3D que se puede pulsar con el ratón.
 * CSP lo resuelve con `ac.isMeshPressed` (un raycast contra la malla, solo mientras se pulsa el ratón),
 * así que no necesita que la pantalla sea táctil. Lo atiende el script del display al que pertenece.
 */
export interface PhysicalButton {
  id: string;
  name: string;
  /** malla o nodo del modelo; varias con la sintaxis de CSP: "{ mesh1, mesh2 }" */
  mesh: string;
  /** limitar la zona sensible a una región de la UV de la malla (0–1) */
  uv?: { x: number; y: number; width: number; height: number };
  /** limitar la zona sensible a una esfera alrededor de un punto (coordenadas del coche, metros) */
  point?: { x: number; y: number; z: number };
  /** radio de esa esfera en metros */
  radius?: number;
  /** el punto está en coordenadas locales de la malla, no del coche */
  localPoint?: boolean;
  /** qué hace (mismo catálogo que los botones táctiles) */
  action: TouchActionId;
  /** página destino (action = page_go) */
  pageId?: string;
  /** interruptor táctil que usa (acciones switch_*) */
  switch: string;
  step: number;
  behavior: 'tap' | 'hold' | 'repeat';
  repeatMs: number;
}

export function createPhysicalButton(mesh = ''): PhysicalButton {
  return {
    id: newId('pbtn'),
    name: mesh || 'Botón físico',
    mesh,
    action: 'page_next',
    switch: 'a',
    step: 0,
    behavior: 'tap',
    repeatMs: 250,
  };
}

/** Un interruptor táctil del display (variable touch_<key> del catálogo). */
export interface TouchSwitchDef {
  /** a…f */
  key: string;
  label: string;
  /** estado al cargar el coche */
  initial: boolean;
  /** recordarlo entre sesiones (ac.storage) */
  remember: boolean;
}

/** Configuración táctil del display (INTERACTIVE = 1 y gestos). */
export interface TouchSettings {
  /** auto = táctil solo si hay botones o gestos; on = siempre; off = nunca */
  mode: 'auto' | 'on' | 'off';
  /** resaltar el botón que está bajo el puntero */
  hover: boolean;
  /** deslizar en horizontal cambia de página */
  swipePages: boolean;
  /** recorrido mínimo del deslizamiento, en % del ancho de la pantalla */
  swipePct: number;
  /** interruptores usados por los botones */
  switches: TouchSwitchDef[];
}

export const DEFAULT_TOUCH: TouchSettings = { mode: 'auto', hover: true, swipePages: false, swipePct: 25, switches: [] };

export interface PageSwitch {
  input: PageSwitchInput;
  /** volver a la primera página tras la última */
  wrap: boolean;
  /** recordar la página elegida entre sesiones (ac.storage) */
  remember: boolean;
}

export interface ProjectSettings {
  units: 'auto' | 'metric' | 'imperial';
  brightness: number;
  nightBrightness: number;
  nightMode: 'off' | 'headlights' | 'time';
  grid: number;
  snap: boolean;
  snapToElements: boolean;
  showCoordinates: boolean;
  pageSwitch: PageSwitch;
  /** frecuencia de refresco del display en el juego (Hz); 0 = cada frame */
  refreshHz: number;
  boot: BootSettings;
  /** pantalla táctil (botones y gestos) */
  touch: TouchSettings;
}

/** Un display (una malla del coche) con sus páginas. Un proyecto puede tener varios (dash, volante, navegador…). */
export interface DisplayProject {
  display_id: string;
  /** nombre visible (por defecto el del perfil) */
  name: string;
  canvas: { width: number; height: number };
  background: { file: string | null; locked: boolean; color: Color };
  settings: ProjectSettings;
  pages: Page[];
  /** fuentes importadas: nombre → ruta relativa dentro de assets/fonts */
  fonts: Record<string, string>;
  /** botones físicos del coche atendidos por el script de este display */
  physicalButtons?: PhysicalButton[];
}

/**
 * Aguja física del coche (nodo del kn5 que gira con un valor), configurada con la sección
 * [ANALOG_INDICATOR_...] de CSP. No forma parte de ningún display.
 */
export interface PhysicalNeedle {
  id: string;
  name: string;
  /** nombre del nodo/malla de la aguja en el modelo (OBJECT_NAME) */
  object: string;
  /** entrada de CSP (RPM, SPEED, FUEL, WATER_TEMP, OIL_PRESSURE, …) */
  input: string;
  /** tabla valor → ángulo (grados); CSP interpola entre puntos */
  lut: { value: number; angle: number }[];
  /** límites del valor de entrada (opcional) */
  lowerBound?: number;
  upperBound?: number;
  /** retardo de la aguja al subir/bajar (0–1; 0 = instantáneo, 0,8–0,99 = suave) */
  lagUp: number;
  lagDown: number;
  /** retardo adicional dependiente de la velocidad de cambio (opcional, 0–1) */
  speedLag?: number;
  /** bloques ini adicionales que se añaden a la sección tal cual */
  extra?: string;
}

export const NEEDLE_INPUTS: { id: string; label: string; unit: string; range: [number, number] }[] = [
  { id: 'RPM', label: 'Régimen (rpm)', unit: 'rpm', range: [0, 9000] },
  { id: 'SPEED', label: 'Velocidad (km/h)', unit: 'km/h', range: [0, 300] },
  { id: 'FUEL', label: 'Combustible (L)', unit: 'L', range: [0, 60] },
  { id: 'WATER_TEMP', label: 'Temperatura de agua (°C)', unit: '°C', range: [40, 130] },
  { id: 'OIL_TEMP', label: 'Temperatura de aceite (°C)', unit: '°C', range: [40, 150] },
  { id: 'OIL_PRESSURE', label: 'Presión de aceite (bar)', unit: 'bar', range: [0, 10] },
  { id: 'TURBO', label: 'Presión de turbo (bar)', unit: 'bar', range: [-1, 2] },
  { id: 'BATTERY', label: 'Voltaje de batería (V)', unit: 'V', range: [8, 16] },
  { id: 'GAS', label: 'Acelerador (0–1)', unit: '', range: [0, 1] },
  { id: 'BRAKE', label: 'Freno (0–1)', unit: '', range: [0, 1] },
  { id: 'CLUTCH', label: 'Embrague (0–1)', unit: '', range: [0, 1] },
  { id: 'HANDBRAKE', label: 'Freno de mano (0–1)', unit: '', range: [0, 1] },
  { id: 'STEER', label: 'Volante (grados)', unit: '°', range: [-450, 450] },
  { id: 'G_FORCE', label: 'Fuerza G longitudinal', unit: 'g', range: [-2, 2] },
  { id: 'G_FORCE_LATERAL', label: 'Fuerza G lateral', unit: 'g', range: [-2, 2] },
  { id: 'PERF_METER_DIFF', label: 'Delta de vuelta (s)', unit: 's', range: [-5, 5] },
];

export function createPhysicalNeedle(object = '', input = 'RPM'): PhysicalNeedle {
  const def = NEEDLE_INPUTS.find((i) => i.id === input) ?? NEEDLE_INPUTS[0];
  return {
    id: newId('needle'),
    name: object || def.label,
    object,
    input,
    lut: [
      { value: def.range[0], angle: -120 },
      { value: def.range[1], angle: 120 },
    ],
    lowerBound: def.range[0],
    upperBound: def.range[1],
    lagUp: 0.8,
    lagDown: 0.8,
  };
}

export interface Project {
  format_version: number;
  app_version: string;
  name: string;
  profile: { id: string; version: number };
  car_id: string;
  displays: DisplayProject[];
  /** agujas físicas del coche ([ANALOG_INDICATOR_...] de CSP) */
  physicalNeedles: PhysicalNeedle[];
}

/* ---------- Fábricas ---------- */

let seq = 0;
export function newId(prefix = 'el'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  font: 'Segoe UI',
  size: 64,
  color: '#FFFFFF',
  align: 'center',
  valign: 'middle',
  bold: true,
  letterSpacing: 0,
};

export const DEFAULT_SETTINGS: ProjectSettings = {
  units: 'auto',
  brightness: 1,
  nightBrightness: 0.6,
  nightMode: 'off',
  grid: 8,
  snap: true,
  snapToElements: true,
  showCoordinates: true,
  pageSwitch: { input: 'none', wrap: true, remember: true },
  refreshHz: 0,
  boot: { ...DEFAULT_BOOT },
  touch: { ...DEFAULT_TOUCH },
};

function base(type: ElementType, name: string, x: number, y: number, w: number, h: number): ElementBase {
  return { id: newId(), type, name, x, y, width: w, height: h, rotation: 0, visible: true, locked: false, opacity: 1, rules: [] };
}

export function createElement(type: ElementType, x = 100, y = 100): DisplayElement {
  switch (type) {
    case 'text':
      return {
        ...base(type, 'Texto', x, y, 260, 90),
        type,
        binding: { variable: 'speed', decimals: 0, prefix: '', suffix: '', padZeros: 0, showSign: false },
        style: { ...DEFAULT_TEXT_STYLE },
      };
    case 'rpm_bar':
      return {
        ...base(type, 'Barra RPM', x, y, 900, 80),
        type,
        config: {
          orientation: 'horizontal',
          reverse: false,
          style: 'segments',
          segments: 16,
          gap: 6,
          radius: 4,
          min: 0,
          max: '100%',
          warning: '85%',
          redline: '95%',
          colors: { normal: '#28C840', warning: '#FFB000', redline: '#FF2D2D', limiter: '#2D7BFF', off: '#262626' },
          limiterBlinkHz: 8,
          perSegmentColors: true,
        },
      };
    case 'shift_light':
      return {
        ...base(type, 'Shift light', x, y, 70, 70),
        type,
        config: { rpmOn: '94%', rpmOff: '90%', shape: 'circle', colorOn: '#2D7BFF', colorOff: '#1A1A1A', blinkHz: 0, blinkDuty: 0.5, radius: 8, glow: { size: 16, intensity: 0.7, luminance: 1.5, core: 0.5 } },
      };
    case 'bar':
      return {
        ...base(type, 'Barra', x, y, 300, 30),
        type,
        config: {
          variable: 'throttle',
          min: 0,
          max: 1,
          orientation: 'horizontal',
          reverse: false,
          style: 'continuous',
          segments: 10,
          gap: 4,
          radius: 3,
          colorFill: '#28C840',
          colorBg: '#262626',
          thresholds: [],
          bipolar: false,
          smoothingMs: 0,
        },
      };
    case 'gear':
      return {
        ...base(type, 'Marcha', x, y, 200, 240),
        type,
        config: {
          style: { ...DEFAULT_TEXT_STYLE, size: 220 },
          map: { '-1': 'R', '0': 'N' },
          limiterColor: '#FF2D2D',
        },
      };
    case 'icon':
      return {
        ...base(type, 'Icono', x, y, 80, 80),
        type,
        config: { icon: 'builtin:abs', variable: 'abs_active', showWhen: 'when_true', colorOn: '#FFB000', colorOff: '#333333', dimWhenOff: true },
      };
    case 'image':
      return { ...base(type, 'Imagen', x, y, 200, 200), type, config: { file: '', tint: '#FFFFFF', fit: 'stretch' } };
    case 'rect':
      return { ...base(type, 'Rectángulo', x, y, 200, 100), type, config: { fill: '#000000AA', stroke: '#FFFFFF00', strokeWidth: 0, radius: 0 } };
    case 'line':
      return { ...base(type, 'Línea', x, y, 300, 4), type, config: { color: '#FFFFFF', thickness: 4 } };
    case 'circle':
      return { ...base(type, 'Círculo', x, y, 120, 120), type, config: { fill: '#FFFFFF', stroke: '#FFFFFF00', strokeWidth: 0 } };
    case 'shift_lights':
      return {
        ...base(type, 'Luces de cambio', x, y, 600, 50),
        type,
        config: {
          count: 10,
          orientation: 'horizontal',
          shape: 'circle',
          gap: 10,
          radius: 6,
          rpmStart: '70%',
          rpmEnd: '97%',
          pattern: 'left_to_right',
          zones: [
            { count: 4, color: '#28C840' },
            { count: 3, color: '#FFB000' },
            { count: 3, color: '#FF2D2D' },
          ],
          colorOff: '#1A1A1A',
          dimOff: true,
          limiterBlinkHz: 8,
          limiterColor: '#2D7BFF',
          blinkDuty: 0.5,
          glow: { size: 14, intensity: 0.7, luminance: 1.5, core: 0.5 },
        },
      };
    case 'video':
      return { ...base(type, 'Vídeo', x, y, 640, 360), type, config: { file: '', fit: 'fit', loop: false, muted: true, volume: 1, rate: 1, tint: '#FFFFFF', onEnd: 'hold' } };
    case 'needle':
      return {
        ...base(type, 'Aguja', x, y, 40, 220),
        type,
        config: {
          variable: 'rpm',
          min: 0,
          max: 8000,
          angleMin: -120,
          angleMax: 120,
          pivot: { x: 20, y: 200 },
          color: '#FF2D2D',
          thickness: 8,
          hubRadius: 14,
          hubColor: '#DDDDDD',
          smoothingMs: 80,
          clamp: true,
        },
      };
    case 'button':
      return {
        ...base(type, 'Botón', x, y, 240, 96),
        type,
        config: {
          action: 'page_next',
          switch: 'a',
          step: 0,
          behavior: 'tap',
          repeatMs: 250,
          shape: 'rect',
          fill: '#15181DCC',
          fillHover: '#262B33DD',
          fillActive: '#39404CEE',
          fillOn: '#2D7BFF66',
          stroke: '#FFFFFF44',
          strokeWidth: 2,
          radius: 12,
          label: 'Botón',
          style: { ...DEFAULT_TEXT_STYLE, size: 36, bold: false },
          colorOn: '#FFFFFF',
          litWhenOn: true,
          padding: 0,
          glow: { size: 14, intensity: 0.6, luminance: 1.3, core: 0 },
        },
      };
    case 'gauge':
      return {
        ...base(type, 'Indicador circular', x, y, 300, 300),
        type,
        config: {
          variable: 'water_temp',
          min: 40,
          max: 130,
          startAngle: 135,
          endAngle: 405,
          thickness: 24,
          color: '#28C840',
          bgColor: '#262626',
          clockwise: true,
          thresholds: [{ value: 110, color: '#FF2D2D' }],
          style: 'arc',
          segments: 20,
          gap: 3,
        },
      };
  }
}

export function createDisplayProject(params: { displayId: string; name: string; width: number; height: number }): DisplayProject {
  return {
    display_id: params.displayId,
    name: params.name,
    canvas: { width: params.width, height: params.height },
    background: { file: null, locked: true, color: '#000000' },
    settings: { ...DEFAULT_SETTINGS, pageSwitch: { ...DEFAULT_SETTINGS.pageSwitch }, touch: { ...DEFAULT_TOUCH, switches: [] } },
    pages: [{ id: 'main', name: 'Principal', elements: [] }],
    fonts: {},
    physicalButtons: [],
  };
}

export function createEmptyProject(params: {
  name: string;
  profileId: string;
  profileVersion: number;
  carId: string;
  appVersion: string;
  displays: { displayId: string; name: string; width: number; height: number }[];
}): Project {
  return {
    format_version: PROJECT_FORMAT_VERSION,
    app_version: params.appVersion,
    name: params.name,
    profile: { id: params.profileId, version: params.profileVersion },
    car_id: params.carId,
    displays: params.displays.map(createDisplayProject),
    physicalNeedles: [],
  };
}

export function createPage(name: string, kind: PageKind = 'normal'): Page {
  const p: Page = { id: newId('page'), name, elements: [] };
  if (kind === 'boot') {
    p.kind = 'boot';
    p.duration = 3;
  } else if (kind === 'function') {
    p.kind = 'function';
    p.trigger = createTrigger();
  }
  return p;
}

/**
 * Migra proyectos antiguos al formato actual.
 * v1: un único display en la raíz (display_id/canvas/background/settings/pages/fonts).
 */
export function migrateProject(raw: unknown): Project {
  const p = raw as Record<string, unknown>;
  if (!p || typeof p !== 'object') throw new Error('project.json inválido');
  const version = Number(p.format_version ?? 1);
  if (version > PROJECT_FORMAT_VERSION) throw new Error(`El proyecto se creó con una versión más reciente de la aplicación (formato ${version}).`);
  if (version === 1) {
    const d: DisplayProject = {
      display_id: String(p.display_id ?? 'display'),
      name: String(p.display_id ?? 'Display'),
      canvas: p.canvas as DisplayProject['canvas'],
      background: p.background as DisplayProject['background'],
      settings: { ...DEFAULT_SETTINGS, ...(p.settings as Partial<ProjectSettings>), pageSwitch: { ...DEFAULT_SETTINGS.pageSwitch }, touch: { ...DEFAULT_TOUCH, switches: [] } },
      pages: (p.pages as Page[]) ?? [{ id: 'main', name: 'Principal', elements: [] }],
      fonts: (p.fonts as Record<string, string>) ?? {},
    };
    return {
      format_version: PROJECT_FORMAT_VERSION,
      app_version: String(p.app_version ?? ''),
      name: String(p.name ?? 'Display'),
      profile: p.profile as Project['profile'],
      car_id: String(p.car_id ?? ''),
      displays: [d],
      physicalNeedles: [],
    };
  }
  const proj = p as unknown as Project;
  proj.physicalNeedles = Array.isArray(proj.physicalNeedles) ? proj.physicalNeedles : [];
  for (const d of proj.displays) {
    d.settings = {
      ...DEFAULT_SETTINGS,
      ...d.settings,
      pageSwitch: { ...DEFAULT_SETTINGS.pageSwitch, ...(d.settings?.pageSwitch ?? {}) },
      boot: { ...DEFAULT_BOOT, ...(d.settings?.boot ?? {}) },
      touch: { ...DEFAULT_TOUCH, ...(d.settings?.touch ?? {}), switches: d.settings?.touch?.switches ?? [] },
    };
    if (!d.pages?.length) d.pages = [{ id: 'main', name: 'Principal', elements: [] }];
    d.fonts = d.fonts ?? {};
    d.physicalButtons = Array.isArray(d.physicalButtons) ? d.physicalButtons : [];
  }
  return proj;
}

/** Todas las condiciones automáticas de una página (when + whenAny), en orden. */
export function pageConditions(page: Pick<Page, 'when' | 'whenAny'>): PageCondition[] {
  return [...(page.when ? [page.when] : []), ...(page.whenAny ?? [])];
}

/** Guarda una lista de condiciones automáticas en la página (la primera en `when`, el resto en `whenAny`). */
export function setPageConditions(page: Page, list: PageCondition[]): void {
  page.when = list[0];
  page.whenAny = list.length > 1 ? list.slice(1) : undefined;
}

/** Resuelve un RpmValue a rpm absolutas usando el limitador. */
export function resolveRpm(v: RpmValue, limiter: number): number {
  if (typeof v === 'number') return v;
  const pct = parseFloat(v);
  return Number.isFinite(pct) ? (pct / 100) * limiter : 0;
}
