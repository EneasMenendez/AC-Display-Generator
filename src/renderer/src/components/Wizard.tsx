import { useEffect, useMemo, useState } from 'react';
import type { DisplayDef, DisplayProfile } from '@shared/profile';
import { ProfileSchema } from '@shared/profile';
import type { DetectedDisplay, ExtensionScan, ImageInfo, Kn5Info, LuaImportResult, ProfileHit } from '@shared/types';
import { createEmptyProject } from '@shared/model';
import { api } from '../api';
import { hasUvRegion, physicalSizeFromMesh, regionFromKn5Uv, uvRegionPx, type UvRegion } from '@shared/uv';
import { useStore, toast } from '../store';
import { openProjectFlow } from '../flows';
import { Icon } from './icons';

type Step = 'car' | 'display' | 'image' | 'create';
const STEPS: { id: Step; label: string }[] = [
  { id: 'car', label: '1. Vehículo' },
  { id: 'display', label: '2. Displays' },
  { id: 'image', label: '3. Imágenes de fondo' },
  { id: 'create', label: '4. Proyecto' },
];

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'display';
}

/** Un display que formará parte del proyecto: definición del perfil + imagen + elementos importados. */
export interface DisplayEntry {
  def: DisplayDef;
  include: boolean;
  image: ImageInfo | null;
  layout: LuaImportResult | null;
  source: 'profile' | 'imported' | 'creator';
  detected?: DetectedDisplay;
  notes: string[];
}

/**
 * Convierte un display detectado en extension/ (sección + script hecho a mano) en una definición de display.
 * Resolución: RESOLUTION del ini → constantes del script → imagen referenciada → textura del material (kn5).
 */
async function defFromDetected(d: DetectedDisplay, carPath: string, kn5File: string | null, usedIds: Set<string>): Promise<{ def: DisplayDef; image: ImageInfo | null; note: string }> {
  let size = d.resolution ?? (d.hints.width && d.hints.height ? { width: d.hints.width, height: d.hints.height } : null);
  let image: ImageInfo | null = null;
  let note = '';
  for (const img of d.hints.images) {
    try {
      const info = await api.imageInfo(img);
      if (info.width > 0 && (!size || (info.width === size.width && info.height === size.height))) {
        image = info;
        size = size ?? { width: info.width, height: info.height };
        break;
      }
      if (!image) image = info;
    } catch {
      /* siguiente */
    }
  }
  // del modelo: resolución (si no se conoce), área visible (UV de la malla) y tamaño físico
  let uvRegion: UvRegion | null = null;
  let physical: { width: number; height: number } | null = null;
  if (kn5File && d.meshes[0]) {
    try {
      const kn5 = await api.readKn5(carPath, kn5File);
      const mesh = kn5.meshes.find((m) => m.name.toLowerCase() === d.meshes[0].toLowerCase());
      if (mesh) {
        uvRegion = regionFromKn5Uv(mesh.uv);
        physical = physicalSizeFromMesh(mesh.size);
      }
      const mat = kn5.materials.find((m) => m.name === mesh?.material);
      const tex = mat?.textures.find((t) => t.slot === 'txDiffuse') ?? mat?.textures[0];
      const ts = tex && kn5.textureSizes[tex.texture];
      if (!size && ts) {
        size = ts;
        note = `resolución tomada de la textura ${tex!.texture} del modelo`;
      }
    } catch {
      /* sin kn5 */
    }
  }
  if (!size) {
    size = { width: 1024, height: 512 };
    note = 'no se pudo determinar la resolución: revisa el valor antes de generar';
  }
  // nombre: sufijo de la sección si es descriptivo ([SCRIPTABLE_DISPLAY_WHEEL] → "WHEEL"), si no el nombre del script
  const sec = /^SCRIPTABLE_DISPLAY_?(.*)$/i.exec(d.section)?.[1] ?? '';
  const scriptBase = (d.scriptRelative ?? d.iniRelative).split('/').pop()!.replace(/\.[^.]+$/, '');
  const base = sec && !/^\.+$/.test(sec) && !/^\d+$/.test(sec) ? sec : scriptBase;
  let id = slug(base);
  let n = 2;
  while (usedIds.has(id)) id = `${slug(base)}_${n++}`;
  usedIds.add(id);
  const def = ProfileSchema.shape.displays.element.parse({
    id,
    name: `Display (${base})`,
    meshes: d.meshes,
    texture_size: size,
    uv_region: uvRegion ?? undefined,
    physical_size_m: physical ?? undefined,
    keep_background: d.keepBackground,
    skip_frames: d.skipFrames,
  });
  if (uvRegion && hasUvRegion(def)) {
    const px = uvRegionPx(def);
    note = `${note ? note + ' · ' : ''}la malla solo muestra ${px.width}×${px.height} px de la textura (área visible)`;
  }
  return { def, image, note };
}

