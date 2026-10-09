/**
 * Catálogo central de variables (sección 10 / Anexo D de los requerimientos).
 * `lua` es la expresión real sobre `car` / `sim` de CSP (ac.StateCar / ac.StateSim).
 * `physics_only`: no disponible en replays ni coches remotos (car.physicsAvailable == false); el runtime usa `fallback`.
 */

import { GENERATED_VARIABLES } from './variables.generated';

export type VariableType = 'number' | 'integer' | 'boolean' | 'text' | 'time_ms';
export type VariableCategory =
  | 'Motor'
  | 'Conducción'
  | 'Tiempo'
  | 'Vehículo'
  | 'Neumáticos'
  | 'Estado'
  | 'Eléctrico'
  | 'Sesión'
  | 'Coche (todos)'
  | 'Neumáticos (todos)'
  | 'Simulación (todos)'
  | 'Sesión (todos)';

export interface VariableDef {
  id: string;
  label: string;
  category: VariableCategory;
  type: VariableType;
  lua: string;
  unit: string;
  range: [number, number];
  physics_only: boolean;
  fallback: number | string | boolean;
  /** valor usado en el preview cuando el usuario no lo ha tocado */
  preview: number | boolean | string;
  /** true para el catálogo completo generado desde el SDK (se muestra solo al activar "todos los datos") */
  advanced?: boolean;
  /** descripción original del SDK de CSP */
  description?: string;
}

function v(
  id: string,
  label: string,
  category: VariableCategory,
  type: VariableType,
  lua: string,
  unit: string,
  range: [number, number],
  preview: number | boolean | string,
  physics_only = false,
  fallback: number | string | boolean = 0,
): VariableDef {
  return { id, label, category, type, lua, unit, range, physics_only, fallback, preview };
}

const wheels = ['fl', 'fr', 'rl', 'rr'] as const;
const wheelLabel = { fl: 'Del. izq.', fr: 'Del. der.', rl: 'Tras. izq.', rr: 'Tras. der.' };

