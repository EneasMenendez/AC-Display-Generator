import { z } from 'zod';

/**
 * display_profile.json (v2) — Anexo A de los requerimientos.
 * Lo escribe el creador del vehículo; se distribuye en content/cars/<id>/extension/.
 */

export const EmissiveSchema = z.object({
  /** none = como el coche; props = solo cambia ksEmissive (conserva el shader); shader_replacement = shader + ksEmissive */
  mode: z.enum(['none', 'props', 'shader_replacement', 'custom']).default('none'),
  shader: z.string().default('ksPerPixel'),
  ks_emissive: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
  brightness_default: z.number().min(0).max(10).default(1),
  /** bloque ini literal cuando mode = custom */
  ini: z.string().optional(),
});

export const DisplayDefaultsSchema = z.object({
  rpm_limiter: z.number().positive().default(8000),
  rpm_warning_pct: z.number().min(0).max(1).default(0.85),
  rpm_redline_pct: z.number().min(0).max(1).default(0.95),
  max_fuel_l: z.number().positive().default(60),
  water_temp_range: z.tuple([z.number(), z.number()]).default([40, 130]),
  oil_temp_range: z.tuple([z.number(), z.number()]).default([40, 150]),
  oil_pressure_range: z.tuple([z.number(), z.number()]).default([0, 8]),
  speed_max: z.number().positive().default(300),
});

export const VariableOverrideSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  lua: z.string().optional(),
  range: z.tuple([z.number(), z.number()]).optional(),
  unit: z.string().optional(),
  physics_only: z.boolean().optional(),
  fallback: z.union([z.number(), z.string(), z.boolean()]).optional(),
  category: z.string().optional(),
  type: z.enum(['number', 'integer', 'boolean', 'text', 'time_ms']).optional(),
});

export const DisplayDefSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, 'id: solo minúsculas, dígitos y _'),
  name: z.string(),
  meshes: z.array(z.string().min(1)).min(1),
  texture_size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  physical_size_m: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  uv_region: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .default({ x: 0, y: 0, width: 1, height: 1 }),
  keep_background: z.boolean().default(false),
  skip_frames: z.number().int().min(0).default(1),
  max_distance_m: z.number().positive().default(50),
  emissive: EmissiveSchema.prefault({}),
  /** bloques ini adicionales que se añaden a display.ini tal cual */
  extra_ini: z.array(z.string()).default([]),
  defaults: DisplayDefaultsSchema.prefault({}),
  variables_override: z.array(VariableOverrideSchema).default([]),
  fonts: z.array(z.string()).default([]),
  preset_layout: z.string().optional(),
});

export const ProfileSchema = z.object({
  profile_version: z.literal(2),
  id: z.string().min(1),
  name: z.string().min(1),
  author: z.string().default(''),
  car_ids: z.array(z.string().min(1)).min(1),
  min_app_version: z.string().default('0.1.0'),
  min_runtime_version: z.string().default('0.1.0'),
  csp_min_build: z.number().int().default(2050),
  displays: z.array(DisplayDefSchema).min(1),
});

export type DisplayProfile = z.infer<typeof ProfileSchema>;
export type DisplayDef = z.infer<typeof DisplayDefSchema>;
export type DisplayDefaults = z.infer<typeof DisplayDefaultsSchema>;
export type VariableOverride = z.infer<typeof VariableOverrideSchema>;

export interface ProfileValidation {
  ok: boolean;
  profile?: DisplayProfile;
  errors: string[];
}

export function parseProfile(json: unknown): ProfileValidation {
  const r = ProfileSchema.safeParse(json);
  if (r.success) return { ok: true, profile: r.data, errors: [] };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`) };
}

/**
 * Perfil "manual mínimo" (sección 4 de los requerimientos): solo malla + resolución, sin garantías.
 */
export function createMinimalProfile(carId: string, mesh: string, width: number, height: number): DisplayProfile {
  return ProfileSchema.parse({
    profile_version: 2,
    id: `${carId}.manual`,
    name: `${carId} (perfil manual)`,
    car_ids: [carId],
    displays: [{ id: 'display', name: 'Display', meshes: [mesh], texture_size: { width, height } }],
  });
}
