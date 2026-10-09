import { useEffect, useMemo, useState } from 'react';
import type { CarSummary, RecentEntry } from '@shared/types';
import type { AppSettings, BackgroundImage } from '@shared/types';
import { api } from '../api';
import { ACCENT_PRESETS, BACKGROUNDS, applyAppearance, backgroundObjectUrl, resolveAccent } from '../appearance';
import { useStore, toast } from '../store';
import { openProjectFlow } from '../flows';

export function StartScreen() {
  const info = useStore((s) => s.info);
  const setInfo = useStore((s) => s.setInfo);
  const setCar = useStore((s) => s.setCar);
  const setScreen = useStore((s) => s.setScreen);
  const [cars, setCars] = useState<CarSummary[]>([]);
  const [filter, setFilter] = useState('');
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (info?.acRoot) api.listCars(info.acRoot).then(setCars).catch((e) => toast(e.message, 'err'));
    else setCars([]);
    api.recentProjects().then(setRecent).catch(() => undefined);
  }, [info?.acRoot]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return f ? cars.filter((c) => c.name.toLowerCase().includes(f) || c.id.toLowerCase().includes(f) || c.brand.toLowerCase().includes(f)) : cars;
  }, [cars, filter]);

  async function chooseCar(path: string) {
    setBusy(true);
    try {
      const car = await api.scanCar(path);
      setCar(car);
      await api.saveSettings({ lastCar: path });
      setScreen('wizard');
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function pickRoot() {
    const r = await api.pickAcRoot();
    if (!r) return;
    if (r.error) return toast(r.error, 'err');
    const next = await api.appInfo();
    setInfo(next);
  }

  return (
    <div className="start">
      <div className="col" style={{ minHeight: 0 }}>
        <h1>AC Display Generator</h1>
        <div className="card">
          <h3>Instalación de Assetto Corsa</h3>
          {info?.acRoot ? (
            <div className="small mono" style={{ wordBreak: 'break-all' }}>{info.acRoot}</div>
          ) : (
            <div className="warn small">No se ha detectado Assetto Corsa.</div>
          )}
          <div className="row mt8 small muted">
            <span>CSP: {info?.cspVersion ?? '—'}</span>
            <span>·</span>
            <span>Content Manager: {info?.contentManager ? 'sí' : 'no'}</span>
          </div>
          <div className="row mt8">
            <button className="outline small" onClick={pickRoot}>Cambiar carpeta</button>
          </div>
        </div>
        <div className="card">
          <h3>Proyectos</h3>
          <div className="row">
            <button className="primary" onClick={() => openProjectFlow()}>
              Abrir proyecto
            </button>
            <button className="outline" onClick={() => api.pickCar().then((p) => { if (p) chooseCar(p); })}>
              Carpeta de vehículo
            </button>
          </div>
        </div>
        <AppearanceCard />
        <div className="card grow" style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <h3>Recientes</h3>
          <div className="list">
            {recent.length === 0 && <div className="muted small" style={{ padding: 10 }}>Todavía no hay proyectos recientes.</div>}
            {recent.map((r) => (
              <div key={r.file} className="recent-item" onClick={() => openProjectFlow(r.file)} title={r.file}>
                <div>{r.name}</div>
                <div className="muted small mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.file}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="col" style={{ minHeight: 0 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>Vehículos ({filtered.length})</h2>
          <input type="text" className="grow" placeholder="Buscar por nombre, marca o carpeta…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="primary" disabled={!selected || busy} onClick={() => selected && chooseCar(selected)}>
            Continuar
          </button>
        </div>
        <div className="list grow" style={{ minHeight: 0 }}>
          {filtered.map((c) => (
            <div key={c.path} className={`car-item ${selected === c.path ? 'selected' : ''}`} onClick={() => setSelected(c.path)} onDoubleClick={() => chooseCar(c.path)}>
              {c.badge ? <img src={c.badge} alt="" /> : <div style={{ width: 28, height: 28 }} />}
              <div className="grow">
                <div className="name">{c.name}</div>
                <div className="muted small">
                  {c.brand ? `${c.brand} · ` : ''}
                  <span className="mono">{c.id}</span>
                </div>
              </div>
              {c.hasProfile && <span className="badge ok">perfil</span>}
              {c.hasAcdg && <span className="badge accent">display instalado</span>}
            </div>
          ))}
          {info?.acRoot && filtered.length === 0 && <div className="muted" style={{ padding: 12 }}>Ningún vehículo coincide.</div>}
        </div>
        <div className="muted small">Doble clic para continuar. Los vehículos con perfil de display están marcados; para los demás puedes crear el perfil en el siguiente paso.</div>
      </div>
    </div>
  );
}

/**
 * Aspecto: color de acento, profundidad del fondo e imagen de fondo opcional. Con imagen, los tres
 * niveles pasan a decidir cuánta se ve a través de la interfaz.
 */
function AppearanceCard() {
  const info = useStore((s) => s.info);
  const setInfo = useStore((s) => s.setInfo);
  if (!info) return null;
  const { settings, backgroundImage } = info;
  const hasImage = !!backgroundImage;
  const accent = settings.accent ?? 'amber';
  const custom = !ACCENT_PRESETS[accent];

  function apply(next: AppSettings, image: BackgroundImage | null) {
    applyAppearance(next, backgroundObjectUrl(image));
    setInfo({ ...info!, settings: next, backgroundImage: image });
  }

  async function change(patch: Partial<AppSettings>) {
    const next = { ...settings, ...patch };
    apply(next, backgroundImage);
    await api.saveSettings(patch);
  }

  async function pickImage() {
    try {
      const image = await api.pickBackground();
      if (image) apply(settings, image);
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }

  async function removeImage() {
    await api.clearBackground();
    apply(settings, null);
  }

  return (
    <div className="card">
      <h3>Aspecto</h3>
      <div className="row">
        <span className="muted small" style={{ width: 62 }}>
          Acento
        </span>
        <select
          className="grow"
          value={custom ? 'custom' : accent}
          onChange={(e) => change({ accent: e.target.value === 'custom' ? resolveAccent(settings) : e.target.value })}
        >
          <option value="amber">Ámbar</option>
          <option value="blue">Azul</option>
          <option value="green">Verde</option>
          <option value="red">Rojo</option>
          <option value="custom">Personalizado…</option>
        </select>
        {custom && <input type="color" value={accent} onChange={(e) => change({ accent: e.target.value.toUpperCase() })} />}
      </div>
      <div className="row mt8">
        <span className="muted small" style={{ width: 62 }}>
          Fondo
        </span>
        {Object.entries(BACKGROUNDS).map(([id, b]) => (
          <button
            key={id}
            className={`small ${(settings.background ?? 'normal') === id ? 'active' : 'ghost'}`}
            title={hasImage ? `Deja ver ${Math.round((1 - b.alpha[0]) * 100)} % de la imagen` : undefined}
            onClick={() => change({ background: id as AppSettings['background'] })}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div className="row mt8">
        <span className="muted small" style={{ width: 62 }}>
          Imagen
        </span>
        <button className="outline small grow" onClick={pickImage}>
          {hasImage ? 'Cambiar imagen…' : 'Elegir imagen…'}
        </button>
        {hasImage && (
          <button className="small ghost" onClick={removeImage}>
            Quitar
          </button>
        )}
      </div>
      {hasImage && <div className="muted small mt8">Con imagen, los tres niveles deciden cuánta se ve: profundo la deja casi tapada y suave la deja asomar.</div>}
    </div>
  );
}