export const CURATED_VARIABLES: VariableDef[] = [
  // Motor
  v('rpm', 'RPM', 'Motor', 'number', 'car.rpm', 'rpm', [0, 9000], 4500),
  v('rpm_limiter', 'Limitador (rpm)', 'Motor', 'number', 'car.rpmLimiter', 'rpm', [0, 12000], 8000),
  v('rpm_pct', 'RPM (% del limitador)', 'Motor', 'number', 'ACDG.rpmPct()', '%', [0, 1], 0.56),
  v('water_temp', 'Temperatura de agua', 'Motor', 'number', 'car.waterTemperature', '°C', [40, 130], 88),
  v('oil_temp', 'Temperatura de aceite', 'Motor', 'number', 'car.oilTemperature', '°C', [40, 150], 95),
  v('oil_pressure', 'Presión de aceite', 'Motor', 'number', 'car.oilPressure', 'bar', [0, 8], 4.2),
  v('turbo_boost', 'Presión de turbo', 'Motor', 'number', 'car.turboBoost', 'bar', [0, 3], 0.8),
  v('exhaust_temp', 'Temperatura de escape', 'Motor', 'number', 'car.exhaustTemperature', '°C', [0, 900], 600),
  v('limiter_on', 'Limitador activo', 'Motor', 'boolean', 'car.isEngineLimiterOn', '', [0, 1], false),
  // Eléctrico
  v('battery_voltage', 'Voltaje de batería', 'Eléctrico', 'number', 'car.batteryVoltage', 'V', [10, 15], 13.8),
  v('kers_charge', 'Carga KERS/ERS', 'Eléctrico', 'number', 'car.kersCharge', '%', [0, 1], 0.5),
  // Conducción
  v('speed', 'Velocidad', 'Conducción', 'number', 'car.speedKmh', 'km/h', [0, 300], 128),
  v('gear', 'Marcha', 'Conducción', 'integer', 'car.gear', '', [-1, 8], 3),
  v('throttle', 'Acelerador', 'Conducción', 'number', 'car.gas', '%', [0, 1], 0.7),
  v('brake', 'Freno', 'Conducción', 'number', 'car.brake', '%', [0, 1], 0.1),
  v('clutch', 'Embrague', 'Conducción', 'number', 'car.clutch', '%', [0, 1], 0),
  v('handbrake', 'Freno de mano', 'Conducción', 'number', 'car.handbrake', '%', [0, 1], 0),
  v('steer', 'Ángulo de volante', 'Conducción', 'number', 'car.steer', '°', [-450, 450], 0),
  v('accel_lateral', 'Aceleración lateral', 'Conducción', 'number', 'car.acceleration.x', 'G', [-3, 3], 0.4),
  v('accel_longitudinal', 'Aceleración longitudinal', 'Conducción', 'number', 'car.acceleration.z', 'G', [-3, 3], 0.2),
  // Tiempo
  v('lap_time', 'Tiempo de vuelta', 'Tiempo', 'time_ms', 'car.lapTimeMs', 'ms', [0, 600000], 83452),
  v('last_lap', 'Última vuelta', 'Tiempo', 'time_ms', 'car.previousLapTimeMs', 'ms', [0, 600000], 92310),
  v('best_lap', 'Mejor vuelta', 'Tiempo', 'time_ms', 'car.bestLapTimeMs', 'ms', [0, 600000], 91875),
  v('delta', 'Delta', 'Tiempo', 'number', 'car.performanceMeter', 's', [-5, 5], -0.35),
  v('estimated_lap', 'Vuelta estimada', 'Tiempo', 'time_ms', 'car.estimatedLapTimeMs', 'ms', [0, 600000], 91500),
  v('current_sector', 'Sector actual', 'Tiempo', 'integer', 'car.currentSector + 1', '', [1, 3], 2),
  v('sector_time', 'Tiempo del sector anterior', 'Tiempo', 'time_ms', 'car.previousSectorTime', 'ms', [0, 300000], 31200),
  v('lap_count', 'Vueltas completadas', 'Tiempo', 'integer', 'car.lapCount', '', [0, 99], 4),
  v('lap_valid', 'Vuelta válida', 'Tiempo', 'boolean', 'car.isLapValid', '', [0, 1], true, true, true),
  // Vehículo
  v('fuel', 'Combustible', 'Vehículo', 'number', 'car.fuel', 'L', [0, 100], 32.5),
  v('fuel_max', 'Combustible máximo', 'Vehículo', 'number', 'car.maxFuel', 'L', [0, 200], 60),
  v('fuel_pct', 'Combustible (%)', 'Vehículo', 'number', 'ACDG.fuelPct()', '%', [0, 1], 0.54),
  v('fuel_per_lap', 'Consumo por vuelta', 'Vehículo', 'number', 'car.fuelPerLap', 'L', [0, 10], 2.1, true, 0),
  v('fuel_laps_left', 'Vueltas de combustible', 'Vehículo', 'number', 'ACDG.fuelLapsLeft()', '', [0, 99], 15.4, true, 0),
  v('race_position', 'Posición', 'Vehículo', 'integer', 'car.racePosition', '', [1, 40], 3),
  v('engine_life', 'Vida del motor', 'Vehículo', 'number', 'car.engineLifeLeft', '', [0, 1000], 1000),
  v('gearbox_damage', 'Daño de caja', 'Vehículo', 'number', 'car.gearboxDamage', '%', [0, 1], 0),
  v('brake_bias', 'Reparto de frenada', 'Vehículo', 'number', 'car.brakeBias', '%', [0, 1], 0.62, true, 0),
  v('tc_mode', 'Modo TC', 'Vehículo', 'integer', 'car.tractionControlMode', '', [0, 12], 3, true, 0),
  v('abs_mode', 'Modo ABS', 'Vehículo', 'integer', 'car.absMode', '', [0, 12], 2, true, 0),
  v('fuel_map', 'Mapa de combustible', 'Vehículo', 'integer', 'car.fuelMap', '', [0, 10], 1, true, 0),
  // Neumáticos
  ...wheels.map((w, i) =>
    v(`tyre_pressure_${w}`, `Presión neumático ${wheelLabel[w]}`, 'Neumáticos', 'number', `car.wheels[${i}].tyrePressure`, 'psi', [15, 40], 27.5 + i * 0.3),
  ),
  ...wheels.map((w, i) =>
    v(`tyre_temp_${w}`, `Temp. neumático ${wheelLabel[w]}`, 'Neumáticos', 'number', `car.wheels[${i}].tyreCoreTemperature`, '°C', [40, 130], 82 + i),
  ),
  ...wheels.map((w, i) =>
    v(`brake_temp_${w}`, `Temp. freno ${wheelLabel[w]}`, 'Neumáticos', 'number', `car.wheels[${i}].discTemperature`, '°C', [0, 900], 320 + i * 10),
  ),
  ...wheels.map((w, i) =>
    v(`tyre_wear_${w}`, `Desgaste ${wheelLabel[w]}`, 'Neumáticos', 'number', `car.wheels[${i}].tyreWear`, '%', [0, 1], 0.05 + i * 0.01),
  ),
  // Estado
  v('abs_active', 'ABS en acción', 'Estado', 'boolean', 'car.absInAction', '', [0, 1], false, true, false),
  v('tc_active', 'TC en acción', 'Estado', 'boolean', 'car.tractionControlInAction', '', [0, 1], false, true, false),
  v('headlights', 'Luces', 'Estado', 'boolean', 'car.headlightsActive', '', [0, 1], false),
  v('low_beams', 'Luces cortas', 'Estado', 'boolean', 'car.lowBeams', '', [0, 1], false),
  v('high_beams', 'Luces largas', 'Estado', 'boolean', 'car.highBeams', '', [0, 1], false),
  v('turn_left', 'Intermitente izquierdo', 'Estado', 'boolean', 'car.turningLeftLights and car.turningLightsActivePhase', '', [0, 1], false),
  v('turn_right', 'Intermitente derecho', 'Estado', 'boolean', 'car.turningRightLights and car.turningLightsActivePhase', '', [0, 1], false),
  v('hazards', 'Emergencia', 'Estado', 'boolean', 'car.hazardLights', '', [0, 1], false),
  v('pit_limiter', 'Limitador de boxes', 'Estado', 'boolean', 'car.manualPitsSpeedLimiterEnabled', '', [0, 1], false, true, false),
  v('in_pit', 'En box', 'Estado', 'boolean', 'car.isInPit', '', [0, 1], false),
  v('in_pitlane', 'En pit lane', 'Estado', 'boolean', 'car.isInPitlane', '', [0, 1], false),
  v('drs_active', 'DRS activo', 'Estado', 'boolean', 'car.drsActive', '', [0, 1], false, true, false),
  v('drs_available', 'DRS disponible', 'Estado', 'boolean', 'car.drsAvailable', '', [0, 1], false, true, false),
  v('low_fuel', 'Combustible bajo', 'Estado', 'boolean', 'ACDG.lowFuel()', '', [0, 1], false),
  v('water_hot', 'Agua caliente', 'Estado', 'boolean', 'ACDG.waterHot()', '', [0, 1], false),
  v('oil_low_pressure', 'Presión de aceite baja', 'Estado', 'boolean', 'ACDG.oilLowPressure()', '', [0, 1], false),
  v('battery_low', 'Batería baja', 'Estado', 'boolean', 'ACDG.batteryLow()', '', [0, 1], false),
  v('gear_grinding', 'Rascada de marcha', 'Estado', 'boolean', 'car.isGearGrinding', '', [0, 1], false),
  ...'ABCDEFGH'.split('').map((l) =>
    v(`extra_${l.toLowerCase()}`, `Extra ${l}`, 'Estado', 'boolean', `car.extra${l}`, '', [0, 1], false),
  ),
  // Sesión
  v('session_time_left', 'Tiempo restante de sesión', 'Sesión', 'time_ms', 'sim.sessionTimeLeft', 'ms', [0, 7200000], 1254000),
  v('time_hours', 'Hora del día', 'Sesión', 'number', 'sim.timeHours + sim.timeMinutes / 60', 'h', [0, 24], 14.5),
  v('ambient_temp', 'Temperatura ambiente', 'Sesión', 'number', 'sim.ambientTemperature', '°C', [-10, 45], 24),
  v('road_temp', 'Temperatura de pista', 'Sesión', 'number', 'sim.roadTemperature', '°C', [-10, 60], 31),
  v('is_replay', 'Es replay', 'Sesión', 'boolean', 'sim.isReplayActive', '', [0, 1], false),
  // botones y entradas para pantallas de funcionalidad
  v('kers_button', 'Botón KERS pulsado', 'Estado', 'boolean', 'car.kersButtonPressed', '', [0, 1], false, true, false),
  v('kers_input', 'Entrada KERS', 'Eléctrico', 'number', 'car.kersInput', '%', [0, 1], 0, true, 0),
  v('clutch_full', 'Embrague a fondo', 'Estado', 'boolean', 'car.clutch > 0.9', '', [0, 1], false),
  v('handbrake_on', 'Freno de mano puesto', 'Estado', 'boolean', 'car.handbrake > 0.5', '', [0, 1], false),
  // interruptores de las pantallas táctiles (los cambian los botones del display)
  ...['a', 'b', 'c', 'd', 'e', 'f'].map((k) =>
    v(`touch_${k}`, `Interruptor táctil ${k.toUpperCase()}`, 'Estado', 'boolean', `ACDG.sw('${k}')`, '', [0, 1], false),
  ),
  // proporcionadas por el runtime (máquina de páginas)
  v('page_time', 'Tiempo en la página', 'Sesión', 'number', 'ACDG.pageTime()', 's', [0, 60], 1.5),
  v('page_entry_speed', 'Velocidad al entrar en la página', 'Sesión', 'number', 'ACDG.pageEntrySpeed()', 'km/h', [0, 300], 0),
  v('cars_count', 'Número de coches', 'Sesión', 'integer', 'sim.carsCount', '', [1, 40], 12),
];

