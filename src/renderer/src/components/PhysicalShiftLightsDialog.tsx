import { useEffect, useMemo, useState } from 'react';
import { createPhysicalShiftLights, resolveRpm, type PhysicalShiftLights } from '@shared/model';
import { distributeZones, shiftLightsState } from '@shared/leds';
import type { Kn5Info } from '@shared/types';
import { api } from '../api';
import { useStore, activeDisplayOf, toast } from '../store';
import { ColorField, Num, Prop, RpmField, Sel, Txt } from './fields';
import { Icon } from './icons';

/**
 * Luces de cambio físicas: LEDs que son mallas del modelo 3D (en el salpicadero, en el volante…). Se
 * configuran como las «Luces de cambio» del display, pero el script del display enciende cada malla
 * cambiando su emisión, así que ese display tiene que estar instalado.
 */
export function PhysicalShiftLightsDialog({ onClose }: { onClose: () => void }) {
  const dp = useStore(activeDisplayOf)!;
  const car = useStore((s) => s.car);
  const profile = useStore((s) => s.profile);
  const simRpm = useStore((s) => Number(s.sim.rpm ?? 0));
  const patchDisplay = useStore((s) => s.patchDisplay);
  const strips = dp.physicalShiftLights ?? [];
  const [sel, setSel] = useState(0);
  const [kn5, setKn5] = useState<Kn5Info | null>(null);
  const [kn5File, setKn5File] = useState(car?.mainKn5 ?? car?.kn5Files[0] ?? '');
  const [filter, setFilter] = useState('');
  const limiter = profile?.displays.find((d) => d.id === dp.display_id)?.defaults.rpm_limiter ?? 8000;
  const [rpm, setRpm] = useState(simRpm > 0 ? simRpm : Math.round(limiter * 0.85));
  const [t, setT] = useState(0);

  useEffect(() => {
    if (!car || !kn5File) return;
    api
      .readKn5(car.path, kn5File)
      .then(setKn5)
      .catch((e) => toast(`No se pudo leer ${kn5File}: ${(e as Error).message}`, 'err'));
  }, [car, kn5File]);

  // reloj de la vista previa (solo hace falta para el parpadeo en el corte)
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      setT((performance.now() - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // los LEDs suelen llamarse LED1, LED2… LED10: orden natural para que salgan en su orden
  const candidates = useMemo(() => {
    if (!kn5) return [];
    const f = filter.trim().toLowerCase();
    return kn5.meshes
      .filter((m) => !f || m.name.toLowerCase().includes(f) || m.material.toLowerCase().includes(f))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .slice(0, 400);
  }, [kn5, filter]);

  const s = strips[sel];
  const set = (fn: (x: PhysicalShiftLights) => void) =>
    patchDisplay((d) => {
      const x = (d.physicalShiftLights ?? [])[sel];
      if (x) fn(x);
    });

  function add(meshes: string[] = []) {
    patchDisplay((d) => {
      d.physicalShiftLights = d.physicalShiftLights ?? [];
      const x = createPhysicalShiftLights(meshes);
      if (meshes.length) x.zones = distributeZones(x.zones, meshes.length);
      d.physicalShiftLights.push(x);
    });
    setSel(strips.length);
  }
  function remove(i: number) {
    patchDisplay((d) => d.physicalShiftLights?.splice(i, 1));
    setSel(Math.max(0, Math.min(i, strips.length - 2)));
  }
  /** añade mallas como LEDs al final de la tira seleccionada (o crea una tira con ellas) */
  function addLeds(names: string[]) {
    if (!s) return add(names);
    set((x) => {
      // si los tramos cuadraban con los LEDs que había (o es una tira nueva), se reparten de nuevo
      const inSync = x.meshes.length === 0 || x.zones.reduce((a, z) => a + z.count, 0) === x.meshes.length;
      x.meshes.push(...names.filter((n) => !x.meshes.includes(n)));
      if (inSync) x.zones = distributeZones(x.zones, x.meshes.length);
    });
  }
  function moveLed(i: number, delta: number) {
    set((x) => {
      const j = i + delta;
      if (j < 0 || j >= x.meshes.length) return;
      [x.meshes[i], x.meshes[j]] = [x.meshes[j], x.meshes[i]];
    });
  }

  const preview = s
    ? shiftLightsState({
        n: s.meshes.length,
        rpm,
        start: resolveRpm(s.rpmStart, limiter),
        end: resolveRpm(s.rpmEnd, limiter),
        pattern: s.pattern,
        zones: s.zones,
        limiterOn: rpm >= limiter,
        limiterBlinkHz: s.limiterBlinkHz,
        limiterColor: s.limiterColor,
        blinkDuty: s.blinkDuty,
        t,
      })
    : [];
  const zoneTotal = s ? s.zones.reduce((a, z) => a + z.count, 0) : 0;

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 980 }} onClick={(e) => e.stopPropagation()}>
        <h2>Luces de cambio físicas</h2>
        <p className="muted small">
          LEDs que son piezas del modelo 3D (en el salpicadero, en el volante…), no dibujos de la pantalla. Se encienden como las «Luces de cambio» del display: de forma progresiva entre dos regímenes, con
          colores por tramos y parpadeando en el corte. Las enciende el script de <b>{dp.name}</b> cambiando la emisión de cada malla, así que ese display tiene que estar instalado.
        </p>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ width: 210 }}>
            <h3>
              <span>Tiras ({strips.length})</span>
              <button className="small ghost" onClick={() => add()}>
                <Icon name="plus" size={12} /> Añadir
              </button>
            </h3>
            {strips.length === 0 && <div className="muted small mb8">Sin luces. Pulsa Añadir o elige mallas a la derecha.</div>}
            {strips.map((x, i) => (
              <div key={x.id} className={`rule ${i === sel ? 'selected' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setSel(i)}>
                <div className="row gap4">
                  <span className="grow">
                    {x.name || '(sin nombre)'}
                    <div className="muted small">{x.meshes.length} LED{x.meshes.length === 1 ? '' : 's'}</div>
                  </span>
                  <button className="icon" title="Quitar" onClick={(e) => ((e.stopPropagation(), remove(i)))}>
                    <Icon name="close" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="grow" style={{ minWidth: 0 }}>
            {s ? (
              <>
                <Prop label="Nombre">
                  <Txt value={s.name} onChange={(v) => set((x) => (x.name = v))} />
                </Prop>

                <div className="shift-preview mb8" title="Vista previa con las rpm de abajo">
                  {preview.length === 0 && <span className="muted small">Añade LEDs para ver la vista previa.</span>}
                  {preview.map((led, i) => (
                    <span key={i} className="shift-led" style={led.lit ? { background: led.color, boxShadow: `0 0 8px ${led.color}` } : undefined} />
                  ))}
                </div>
                <Prop label="Vista previa (rpm)" title="Solo para probar aquí; no cambia la simulación del editor">
                  <div className="row gap4">
                    <input type="range" min={0} max={Math.round(limiter * 1.03)} step={10} value={rpm} onChange={(e) => setRpm(Number(e.target.value))} style={{ flex: 1 }} />
                    <span className="mono small" style={{ width: 52, textAlign: 'right' }}>
                      {rpm}
                    </span>
                  </div>
                </Prop>

                <h3>
                  <span>LEDs en orden ({s.meshes.length})</span>
                  <button className="small ghost" onClick={() => set((x) => x.meshes.push(''))}>
                    <Icon name="plus" size={12} /> Añadir
                  </button>
                </h3>
                <div className="muted small mb8">De izquierda a derecha (o de abajo arriba). El orden de encendido se elige abajo.</div>
                <div className="led-list">
                  {s.meshes.map((m, i) => (
                    <div key={i} className="row gap4">
                      <span className="muted small mono" style={{ width: 22, textAlign: 'right' }}>
                        {i + 1}
                      </span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <Txt value={m} onChange={(v) => set((x) => (x.meshes[i] = v))} />
                      </span>
                      <button className="icon" title="Subir" disabled={i === 0} onClick={() => moveLed(i, -1)}>
                        <Icon name="up" size={12} />
                      </button>
                      <button className="icon" title="Bajar" disabled={i === s.meshes.length - 1} onClick={() => moveLed(i, 1)}>
                        <Icon name="down" size={12} />
                      </button>
                      <button className="icon" title="Quitar LED" onClick={() => set((x) => x.meshes.splice(i, 1))}>
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                <h3>Encendido</h3>
                <Prop label="Orden" title="Orden en que se encienden los LEDs">
                  <Sel
                    value={s.pattern}
                    onChange={(v) => set((x) => (x.pattern = v))}
                    options={[
                      { value: 'left_to_right', label: 'De un extremo al otro' },
                      { value: 'edges_to_center', label: 'De los extremos al centro' },
                      { value: 'center_to_edges', label: 'Del centro a los extremos' },
                    ]}
                  />
                </Prop>
                <Prop label="Primer LED a">
                  <RpmField value={s.rpmStart} limiter={limiter} onChange={(v) => set((x) => (x.rpmStart = v))} />
                </Prop>
                <Prop label="Todos a">
                  <RpmField value={s.rpmEnd} limiter={limiter} onChange={(v) => set((x) => (x.rpmEnd = v))} />
                </Prop>

                <h3>
                  <span>Tramos de color</span>
                  <button className="small ghost" onClick={() => set((x) => x.zones.push({ count: 1, color: '#FFFFFF' }))}>
                    <Icon name="plus" size={12} /> Añadir
                  </button>
                </h3>
                <div className={`row gap4 small mb8 ${zoneTotal !== s.meshes.length ? 'warn' : 'muted'}`}>
                  <span className="grow">
                    En orden de encendido; la suma debería ser {s.meshes.length} LED{s.meshes.length === 1 ? '' : 's'} (ahora {zoneTotal}).
                  </span>
                  {zoneTotal !== s.meshes.length && s.meshes.length > 0 && (
                    <button className="small outline" onClick={() => set((x) => (x.zones = distributeZones(x.zones, x.meshes.length)))} title="Reparte los tramos entre los LEDs manteniendo su proporción">
                      Repartir
                    </button>
                  )}
                </div>
                {s.zones.map((z, i) => (
                  <div key={i} className="row gap4 mb8">
                    <Num value={z.count} onChange={(v) => set((x) => (x.zones[i].count = Math.max(0, Math.round(v))))} min={0} />
                    <ColorField value={z.color} onChange={(v) => set((x) => (x.zones[i].color = v))} />
                    <button className="icon" title="Quitar tramo" disabled={s.zones.length <= 1} onClick={() => set((x) => x.zones.splice(i, 1))}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}

                <h3>Emisión</h3>
                <Prop label="Intensidad encendido" title="ksEmissive = color × intensidad. Orientativo: 10–30 para LEDs; más alto destella">
                  <Num value={s.intensity} onChange={(v) => set((x) => (x.intensity = Math.max(0, v)))} min={0} max={200} step={1} />
                </Prop>
                <Prop label="Apagado" title="Color e intensidad de un LED apagado; intensidad 0 = sin emisión">
                  <div className="pair">
                    <ColorField value={s.colorOff} onChange={(v) => set((x) => (x.colorOff = v))} />
                    <Num value={s.offIntensity} onChange={(v) => set((x) => (x.offIntensity = Math.max(0, v)))} min={0} max={50} step={0.1} />
                  </div>
                </Prop>
                <Prop label="Limitador" title="En el corte todos parpadean con este color (Hz; 0 = sin parpadeo)">
                  <div className="pair">
                    <Num value={s.limiterBlinkHz} onChange={(v) => set((x) => (x.limiterBlinkHz = Math.max(0, v)))} min={0} max={30} step={0.5} />
                    <ColorField value={s.limiterColor} onChange={(v) => set((x) => (x.limiterColor = v))} />
                  </div>
                </Prop>
              </>
            ) : (
              <div className="muted">Selecciona o añade una tira de luces.</div>
            )}
          </div>

          <div style={{ width: 250 }}>
            <h3>Mallas del modelo</h3>
            {car && (
              <select value={kn5File} onChange={(e) => setKn5File(e.target.value)} style={{ width: '100%' }}>
                {car.kn5Files.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            )}
            <input type="text" placeholder="Filtrar por nombre o material (p. ej. LED)" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
            <div className="mesh-list mt8" style={{ maxHeight: 360 }}>
              {candidates.map((m) => (
                <div key={m.name} className={s?.meshes.includes(m.name) ? 'selected' : ''} title={`${m.name} — material ${m.material}`} onClick={() => addLeds([m.name])}>
                  <span>{m.name}</span>
                  <span className="muted" style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
                    {m.material}
                  </span>
                </div>
              ))}
              {kn5 && candidates.length === 0 && <div className="muted small">Sin coincidencias; escribe parte del nombre.</div>}
              {!kn5 && <div className="muted small">Leyendo modelo…</div>}
            </div>
            {filter.trim() && candidates.length > 0 && (
              <button className="small outline mt8" onClick={() => addLeds(candidates.map((m) => m.name))} title="Añade todas las mallas filtradas, en orden natural (LED1, LED2… LED10)">
                Añadir las {candidates.length} filtradas
              </button>
            )}
            <div className="muted small mt8">Pulsa una malla para añadirla como siguiente LED de la tira seleccionada (o crear una tira con ella).</div>
          </div>
        </div>
        <div className="row mt8">
          <span className="muted small grow">Se aplican al pulsar "Generar e instalar" (van dentro del script del display).</span>
          <button className="outline" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