/** Perfil combinado a partir de los displays incluidos (cuando no hay perfil en el coche). */
function buildProfile(carId: string, carName: string, defs: DisplayDef[], base?: DisplayProfile): DisplayProfile {
  if (base) {
    const known = new Set(base.displays.map((d) => d.id));
    return { ...base, displays: [...base.displays, ...defs.filter((d) => !known.has(d.id))] };
  }
  return ProfileSchema.parse({
    profile_version: 2,
    id: `${carId}.displays`,
    name: `${carName} – displays`,
    author: 'importado de extension/',
    car_ids: [carId],
    displays: defs,
  });
}

export function Wizard() {
  const car = useStore((s) => s.car);
  const info = useStore((s) => s.info);
  const setScreen = useStore((s) => s.setScreen);
  const setProfile = useStore((s) => s.setProfile);
  const setAssets = useStore((s) => s.setAssets);
  const loadProject = useStore((s) => s.loadProject);
  const [step, setStep] = useState<Step>('car');
  const [scan, setScan] = useState<ExtensionScan | null>(null);
  const [scanning, setScanning] = useState(true);
  const [hits, setHits] = useState<ProfileHit[]>([]);
  const [profileErrors, setProfileErrors] = useState<{ file: string; errors: string[] }[]>([]);
  const [hit, setHit] = useState<ProfileHit | null>(null);
  const [entries, setEntries] = useState<DisplayEntry[]>([]);
  const [creator, setCreator] = useState(false);
  const [name, setName] = useState('');
  const [autoMsg, setAutoMsg] = useState('');

  // Análisis automático de <coche>/extension: ext_config.ini, includes, scripts Lua, perfiles.
  useEffect(() => {
    if (!car) return;
    let cancelled = false;
    setName(`${car.name} Display`);
    (async () => {
      setScanning(true);
      try {
        const [sc, pr] = await Promise.all([api.scanDisplays(car.path), api.findProfiles(car.path)]);
        if (cancelled) return;
        setScan(sc);
        setHits(pr.hits);
        setProfileErrors(pr.errors);

        // 1) display(s) generados por esta aplicación con proyecto → se carga el proyecto directamente
        const own = sc.displays.filter((d) => d.acdg?.projectFile);
        const manual = sc.displays.filter((d) => !d.acdg && d.meshes.length > 0);
        if (own.length >= 1 && manual.length === 0) {
          setAutoMsg('Display generado por AC Display Generator encontrado: abriendo el proyecto…');
          await openProjectFlow(own[0].acdg!.projectFile!, car.path);
          return;
        }
        // 2) perfil distribuido dentro del vehículo
        const carProfile = pr.hits.find((h) => h.source === 'car');
        if (carProfile) {
          setHit(carProfile);
          setEntries(carProfile.profile.displays.map((def) => ({ def, include: true, image: null, layout: null, source: 'profile', notes: [] })));
          setAutoMsg(`Perfil "${carProfile.profile.name}" encontrado en el vehículo (${carProfile.profile.displays.length} display${carProfile.profile.displays.length === 1 ? '' : 's'}).`);
          return;
        }
        // 3) displays hechos a mano → se importan todos (malla, resolución, imagen y elementos del script)
        if (manual.length > 0) {
          const list = await importAll(manual, sc);
          if (cancelled) return;
          const complete = list.length > 0 && list.every((e) => e.image && e.layout && e.layout.elements.length > 0);
          if (complete) {
            await createFrom(list, `${car.name} Display`);
            return;
          }
          return;
        }
        // 4) perfil de la biblioteca o incluido con la aplicación
        if (pr.hits[0]) {
          setHit(pr.hits[0]);
          setEntries(pr.hits[0].profile.displays.map((def) => ({ def, include: true, image: null, layout: null, source: 'profile', notes: [] })));
          return;
        }
        // 5) nada: modo creador (elegir malla del kn5)
        setCreator(true);
      } catch (e) {
        if (!cancelled) toast(`No se pudo analizar la carpeta extension: ${(e as Error).message}`, 'err');
      } finally {
        if (!cancelled) setScanning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [car]);

  /** Importa una lista de displays detectados y los deja como entradas del proyecto. */
  async function importAll(list: DetectedDisplay[], sc: ExtensionScan | null = scan): Promise<DisplayEntry[]> {
    if (!car) return [];
    const usedIds = new Set(entries.filter((e) => e.source !== 'imported').map((e) => e.def.id));
    const out: DisplayEntry[] = [];
    for (const d of list) {
      const r = await defFromDetected(d, car.path, car.mainKn5, usedIds);
      let image = r.image;
      let lay: LuaImportResult | null = null;
      const notes: string[] = r.note ? [r.note] : [];
      // el script se ejecuta en un simulador para extraer todos sus textos, barras, imágenes e iconos
      if (d.script && d.scriptExists && d.scriptValid) {
        try {
          lay = await api.importLua(d.script, r.def.texture_size.width, r.def.texture_size.height);
          notes.push(...lay.warnings);
          if (!image && lay.background) image = await api.imageInfo(lay.background);
          notes.unshift(`${lay.elements.length} elementos importados del script (${lay.calls} llamadas de dibujo).`);
        } catch (e) {
          notes.push(`No se pudo importar el script: ${(e as Error).message}`);
        }
      }
      out.push({ def: r.def, include: true, image, layout: lay, source: 'imported', detected: d, notes });
    }
    const next = [...entries.filter((e) => e.source !== 'imported' || !list.some((d) => d.section === e.detected?.section && d.iniFile === e.detected?.iniFile)), ...out];
    setEntries(next);
    setCreator(false);
    const prof = buildProfile(car.id, car.name, next.map((e) => e.def), hit?.source === 'car' ? hit.profile : undefined);
    setHit({ profile: prof, file: sc?.extDir ?? '', source: 'manual' });
    setAutoMsg(`${out.length} display${out.length === 1 ? '' : 's'} importado${out.length === 1 ? '' : 's'} desde extension/: ${out.map((e) => e.def.name).join(', ')}.`);
    return next;
  }

  if (!car) return null;
  const included = entries.filter((e) => e.include);

  async function pickImageFor(i: number) {
    const img = await api.pickImage();
    if (!img) return;
    if (img.error) toast(img.error, 'err');
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, image: img } : e)));
  }

  async function createFrom(list: DisplayEntry[], projectName: string) {
    if (!car) return;
    const inc = list.filter((e) => e.include);
    if (inc.length === 0) return;
    const prof = buildProfile(car.id, car.name, inc.map((e) => e.def), hit?.source === 'car' ? hit.profile : undefined);
    await api.newProject();
    const project = createEmptyProject({
      name: projectName.trim() || `${car.name} Display`,
      profileId: prof.id,
      profileVersion: prof.profile_version,
      carId: car.id,
      appVersion: info?.version ?? '0.0.0',
      displays: inc.map((e) => ({ displayId: e.def.id, name: e.def.name, width: e.def.texture_size.width, height: e.def.texture_size.height })),
    });
    const assets: Record<string, string> = {};
    for (let i = 0; i < inc.length; i++) {
      const e = inc[i];
      const dp = project.displays[i];
      if (e.image) {
        const added = await api.addAssetFile(e.image.file, 'assets');
        dp.background.file = added.path;
        assets[added.path] = e.image.dataUrl ?? added.dataUrl;
      }
      if (e.layout) {
        // las imágenes/iconos del script se copian como recursos del proyecto
        for (const el of e.layout.elements) {
          try {
            if (el.type === 'image' && el.config.file && /[\\/]/.test(el.config.file)) {
              const a = await api.addAssetFile(el.config.file, 'assets');
              el.config.file = a.path;
              assets[a.path] = a.dataUrl;
            } else if (el.type === 'icon' && el.config.icon && !el.config.icon.startsWith('builtin:') && /[\\/]/.test(el.config.icon)) {
              const a = await api.addAssetFile(el.config.icon, 'assets/icons');
              el.config.icon = a.path;
              assets[a.path] = a.dataUrl;
            }
          } catch {
            /* recurso no copiable: el elemento queda sin imagen */
          }
        }
        dp.pages[0].elements.push(...e.layout.elements);
      }
    }
    setProfile(prof, hit?.file ?? null);
    setAssets(assets);
    loadProject(project, null);
    const warn = inc.flatMap((e) => e.layout?.warnings ?? []);
    if (warn.length) toast(warn[0], 'err');
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const canNext = step === 'car' ? car.valid && !scanning : step === 'display' ? included.length > 0 : true;

  return (
    <div className="wizard">
      <div className="row mb8">
        <button className="icon" onClick={() => setScreen('start')} title="Inicio">
          <Icon name="back" />
        </button>
        <h1 style={{ margin: 0 }}>{car.name}</h1>
        <span className="muted mono">{car.id}</span>
      </div>
      <div className="step-head">
        {STEPS.map((s, i) => (
          <span key={s.id} className={s.id === step ? 'active' : i < stepIndex ? 'done' : ''}>
            {s.label}
          </span>
        ))}
      </div>

      {step === 'car' && <CarStep scan={scan} scanning={scanning} autoMsg={autoMsg} />}
      {step === 'display' && (
        <DisplayStep
          scan={scan}
          entries={entries}
          onToggle={(i, v) => setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, include: v } : e)))}
          onImport={(d) => importAll([d])}
          hits={hits}
          errors={profileErrors}
          hit={hit}
          displayId={entries[0]?.def.id ?? ''}
          creator={creator}
          setCreator={setCreator}
          onPick={(h) => {
            setHit(h);
            setEntries(h.profile.displays.map((def) => ({ def, include: true, image: null, layout: null, source: 'profile', notes: [] })));
            setCreator(false);
          }}
          onCreated={(h) => {
            // el modo creador añade su display a la lista (sin descartar los importados)
            const def = h.profile.displays[0];
            setEntries((prev) => [...prev.filter((e) => e.def.id !== def.id), { def, include: true, image: null, layout: null, source: 'creator', notes: [] }]);
            setHit((prev) => ({ profile: buildProfile(car.id, car.name, [...entries.map((e) => e.def).filter((d) => d.id !== def.id), def], prev?.source === 'car' ? prev.profile : undefined), file: h.file, source: h.source }));
            setCreator(false);
          }}
        />
      )}
      {step === 'image' && (
        <div className="col">
          {included.map((e) => {
            const i = entries.indexOf(e);
            const sizeOk = !e.image || (e.image.width === e.def.texture_size.width && e.image.height === e.def.texture_size.height);
            return (
              <div key={e.def.id} className="card">
                <div className="row mb8">
                  <b>{e.def.name}</b>
                  <span className="muted small">
                    malla <code>{e.def.meshes.join(', ')}</code> · {e.def.texture_size.width} × {e.def.texture_size.height} px
                  </span>
                  <span className="grow" />
                  <button className={e.image ? 'outline small' : 'primary small'} onClick={() => pickImageFor(i)}>
                    {e.image ? 'Cambiar imagen…' : 'Seleccionar imagen…'}
                  </button>
                  {e.image && (
                    <button className="icon" title="Sin imagen (color plano)" onClick={() => setEntries((prev) => prev.map((x, j) => (j === i ? { ...x, image: null } : x)))}>
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </div>
                {e.image ? (
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    {e.image.dataUrl ? <img className="imgprev" src={e.image.dataUrl} alt="" style={{ maxHeight: 160 }} /> : <div className="imgprev" style={{ width: 200, height: 100 }} />}
                    <table className="info">
                      <tbody>
                        <tr>
                          <td>Archivo</td>
                          <td className="mono small">{e.image.file}</td>
                        </tr>
                        <tr>
                          <td>Formato</td>
                          <td>
                            {e.image.format.toUpperCase()} {e.image.ddsFormat ? `(${e.image.ddsFormat})` : ''} · {e.image.width} × {e.image.height} px{' '}
                            {sizeOk ? <span className="badge ok">coincide</span> : <span className="badge warn">no coincide: se escalará</span>}
                          </td>
                        </tr>
                        <tr>
                          <td>Canal alfa</td>
                          <td>{e.image.hasAlpha ? 'sí' : 'no'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="muted small">Sin imagen: fondo de color plano (puedes añadirla después desde las propiedades del display).</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {step === 'create' && (
        <div className="card">
          <div className="prop">
            <label>Nombre del proyecto</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <table className="info mt8">
            <tbody>
              <tr>
                <td>Vehículo</td>
                <td>{car.name}</td>
              </tr>
              {included.map((e) => (
                <tr key={e.def.id}>
                  <td>{e.def.name}</td>
                  <td>
                    malla <code>{e.def.meshes.join(', ')}</code> — {e.def.texture_size.width} × {e.def.texture_size.height} px — fondo: {e.image ? e.image.file.split(/[\\/]/).pop() : 'color plano'}
                    {e.layout && (
                      <div className="small muted">
                        {e.layout.elements.length} elementos importados ({e.layout.elements.map((x) => x.type).filter((t, i, a) => a.indexOf(t) === i).join(', ')})
                      </div>
                    )}
                    {e.notes.length > 0 && <div className="warn small">{e.notes.join(' ')}</div>}
                    {e.detected && (
                      <div className="small muted">
                        Al generar se escribirá <code>extension/{e.def.id}.lua</code> y se ofrecerá desactivar la sección original <code>[{e.detected.section}]</code>. El script original no se borra ni se sobrescribe.
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row mt8" style={{ justifyContent: 'space-between' }}>
        <button className="outline" disabled={stepIndex === 0} onClick={() => setStep(STEPS[stepIndex - 1].id)}>
          Anterior
        </button>
        {step !== 'create' ? (
          <button className="primary" disabled={!canNext} onClick={() => setStep(STEPS[stepIndex + 1].id)}>
            Siguiente
          </button>
        ) : (
          <button className="primary" disabled={included.length === 0} onClick={() => createFrom(entries, name)}>
            Abrir editor
          </button>
        )}
      </div>
    </div>
  );
}

function CarStep({ scan, scanning, autoMsg }: { scan: ExtensionScan | null; scanning: boolean; autoMsg: string }) {
  const car = useStore((s) => s.car)!;
  return (
    <div className="col">
      <div className="card">
        {car.problems.length > 0 && (
          <div className="mb8">
            {car.problems.map((p) => (
              <div key={p} className={p.includes('no es bloqueante') ? 'warn' : 'err'}>
                {p}
              </div>
            ))}
          </div>
        )}
        <table className="info">
          <tbody>
            <tr>
              <td>Carpeta</td>
              <td className="mono small">{car.path}</td>
            </tr>
            <tr>
              <td>Datos</td>
              <td>{car.hasDataAcd ? 'data.acd (empaquetado)' : car.hasDataFolder ? 'data/ (desempaquetado)' : '—'}</td>
            </tr>
            <tr>
              <td>Modelos kn5</td>
              <td className="mono small">{car.kn5Files.join(', ') || '—'}</td>
            </tr>
            <tr>
              <td>Skins</td>
              <td>{car.skins.map((s) => s.id).join(', ') || '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3>Carpeta extension</h3>
        {scanning && <div className="muted">Analizando ext_config.ini, includes y scripts…</div>}
        {scan && (
          <table className="info">
            <tbody>
              <tr>
                <td>ext_config.ini</td>
                <td>{scan.hasExtConfig ? <span className="ok">encontrado</span> : <span className="warn">no existe — se creará al generar el display</span>}</td>
              </tr>
              <tr>
                <td>Displays definidos</td>
                <td>
                  {scan.displays.length === 0 && <span className="muted">ninguno — se creará uno nuevo</span>}
                  {scan.displays.map((d) => (
                    <div key={d.iniFile + d.section} className="row small" style={{ gap: 6, marginBottom: 2 }}>
                      <code>[{d.section}]</code>
                      <span className="muted">{d.iniRelative}</span>
                      {d.acdg ? <span className="badge accent">ACDG</span> : <span className="badge">manual</span>}
                      {!d.includedInExtConfig && <span className="badge warn">no incluido en ext_config.ini</span>}
                      {d.script && (d.scriptExists ? (d.scriptValid ? <span className="badge ok">Lua válido</span> : <span className="badge err">Lua con errores</span>) : <span className="badge err">script no encontrado</span>)}
                    </div>
                  ))}
                </td>
              </tr>
              {scan.orphanLua.length > 0 && (
                <tr>
                  <td>Scripts Lua sueltos</td>
                  <td className="small muted">{scan.orphanLua.map((o) => `${o.relative}${o.valid ? '' : ' (errores)'}`).join(', ')}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {autoMsg && <div className="ok small mt8">{autoMsg}</div>}
      </div>
    </div>
  );
}

function DisplayStep(props: {
  scan: ExtensionScan | null;
  entries: DisplayEntry[];
  onToggle: (i: number, v: boolean) => void;
  onImport: (d: DetectedDisplay) => void;
  hits: ProfileHit[];
  errors: { file: string; errors: string[] }[];
  hit: ProfileHit | null;
  displayId: string;
  creator: boolean;
  setCreator: (v: boolean) => void;
  onPick: (h: ProfileHit, displayId: string) => void;
  onCreated: (h: ProfileHit) => void;
}) {
  const { scan, entries, onToggle, onImport } = props;
  const car = useStore((s) => s.car)!;
  const detected = scan?.displays ?? [];
  const isEntry = (d: DetectedDisplay) => entries.find((e) => e.detected && e.detected.section === d.section && e.detected.iniFile === d.iniFile);
  return (
    <div className="col">
      <div className="card">
        <h3>Displays del proyecto ({entries.filter((e) => e.include).length})</h3>
        {entries.length === 0 && <div className="muted small">Todavía no hay displays. Importa uno detectado, elige un perfil o crea uno con el modo creador.</div>}
        {entries.map((e, i) => (
          <label key={e.def.id} className="row mb8" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={e.include} onChange={(ev) => onToggle(i, ev.target.checked)} style={{ marginTop: 3 }} />
            <div className="grow">
              <div>
                <b>{e.def.name}</b> <span className="badge">{e.source === 'imported' ? 'importado' : e.source === 'creator' ? 'creado' : 'perfil'}</span>
              </div>
              <div className="small muted">
                malla <code>{e.def.meshes.join(', ')}</code> · {e.def.texture_size.width}×{e.def.texture_size.height}
                {e.image && ` · imagen ${e.image.file.split(/[\\/]/).pop()}`}
                {e.layout && ` · ${e.layout.elements.length} elementos`}
              </div>
              {e.notes.length > 0 && <div className="warn small">{e.notes.join(' ')}</div>}
            </div>
          </label>
        ))}
      </div>
      {detected.length > 0 && (
        <div className="card">
          <h3>Displays encontrados en extension/</h3>
          {detected.map((d) => (
            <div key={d.iniFile + d.section} className="row mb8" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div>
                  <b>[{d.section}]</b> <span className="muted small">{d.iniRelative}</span> {isEntry(d) && <span className="badge ok">en el proyecto</span>}
                </div>
                <div className="small muted">
                  malla <code>{d.meshes.join(', ') || '—'}</code>
                  {d.scriptRelative && (
                    <>
                      {' '}
                      · script <code>{d.scriptRelative}</code> {d.scriptExists ? (d.scriptValid ? <span className="ok">válido</span> : <span className="err">{d.scriptError}</span>) : <span className="err">no existe</span>}
                    </>
                  )}
                  {d.hints.width && d.hints.height && ` · ${d.hints.width}×${d.hints.height}`}
                  {!d.includedInExtConfig && <span className="warn"> · no incluido en ext_config.ini</span>}
                </div>
              </div>
              {d.acdg ? (
                <button
                  className="small outline"
                  disabled={!d.acdg.projectFile}
                  onClick={() => d.acdg?.projectFile && openProjectFlow(d.acdg.projectFile, car.path)}
                  title={d.acdg.projectFile ? 'Abrir el proyecto guardado con este display' : 'No hay acdg_project.acdisplay en extension/'}
                >
                  Abrir proyecto
                </button>
              ) : (
                <button className="small outline" disabled={d.meshes.length === 0 || !!isEntry(d)} onClick={() => onImport(d)}>
                  {isEntry(d) ? 'Importado' : 'Importar'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {detected.length === 0 && scan && entries.length === 0 && (
        <div className="card muted">
          No hay ningún display definido en <code>extension/</code> de {car.name}. Crea uno nuevo eligiendo la malla del modelo 3D.
        </div>
      )}
      <ProfileStep {...props} />
    </div>
  );
}

function ProfileStep(props: {
  hits: ProfileHit[];
  errors: { file: string; errors: string[] }[];
  hit: ProfileHit | null;
  displayId: string;
  creator: boolean;
  setCreator: (v: boolean) => void;
  onPick: (h: ProfileHit, displayId: string) => void;
  onCreated: (h: ProfileHit) => void;
}) {
  const { hits, errors, hit, displayId, creator, setCreator, onPick, onCreated } = props;
  return (
    <div className="col">
      {hits.length > 0 && (
        <div className="card">
          <h3>Perfiles encontrados</h3>
          {hits.map((h) => (
            <div key={h.file} className="mb8">
              <label className="row">
                <input type="radio" checked={hit?.file === h.file} onChange={() => onPick(h, h.profile.displays[0].id)} />
                <b>{h.profile.name}</b>
                <span className="badge">{h.source === 'car' ? 'en el vehículo' : h.source === 'bundled' ? 'incluido' : h.source === 'library' ? 'biblioteca' : 'manual'}</span>
                <span className="muted small">v{h.profile.profile_version}</span>
              </label>
              {hit?.file === h.file && h.profile.displays.length > 1 && (
                <div className="row mt8" style={{ marginLeft: 24 }}>
                  <label className="muted">Display:</label>
                  <select value={displayId} onChange={(e) => onPick(h, e.target.value)} style={{ width: 'auto' }}>
                    {h.profile.displays.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.texture_size.width}×{d.texture_size.height})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {hit?.file === h.file && (
                <div className="muted small mono" style={{ marginLeft: 24 }}>
                  {h.file}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {errors.length > 0 && (
        <div className="card">
          <h3 className="err">Perfiles con errores</h3>
          {errors.map((e) => (
            <div key={e.file} className="small">
              <div className="mono">{e.file}</div>
              <ul>
                {e.errors.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <button
          className="outline"
          onClick={async () => {
            const r = await api.pickProfile();
            if (!r) return;
            if ('errors' in r) return toast(r.errors.join('; '), 'err');
            onPick(r, r.profile.displays[0].id);
          }}
        >
          Cargar perfil desde archivo…
        </button>
        <button className={`outline ${creator ? 'active' : ''}`} onClick={() => setCreator(!creator)}>
          {hits.length === 0 ? 'Crear perfil (modo creador)' : 'Modo creador…'}
        </button>
      </div>
      {creator && <CreatorForm onCreated={onCreated} />}
    </div>
  );
}

function CreatorForm({ onCreated }: { onCreated: (h: ProfileHit) => void }) {
  const car = useStore((s) => s.car)!;
  const [kn5, setKn5] = useState<Kn5Info | null>(null);
  const [kn5File, setKn5File] = useState(car.mainKn5 ?? car.kn5Files[0] ?? '');
  const [filter, setFilter] = useState('');
  const [mesh, setMesh] = useState('');
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(512);
  const [pname, setPname] = useState(`${car.name} – Display`);
  const [displayName, setDisplayName] = useState('Driver Display');
  const [keepBg, setKeepBg] = useState(true);
  const [limiter, setLimiter] = useState(8000);
  const [maxFuel, setMaxFuel] = useState(60);
  const [emissive, setEmissive] = useState(false);
  const [cspBuild, setCspBuild] = useState(2050);
  const [uvRegion, setUvRegion] = useState<UvRegion | null>(null);
  const [physical, setPhysical] = useState<{ width: number; height: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!kn5File) return;
    setLoading(true);
    api
      .readKn5(car.path, kn5File)
      .then(setKn5)
      .catch((e) => toast(`No se pudo leer ${kn5File}: ${e.message}`, 'err'))
      .finally(() => setLoading(false));
  }, [car.path, kn5File]);

  const meshes = useMemo(() => {
    if (!kn5) return [];
    const f = filter.toLowerCase();
    return kn5.meshes.filter((m) => !f || m.name.toLowerCase().includes(f) || m.material.toLowerCase().includes(f));
  }, [kn5, filter]);

  function pickMesh(name: string) {
    setMesh(name);
    const picked = kn5?.meshes.find((x) => x.name === name);
    setUvRegion(picked ? regionFromKn5Uv(picked.uv) : null);
    setPhysical(picked ? physicalSizeFromMesh(picked.size) : null);
    // sugerir resolución a partir de la textura difusa del material
    const m = kn5?.meshes.find((x) => x.name === name);
    const mat = kn5?.materials.find((x) => x.name === m?.material);
    const tex = mat?.textures.find((t) => t.slot === 'txDiffuse') ?? mat?.textures[0];
    const size = tex && kn5?.textureSizes[tex.texture];
    if (size) {
      setWidth(size.width);
      setHeight(size.height);
    }
  }

  function build(): DisplayProfile | null {
    const id = `${car.id}.${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const r = ProfileSchema.safeParse({
      profile_version: 2,
      id,
      name: pname,
      author: '',
      car_ids: [car.id],
      csp_min_build: cspBuild,
      displays: [
        {
          id: displayName.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'display',
          name: displayName,
          meshes: [mesh],
          texture_size: { width, height },
          uv_region: uvRegion ?? undefined,
          physical_size_m: physical ?? undefined,
          keep_background: keepBg,
          emissive: emissive ? { mode: 'shader_replacement', shader: 'ksPerPixel', ks_emissive: [1, 1, 1], brightness_default: 1 } : { mode: 'none' },
          defaults: { rpm_limiter: limiter, max_fuel_l: maxFuel },
        },
      ],
    });
    if (!r.success) {
      toast(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 'err');
      return null;
    }
    return r.data;
  }

  async function save(where: 'car' | 'library' | 'session') {
    const p = build();
    if (!p) return;
    let file = '(sin guardar)';
    try {
      if (where === 'car') file = await api.saveProfileToCar(p, car.path);
      else if (where === 'library') file = await api.saveProfileToLibrary(p);
      toast(where === 'session' ? 'Perfil creado para esta sesión' : `Perfil guardado en ${file}`);
      onCreated({ profile: p, file, source: where === 'car' ? 'car' : where === 'library' ? 'library' : 'manual' });
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  return (
    <div className="card">
      <h3>Modo creador — nuevo perfil de display</h3>
      <p className="muted small">
        Selecciona la malla del display en el modelo 3D. La resolución se rellena automáticamente con la textura del material cuando es posible.
      </p>
      <div className="row">
        <label className="muted">Modelo:</label>
        <select value={kn5File} onChange={(e) => setKn5File(e.target.value)} style={{ width: 'auto' }}>
          {car.kn5Files.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <input type="text" className="grow" placeholder="Filtrar mallas por nombre o material…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {loading && <span className="muted">leyendo…</span>}
      </div>
      <div className="mesh-list mt8">
        {meshes.map((m) => (
          <div key={m.path} className={m.name === mesh ? 'selected' : ''} onClick={() => pickMesh(m.name)} title={m.path}>
            <span>{m.name}</span>
            <span className="muted">
              {m.material} · {m.vertices} v
            </span>
          </div>
        ))}
        {kn5 && meshes.length === 0 && <div className="muted">Sin coincidencias</div>}
      </div>
      {uvRegion && hasUvRegion({ uv_region: uvRegion }) && (
        <div className="warn small mt8">
          La malla <code>{mesh}</code> solo muestra una parte de la textura: {Math.round(uvRegion.width * width)}×{Math.round(uvRegion.height * height)} px desde ({Math.round(uvRegion.x * width)}, {Math.round(uvRegion.y * height)}). El editor marcará esa área visible.
        </div>
      )}
      <div className="mt8" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <div className="prop">
          <label>Nombre del perfil</label>
          <input type="text" value={pname} onChange={(e) => setPname(e.target.value)} />
        </div>
        <div className="prop">
          <label>Nombre del display</label>
          <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="prop">
          <label>Malla</label>
          <input type="text" value={mesh} onChange={(e) => setMesh(e.target.value)} placeholder="nombre exacto de la malla" />
        </div>
        <div className="prop">
          <label>Resolución (px)</label>
          <div className="pair">
            <input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} />
            <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
          </div>
        </div>
        <div className="prop">
          <label>Limitador (rpm)</label>
          <input type="number" value={limiter} onChange={(e) => setLimiter(Number(e.target.value))} />
        </div>
        <div className="prop">
          <label>Combustible máx. (L)</label>
          <input type="number" value={maxFuel} onChange={(e) => setMaxFuel(Number(e.target.value))} />
        </div>
        <div className="prop">
          <label>CSP mínimo (build)</label>
          <input type="number" value={cspBuild} onChange={(e) => setCspBuild(Number(e.target.value))} />
        </div>
        <div className="prop">
          <label>Opciones</label>
          <div className="col gap4">
            <label className="row">
              <input type="checkbox" checked={keepBg} onChange={(e) => setKeepBg(e.target.checked)} /> KEEP_BACKGROUND (no limpiar la textura)
            </label>
            <label className="row">
              <input type="checkbox" checked={emissive} onChange={(e) => setEmissive(e.target.checked)} /> Hacer emisiva la malla (shader replacement)
            </label>
          </div>
        </div>
      </div>
      <div className="row mt8">
        <button className="primary" disabled={!mesh} onClick={() => save('car')}>
          Guardar en el vehículo (extension/display_profile.json)
        </button>
        <button className="outline" disabled={!mesh} onClick={() => save('library')}>
          Guardar en mi biblioteca
        </button>
        <button className="outline" disabled={!mesh} onClick={() => save('session')}>
          Usar solo ahora
        </button>
      </div>
    </div>
  );
}
