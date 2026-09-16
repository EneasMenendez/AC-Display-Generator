/**
 * Modelo de datos del proyecto (.acdisplay/project.json).
 * Es la única fuente de verdad: el editor lo renderiza y el generador lo traduce a display_config.lua.
 */

export const PROJECT_FORMAT_VERSION = 1;

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
  | 'gauge';

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
}

export interface TextElement extends ElementBase {
  type: 'text';
  binding: TextBinding;
  style: TextStyle;
}

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
  /** colorea cada segmento según su propia zona (true) o toda la barra según el régimen actual (false) */
  perSegmentColors: boolean;
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
  radius: number;
}

export interface ShiftLightElement extends ElementBase {
  type: 'shift_light';
  config: ShiftLightConfig;
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
  | GaugeElement;

export interface Page {
  id: string;
  name: string;
  /** orden de dibujo: el primero se pinta debajo */
  elements: DisplayElement[];
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
}

export interface Project {
  format_version: number;
  app_version: string;
  name: string;
  profile: { id: string; version: number };
  car_id: string;
  display_id: string;
  canvas: { width: number; height: number };
  background: { file: string | null; locked: boolean; color: Color };
  settings: ProjectSettings;
  pages: Page[];
  /** fuentes importadas: nombre → ruta relativa dentro de assets/fonts */
  fonts: Record<string, string>;
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
        config: { rpmOn: '94%', rpmOff: '90%', shape: 'circle', colorOn: '#2D7BFF', colorOff: '#1A1A1A', blinkHz: 0, radius: 8 },
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

export function createEmptyProject(params: {
  name: string;
  profileId: string;
  profileVersion: number;
  carId: string;
  displayId: string;
  width: number;
  height: number;
  appVersion: string;
}): Project {
  return {
    format_version: PROJECT_FORMAT_VERSION,
    app_version: params.appVersion,
    name: params.name,
    profile: { id: params.profileId, version: params.profileVersion },
    car_id: params.carId,
    display_id: params.displayId,
    canvas: { width: params.width, height: params.height },
    background: { file: null, locked: true, color: '#000000' },
    settings: { ...DEFAULT_SETTINGS },
    pages: [{ id: 'main', name: 'Principal', elements: [] }],
    fonts: {},
  };
}

/** Resuelve un RpmValue a rpm absolutas usando el limitador. */
export function resolveRpm(v: RpmValue, limiter: number): number {
  if (typeof v === 'number') return v;
  const pct = parseFloat(v);
  return Number.isFinite(pct) ? (pct / 100) * limiter : 0;
}
