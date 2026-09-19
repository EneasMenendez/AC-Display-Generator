import { api } from './api';
import { useStore, toast } from './store';
import type { Project } from '@shared/model';
import type { DisplayProfile } from '@shared/profile';
import { hasUvRegion, regionFromKn5Uv, uvRegionPx } from '@shared/uv';

/**
 * Flujos que combinan varias llamadas IPC (abrir proyecto, guardar, etc.).
 */

export async function openProjectFlow(file?: string, carPathHint?: string): Promise<boolean> {
  const s = useStore.getState();
  try {
    const r = await api.openProject(file);
    if (!r) return false;
    const { project, assets } = r;
    // localizar coche y perfil: carpeta indicada > coche actual con el mismo id > instalación de AC
    let carPath: string | null = carPathHint ?? null;
    if (!carPath && s.car && s.car.id.toLowerCase() === project.car_id.toLowerCase()) carPath = s.car.path;
    if (!carPath && s.info?.acRoot) {
      const cars = await api.listCars(s.info.acRoot);
      carPath = cars.find((c) => c.id.toLowerCase() === project.car_id.toLowerCase())?.path ?? null;
    }
    if (!carPath) {
      const idx = await api.confirm(
        `No se encontró el vehículo "${project.car_id}" en la instalación de Assetto Corsa.`,
        'Puedes seleccionar la carpeta del vehículo manualmente o abrir el proyecto sin vehículo (no podrás generar).',
        ['Seleccionar carpeta', 'Abrir sin vehículo', 'Cancelar'],
      );
      if (idx === 2) return false;
      if (idx === 0) carPath = await api.pickCar();
    }
    let profile: DisplayProfile | null = null;
    let profileFile: string | null = null;
    if (carPath) {
      const car = await api.scanCar(carPath);
      s.setCar(car);
      const found = await api.findProfiles(carPath);
      const hit = found.hits.find((h) => h.profile.id === project.profile.id) ?? found.hits[0];
      if (hit) {
        profile = hit.profile;
        profileFile = hit.file;
        if (hit.profile.id !== project.profile.id) toast(`Perfil del proyecto no encontrado; se usa ${hit.profile.name}.`);
      }
    } else s.setCar(null);
    if (!profile) toast('Sin perfil: podrás editar pero no generar hasta seleccionar uno.', 'err');
    s.setProfile(profile, profileFile);
    s.setAssets(assets);
    s.loadProject(project, r.file);
    if (carPath && profile) void suggestVisibleArea(carPath, profile);
    return true;
  } catch (e) {
    toast(`No se pudo abrir el proyecto: ${(e as Error).message}`, 'err');
    return false;
  }
}

export async function saveProjectFlow(forceDialog = false, thumbnail: Uint8Array | null = null): Promise<boolean> {
  const s = useStore.getState();
  if (!s.project) return false;
  try {
    // limpiar assets no usados antes de guardar
    await api.pruneAssets(usedAssets(s.project));
    const file = await api.saveProject(s.project, thumbnail, forceDialog);
    if (!file) return false;
    s.markSaved(file);
    toast('Proyecto guardado');
    return true;
  } catch (e) {
    toast(`No se pudo guardar: ${(e as Error).message}`, 'err');
    return false;
  }
}

export function usedAssets(project: Project): string[] {
  const used = new Set<string>();
  for (const d of project.displays) {
    if (d.background.file) used.add(d.background.file);
    for (const f of Object.values(d.fonts)) used.add(f);
    for (const page of d.pages) {
      for (const el of page.elements) {
        if (el.type === 'icon' && !el.config.icon.startsWith('builtin:')) used.add(el.config.icon);
        if ((el.type === 'rpm_bar' || el.type === 'bar') && el.config.fillImage) used.add(el.config.fillImage);
        if ((el.type === 'rpm_bar' || el.type === 'bar') && el.config.bgImage) used.add(el.config.bgImage);
        if ((el.type === 'shift_lights' || el.type === 'needle') && el.config.image) used.add(el.config.image);
        if (el.type === 'image' && el.config.file) used.add(el.config.file);
        for (const r of el.rules) if (r.set.image && !r.set.image.startsWith('builtin:')) used.add(r.set.image);
      }
    }
  }
  return [...used];
}

/**
 * Perfiles anteriores a la detección de UV: si alguna malla solo muestra parte de la textura y el perfil
 * aún dice "toda", avisar para que el usuario pulse Detectar (no se cambia nada sin que lo pida).
 */
async function suggestVisibleArea(carPath: string, profile: DisplayProfile): Promise<void> {
  const pending = profile.displays.filter((d) => !hasUvRegion(d));
  if (pending.length === 0) return;
  try {
    const car = useStore.getState().car;
    if (!car?.mainKn5) return;
    const kn5 = await api.readKn5(carPath, car.mainKn5);
    for (const d of pending) {
      const mesh = kn5.meshes.find((m) => d.meshes.some((n) => n.toLowerCase() === m.name.toLowerCase()));
      const region = mesh && regionFromKn5Uv(mesh.uv);
      if (region && hasUvRegion({ uv_region: region })) {
        const px = uvRegionPx({ uv_region: region, texture_size: d.texture_size });
        toast(`${d.name}: la malla ${mesh!.name} solo muestra ${px.width}×${px.height} px de la textura. Pulsa "Detectar" en Área visible para marcarla.`);
      }
    }
  } catch {
    /* sin kn5 legible: nada que sugerir */
  }
}
