import { useEffect, useState } from 'react';
import type { BackupEntry, CspLogReport, DetectedDisplay, InstallResult, InstallTarget } from '@shared/types';
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
  const [log, setLog] = useState<CspLogReport | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => project.displays.map((d) => d.display_id));
  // displays del proyecto con su definición en el perfil
  const targets = project.displays.map((dp) => ({ dp, def: profile?.displays.find((d) => d.id === dp.display_id) }));
  const chosen = targets.filter((t) => t.def && selectedIds.includes(t.dp.display_id));
  const missing = targets.filter((t) => !t.def);

  useEffect(() => {
    if (!car || chosen.length === 0) return;
    // displays ajenos (hechos a mano o de otro perfil) que dibujan sobre las mismas mallas
    api
      .scanDisplays(car.path)
      .then((sc) => {
        const mine = chosen.flatMap((t) => t.def!.meshes.map((m) => m.toLowerCase()));
        const own = new Set(chosen.map((t) => t.def!.id));
        setConflicts(sc.displays.filter((d) => !(d.acdg && own.has(d.acdg.displayId)) && d.meshes.some((m) => mine.includes(m.toLowerCase()))));
      })
      .catch(() => setConflicts([]));
    api.listBackups(car.path, target).then(setBackups).catch(() => setBackups([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car, target, result, selectedIds.join(',')]);

  if (!car || !profile || targets.length === 0) {
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
      const existing = chosen.filter((t) => car!.installedDisplays.includes(t.def!.id));
      if (install && existing.length) {
        const idx = await api.confirm(
          `Ya ${existing.length === 1 ? 'existe el display' : 'existen los displays'} ${existing.map((t) => `"${t.def!.id}"`).join(', ')} en este vehículo.`,
          'Se hará una copia de seguridad y se actualizará. ¿Continuar?',
          ['Actualizar', 'Cancelar'],
        );
        if (idx !== 0) return;
      }
      // iconos integrados usados → PNG
      const extraFiles: Record<string, Uint8Array> = {};
      for (const t of chosen) {
        const gen = generateConfigLua(project, t.dp, t.def!);
        for (const a of gen.assets) {
          if (!a.source.startsWith('builtin:') || extraFiles[a.target]) continue;
          const ic = icons.find((i) => `builtin:${i.id}` === a.source);
          if (ic) extraFiles[a.target] = await rasterizeSvg(ic.svg);
        }
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
        displayIds: chosen.map((t) => t.dp.display_id),
      });
      setResult(r);
      if (r.ok) {
        toast(install ? (chosen.length === 1 ? 'Display instalado' : `${chosen.length} displays instalados`) : 'Paquete exportado');
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
              <td>{targets.length === 1 ? 'Display' : 'Displays'}</td>
              <td>
                {targets.map(({ dp, def }) => (
                  <label key={dp.display_id} className="row small" style={{ gap: 6, marginBottom: 2 }}>
                    <input
                      type="checkbox"
                      disabled={!def || targets.length === 1}
                      checked={!!def && selectedIds.includes(dp.display_id)}
                      onChange={(e) => setSelectedIds(e.target.checked ? [...selectedIds, dp.display_id] : selectedIds.filter((x) => x !== dp.display_id))}
                    />
                    <b>{dp.name}</b>
                    {def ? (
                      <span className="muted">
                        malla <code>{def.meshes.join(', ')}</code> · {dp.canvas.width}×{dp.canvas.height} · {dp.pages.length} página{dp.pages.length === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="err">no existe en el perfil ({dp.display_id})</span>
                    )}
                  </label>
                ))}
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
          Se escribirá directamente en <code>{target.kind === 'car' ? 'extension/' : `skins/${target.skin}/`}</code> (sin subcarpetas) el script{' '}
          {chosen.length === 1 ? <code>{chosen[0].def!.id}.lua</code> : <>de cada display (<code>&lt;display&gt;.lua</code>)</>} (o <code>&lt;display&gt;_acdg.lua</code> si ya existe un script ajeno con ese nombre) con las imágenes que use y una copia del proyecto (<code>acdg_project.acdisplay</code>); en{' '}
          <code>ext_config.ini</code> se añade la sección del display entre marcadores. Antes de tocar nada se guarda una copia de seguridad en los datos de la aplicación.
          {missing.length > 0 && <span className="err"> Los displays sin definición en el perfil no se generan.</span>}
        </p>
        <div className="row mb8">
          <button className="primary" disabled={busy || chosen.length === 0} onClick={() => run(true)}>
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
              <button className="outline" onClick={() => api.openPath(result.folder)}>Abrir carpeta</button>
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

        {result?.ok && (
          <div className="warn small mt8">
            Para ver los cambios en el juego hay que <b>volver a cargar la sesión</b> (salir a Content Manager y entrar de nuevo): CSP lee la configuración y los scripts del coche al cargar la pista, no en caliente.
          </div>
        )}
        <hr />
        <details>
          <summary className="muted">Diagnóstico: ¿se cargó el display en la última sesión?</summary>
          <div className="mt8 col">
            <div className="row">
              <button className="outline small" onClick={() => api.cspLog(car.id).then(setLog).catch((e) => toast((e as Error).message, 'err'))}>
                Leer registro de CSP
              </button>
              {log && <span className="muted small">{log.exists ? `sesión iniciada ${log.started ?? '?'} · log modificado ${new Date(log.modified!).toLocaleString()}` : 'no se encontró el log de CSP'}</span>}
            </div>
            {log?.exists && (
              <>
                <div className="small">
                  {log.carLoaded ? <span className="ok">El coche cargó su configuración en esa sesión.</span> : <span className="warn">Ese registro no corresponde a una sesión con este coche.</span>}{' '}
                  {log.acdgLines.length > 0 ? <span className="ok">Display ACDG cargado ({log.acdgLines.length} líneas).</span> : <span className="err">No aparece ninguna línea del display ACDG: el script no se cargó (¿sesión anterior a la instalación?).</span>}
                </div>
                {log.acdgLines.length > 0 && <pre style={{ maxHeight: 140 }}>{log.acdgLines.join('\n')}</pre>}
                {log.errorLines.length > 0 && (
                  <>
                    <div className="err small">Errores relacionados con Lua/displays:</div>
                    <pre style={{ maxHeight: 160 }}>{log.errorLines.join('\n')}</pre>
                  </>
                )}
              </>
            )}
          </div>
        </details>
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
                    const idx = await api.confirm('¿Restaurar esta copia de seguridad?', 'Se sobrescribirán ext_config.ini y los archivos generados con el contenido de la copia.', ['Restaurar', 'Cancelar']);
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
            {chosen.map(({ dp, def }) => (
              <button
                key={dp.display_id}
                className="danger small"
                style={{ marginRight: 4 }}
                onClick={async () => {
                  const idx = await api.confirm(`¿Desinstalar el display "${def!.id}" de ${target.kind === 'car' ? 'este coche' : 'la skin ' + target.skin}?`, 'Se eliminarán el script y las imágenes generadas y la sección de ext_config.ini; se reactivan los displays originales. El resto del coche no se toca.', ['Desinstalar', 'Cancelar']);
                  if (idx !== 0) return;
                  try {
                    const done = await api.uninstall(car.path, target, def!.id);
                    toast(done.join('. ') || 'No había nada instalado.');
                    useStore.getState().setCar(await api.scanCar(car.path));
                    setResult(null);
                  } catch (e) {
                    toast((e as Error).message, 'err');
                  }
                }}
              >
                Desinstalar {targets.length > 1 ? dp.name : 'display'}
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