/** Catálogo completo: variables seleccionadas (etiquetas en español) + todos los datos de AC/CSP generados desde el SDK. */
const curatedLua = new Set(CURATED_VARIABLES.map((v) => v.lua));
export const VARIABLES: VariableDef[] = [...CURATED_VARIABLES, ...GENERATED_VARIABLES.filter((g) => !curatedLua.has(g.lua))];

export const VARIABLE_MAP: Record<string, VariableDef> = Object.fromEntries(VARIABLES.map((d) => [d.id, d]));

export const CATEGORIES: VariableCategory[] = [
  'Motor',
  'Conducción',
  'Tiempo',
  'Vehículo',
  'Neumáticos',
  'Estado',
  'Eléctrico',
  'Sesión',
  'Coche (todos)',
  'Neumáticos (todos)',
  'Simulación (todos)',
  'Sesión (todos)',
];

/** Conversión de unidades (base → presentación). */
export const UNIT_CONVERSIONS: Record<string, { to: string; factor: number; offset?: number }[]> = {
  'km/h': [{ to: 'mph', factor: 0.621371 }],
  '°C': [{ to: '°F', factor: 1.8, offset: 32 }],
  bar: [{ to: 'psi', factor: 14.5038 }],
  psi: [{ to: 'bar', factor: 1 / 14.5038 }],
  L: [{ to: 'gal', factor: 0.264172 }],
  '%': [{ to: '%', factor: 100 }],
};

export function convertUnit(value: number, from: string, to: string | undefined): number {
  if (!to || to === from) return from === '%' ? value * 100 : value;
  const c = UNIT_CONVERSIONS[from]?.find((x) => x.to === to);
  if (!c) return value;
  return value * c.factor + (c.offset ?? 0);
}
