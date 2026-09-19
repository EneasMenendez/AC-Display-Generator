import { useEffect, useState } from 'react';
import type { DisplayDef, DisplayProfile } from '@shared/profile';
import type { DetectedDisplay } from '@shared/types';
import { createDisplayProject } from '@shared/model';
import { api } from '../api';
import { useStore, toast } from '../store';
import { CreatorForm, importDetected, materializeEntry, type DisplayEntry } from './Wizard';

/**
 * Añadir un display más al proyecto abierto (p. ej. el del copiloto): importando uno definido a mano
 * en extension/ o eligiendo una malla del modelo. La definición se añade al perfil (y se guarda en el
 * vehículo) y el display al proyecto; las secciones originales sobre esa malla se desactivan.
 */
export function AddDisplayDialog({ onClose }: { onClose: () => void }) {
  const car = useStore((s) => s.car);
  const profile = useStore((s) => s.profile);
  const project = useStore((s) => s.project)!;
  const [detected, setDetected] = useState<DetectedDisplay[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const usedIds = project.displays.map((d) => d.display_id);
  const usedMeshes = new Set((profile?.displays ?? []).flatMap((d) => d.meshes.map((m) => m.toLowerCase())));

  useEffect(() => {
    if (!car) return;
    api
      .scanDisplays(car.path)
      .then((sc) => setDetected(sc.displays.filter((d) => !d.acdg && d.meshes.length > 0 && !d.meshes.some((m) => usedMeshes.has(m.toLowerCase())))))
      .catch(() => setDetected([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car?.path]);

  if (!car || !profile) {
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Añadir display</h2>
          <p className="err">El proyecto necesita un vehículo y un perfil para añadir displays.</p>
          <button className="outline" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    );
  }

  async function add(def: DisplayDef, entry?: DisplayEntry) {
    setBusy(def.name);
    try {
      // 1) perfil: nueva definición, guardada en el vehículo
      const next: DisplayProfile = { ...profile!, displays: [...profile!.displays.filter((d) => d.id !== def.id), def] };
      let file = useStore.getState().profileFile;
      try {
        file = await api.saveProfileToCar(next, car!.path);
      } catch (e) {
        toast(`No se pudo guardar el perfil en el vehículo: ${(e as Error).message}`, 'err');
      }
      useStore.getState().setProfile(next, file);
      // 2) proyecto: nuevo display (con fondo y elementos importados si viene de un script)
      const dp = createDisplayProject({ displayId: def.id, name: def.name, width: def.texture_size.width, height: def.texture_size.height });
      if (entry) {
        const assets: Record<string, string> = {};
        await materializeEntry(entry, dp, assets);
        for (const [p, url] of Object.entries(assets)) useStore.getState().addAssetUrl(p, url);
      }
      useStore.getState().addDisplay(dp);
      // 3) las secciones originales sobre esa malla se desactivan (como al crear el proyecto)
      try {
        const r = await api.cleanDisplays(car!.path, def.meshes);
        if (r.disabled.length) toast(`Desactivado el display existente ${r.disabled.map((d) => `[${d.section}] de ${d.iniRelative}`).join(', ')} (copia de seguridad guardada).`);
        useStore.getState().setCar(await api.scanCar(car!.path));
      } catch {
        /* sin cambios en extension/ */
      }
      toast(`Display "${def.name}" añadido al proyecto${entry?.layout ? ` con ${entry.layout.elements.length} elementos importados` : ''}.`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(null);
    }
  }

  async function importOne(d: DetectedDisplay) {
    setBusy(d.section);
    try {
      const entry = await importDetected(d, car!.path, car!.mainKn5, new Set(usedIds));
      await add(entry.def, entry);
    } catch (e) {
      toast((e as Error).message, 'err');
      setBusy(null);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 760 }} onClick={(e) => e.stopPropagation()}>
        <h2>Añadir display</h2>
        <p className="muted small">
          El proyecto tiene {project.displays.length} display{project.displays.length === 1 ? '' : 's'}: {project.displays.map((d) => d.name).join(', ')}. Cada display del coche (piloto, copiloto, volante…) se edita por separado y se instala con su propio script.
        </p>
        {detected.length > 0 && (
          <div className="card mb8">
            <h3>Definidos en extension/ (hechos a mano)</h3>
            {detected.map((d) => (
              <div key={d.iniFile + d.section} className="row small mb8">
                <code>[{d.section}]</code>
                <span className="muted">
                  {d.iniRelative} · malla {d.meshes.join(', ')}
                  {d.scriptRelative ? ` · ${d.scriptRelative}` : ''}
                </span>
                <span className="grow" />
                <button className="small outline" disabled={!!busy} onClick={() => importOne(d)}>
                  {busy === d.section ? 'Importando…' : 'Importar'}
                </button>
              </div>
            ))}
          </div>
        )}
        <CreatorForm usedIds={usedIds} onDisplay={(def) => void add(def)} />
        <div className="row mt8">
          <span className="grow" />
          <button className="ghost" disabled={!!busy} onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
