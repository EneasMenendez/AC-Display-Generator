import { useEffect, useState } from 'react';
import type { BackupEntry, DetectedDisplay, InstallResult, InstallTarget } from '@shared/types';
import { generateConfigLua } from '@shared/generator';
import { api } from '../api';
import { useStore, toast } from '../store';
import { saveProjectFlow } from '../flows';

async function rasterizeSvg(svg: string, size = 256): Promise<Uint8Array> {
  const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('SVG inválido'));
    img.src = url;
  });
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.getContext('2d')!.drawImage(img, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('No se pudo rasterizar el icono');
  return new Uint8Array(await blob.arrayBuffer());
}

export function InstallDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const profile = useStore((s) => s.profile);
  const car = useStore((s) => s.car);
  const info = useStore((s) => s.info);
  const icons = useStore((s) => s.icons);
  const [target, setTarget] = useState<InstallTarget>({ kind: 'car' });
  const [dds, setDds] = useState(info?.settings.convertToDds ?? false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [conflicts, setConflicts] = useState<DetectedDisplay[]>([]);
  const [disableOthers, setDisableOthers] = useState(true);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const display = profile?.displays.find((d) => d.id === project.display_id);

  useEffect(() => {
    if (!car || !display) return;
    // displays ajenos (hechos a mano o de otro perfil) que dibujan sobre la misma malla
    api
      .scanDisplays(car.path)
      .then((sc) => {
        const mine = display.meshes.map((m) => m.toLowerCase());
        setConflicts(sc.displays.filter((d) => d.acdg?.displayId !== display.id && d.meshes.some((m) => mine.includes(m.toLowerCase()))));
      })
      .catch(() => setConflicts([]));
    api.listBackups(car.path, target).then(setBackups).catch(() => setBackups([]));
  }, [car, display, target, result]);

  if (!car || !profile || !display) {
    return (
      <div className="modal-bg" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Generar</h2>
          <p className="err">Este proyecto no tiene vehículo o perfil asociado. Ábrelo desde la pantalla de inicio seleccionando el vehículo.</p>
          <button className="outline" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    );
  }

  async function run(install: boolean) {
    setBusy(true);
    setResult(null);
    try {
      let exportDir: string | undefined;
      if (!install) {
        const d = await api.pickExportDir();
        if (!d) return;
        exportDir = d;
      }
      if (install && car!.installedDisplays.includes(display!.id)) {
        const idx = await api.confirm(
          `Ya existe un display "${display!.id}" generado en este vehículo.`,
          'Se hará una copia de seguridad y se actualizará. ¿Continuar?',
          ['Actualizar', 'Cancelar'],
        );
        if (idx !== 0) return;
      }
      // iconos integrados usados → PNG
      const gen = generateConfigLua(project, display!);
      const extraFiles: Record<string, Uint8Array> = {};
      for (const a of gen.assets) {
        if (!a.source.startsWith('builtin:')) continue;
        const ic = icons.find((i) => `builtin:${i.id}` === a.source);
        if (ic) extraFiles[a.target] = await rasterizeSvg(ic.svg);
      }
      const r = await api.install({
        carPath: car!.path,
        target,
        project,
        profile: profile!,
        extraFiles,
        convertToDds: dds,
        install,
        exportDir,
        disableSections: install && disableOthers ? conflicts.map((c) => ({ iniFile: c.iniFile, section: c.section })) : [],
        writeProfile: install && target.kind === 'car',
      });
      setResult(r);
      if (r.ok) {
        toast(install ? 'Display instalado' : 'Paquete exportado');
        const info2 = await api.scanCar(car!.path);
        useStore.getState().setCar(info2);
        await api.saveSettings({ convertToDds: dds });
      }
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-bg" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Generar e instalar</h2>
        <table className="info mb8">
          <tbody>
            <tr>
              <td>Vehículo</td>
              <td>
                {car.name} <span className="muted mono small">{car.id}</span>
              </td>
            </tr>
            <tr>
              <td>Display</td>
              <td>
                {display.name} · malla <code>{display.meshes.join(', ')}</code> · {project.canvas.width}×{project.canvas.height}
              </td>
            </tr>
            <tr>
              <td>Destino</td>
              <td>
                <select
                  value={target.kind === 'car' ? 'car' : `skin:${target.skin}`}
                  onChange={(e) => setTarget(e.target.value === 'car' ? { kind: 'car' } : { kind: 'skin', skin: e.target.value.slice(5) })}
                  style={{ width: 'auto' }}
                >
                  <option value="car">Coche (extension/ext_config.ini)</option>
                  {car.skins.map((s) => (
                    <option key={s.id} value={`skin:${s.id}`}>
                      Skin: {s.id}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td>Opciones</td>
              <td>
                <label className="row">
                  <input type="checkbox" checked={dds} onChange={(e) => setDds(e.target.checked)} /> Convertir el fondo a DDS (DXT5 + mipmaps)
                  <span className="muted small">— opcional; CSP carga PNG directamente</span>
                </label>
              </td>
            </tr>
          </tbody>
        </table>
        {conflicts.length > 0 && (
          <div className="card mb8" style={{ padding: 10 }}>
            <div className="warn small mb8">
              Ya hay {conflicts.length === 1 ? 'un display definido' : `${conflicts.length} displays definidos`} sobre la misma malla:{' '}
              {conflicts.map((c) => (
                <code key={c.iniFile + c.section}>
                  [{c.section}] en {c.iniRelative}
                </code>
              ))}
            </div>
            <label className="row small">
              <input type="checkbox" checked={disableOthers} onChange={(e) => setDisableOthers(e.target.checked)} />
              Desactivar {conflicts.length === 1 ? 'esa sección' : 'esas secciones'} al instalar (se comentan en su .ini; el script original no se borra y se reactivan al desinstalar)
            </label>
          </div>
        )}
        {!car.valid && <div className="err small mb8">El vehículo tiene problemas: {car.problems.join(' ')}</div>}
        <p className="muted small">
          Se creará <code>acdg/{display.id}/</code> con el runtime Lua, la configuración, la imagen y una copia del proyecto; en <code>ext_config.ini</code> solo se añade una línea{' '}
          <code>[INCLUDE]</code> entre marcadores. Antes de tocar nada se hace una copia de seguridad.
        </p>
        <div className="row mb8">
          <button className="primary" disabled={busy} onClick={() => run(true)}>
            {busy ? 'Generando…' : 'Generar e instalar'}
          </button>
          <button className="outline" disabled={busy} onClick={() => run(false)}>
            Exportar sin instalar
          </button>
          <span className="grow" />
          <button className="ghost" disabled={busy} onClick={onClose}>
            Cerrar
          </button>
        </div>

        {result && (
          <div className="card">
            <h3 className={result.ok ? 'ok' : 'err'}>{result.ok ? 'Completado' : 'Con errores'}</h3>
            <ul className="steps">
              {result.steps.map((s, i) => (
                <li key={i}>
                  <span className={s.ok ? 'ok' : 'err'}>{s.ok ? '✓' : '✕'}</span>
                  <span>{s.name}</span>
                  {s.detail && <span className="detail">— {s.detail}</span>}
                </li>
              ))}
            </ul>
            {result.warnings.map((w) => (
              <div key={w} className="warn small">
                ⚠ {w}
              </div>
            ))}
            {result.errors.map((e) => (
              <div key={e} className="err small">
                ✕ {e}
              </div>
            ))}
            <div className="row mt8 wrap">
              <button className="outline" onClick={() => api.openPath(result.folder)}>Abrir carpeta generada</button>
              {info?.contentManager && result.ok && <button className="outline" onClick={() => api.launchCM(info.contentManager!)}>Abrir Content Manager</button>}
              {result.ok && (
                <button
                  className="outline"
                  onClick={async () => {
                    if (await saveProjectFlow()) toast('Proyecto guardado');
                  }}
                >
                  Guardar proyecto
                </button>
              )}
            </div>
          </div>
        )}

        <hr />
        <details>
          <summary className="muted">Copias de seguridad y desinstalación</summary>
          <div className="mt8">
            {backups.length === 0 && <div className="muted small">No hay copias de seguridad para este destino.</div>}
            {backups.map((b) => (
              <div key={b.id} className="row small mb8">
                <span className="mono">{b.date}</span>
                <span className="muted">
                  {b.hasExtConfig ? 'ext_config.ini' : ''} {b.displays.length ? `+ ${b.displays.join(', ')}` : ''}
                </span>
                <span className="grow" />
                <button
                  className="small outline"
                  onClick={async () => {
                    const idx = await api.confirm('¿Restaurar esta copia de seguridad?', 'Se sobrescribirán ext_config.ini y las carpetas de display con el contenido de la copia.', ['Restaurar', 'Cancelar']);
                    if (idx !== 0) return;
                    try {
                      const done = await api.restoreBackup(car.path, target, b.id);
                      toast(`Restaurado: ${done.join(', ') || 'nada que restaurar'}`);
                      useStore.getState().setCar(await api.scanCar(car.path));
                    } catch (e) {
                      toast((e as Error).message, 'err');
                    }
                  }}
                >
                  Restaurar
                </button>
              </div>
            ))}
            <button
              className="danger small"
              onClick={async () => {
                const idx = await api.confirm(`¿Desinstalar el display "${display.id}" de ${target.kind === 'car' ? 'este coche' : 'la skin ' + target.skin}?`, 'Se eliminará la carpeta generada y el bloque INCLUDE. El resto del coche no se toca.', ['Desinstalar', 'Cancelar']);
                if (idx !== 0) return;
                try {
                  const done = await api.uninstall(car.path, target, display.id);
                  toast(done.join('. ') || 'No había nada instalado.');
                  useStore.getState().setCar(await api.scanCar(car.path));
                  setResult(null);
                } catch (e) {
                  toast((e as Error).message, 'err');
                }
              }}
            >
              Desinstalar display
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
