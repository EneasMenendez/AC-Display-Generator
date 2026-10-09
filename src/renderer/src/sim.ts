import type { DisplayDefaults } from '@shared/profile';
/** valores de simulación por id de variable */
export type SimValues = Record<string, number | boolean>;

/**
 * Valores de variables para el preview: parte de los sliders del panel de simulación y calcula
 * las variables derivadas igual que ACDG.* en el runtime.
 */
export interface SimContext {
  values: SimValues;
  limiter: number;
  defaults: DisplayDefaults;
  /** segundos desde el inicio (parpadeos) */
  t: number;
  ambient: number;
  physicsAvailable: boolean;
}

export function resolveSim(values: SimValues, defaults: DisplayDefaults, t: number, ambient: number): SimContext {
  const v: SimValues = { ...values };
  const limiter = Number(v.rpm_limiter) > 0 ? Number(v.rpm_limiter) : defaults.rpm_limiter;
  v.rpm_limiter = limiter;
  const rpm = Number(v.rpm ?? 0);
  v.rpm_pct = Math.max(0, Math.min(1, rpm / limiter));
  const maxFuel = Number(v.fuel_max) > 0 ? Number(v.fuel_max) : defaults.max_fuel_l;
  v.fuel_max = maxFuel;
  v.fuel_pct = Math.max(0, Math.min(1, Number(v.fuel ?? 0) / maxFuel));
  const perLap = Number(v.fuel_per_lap ?? 0);
  v.fuel_laps_left = perLap > 0 ? Number(v.fuel ?? 0) / perLap : 0;
  v.low_fuel = v.fuel_pct < 0.1;
  v.water_hot = Number(v.water_temp ?? 0) >= defaults.water_temp_range[1] - 10;
  v.oil_low_pressure = rpm > 500 && Number(v.oil_pressure ?? 0) < 1;
  v.battery_low = Number(v.battery_voltage ?? 13) < 12;
  if (v.limiter_on === undefined) v.limiter_on = rpm >= limiter - 1;
  const physicsAvailable = v.is_replay !== true;
  return { values: v, limiter, defaults, t, ambient, physicsAvailable };
}

