import { useEffect, useMemo, useState } from 'react';
import { NEEDLE_INPUTS, createPhysicalNeedle, type PhysicalNeedle } from '@shared/model';
import { generateNeedlesIni } from '@shared/generator';
import type { Kn5Info } from '@shared/types';
import { api } from '../api';
import { useStore, toast } from '../store';
import { Chk, Num, Prop, Sel, Txt } from './fields';
import { Icon } from './icons';

/**
 * Agujas físicas: nodos del modelo que giran con un valor mediante [ANALOG_INDICATOR_...] de CSP.
 * Se guardan en el proyecto y se escriben en ext_config.ini al generar e instalar.
 */
export function NeedlesDialog({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const car = useStore((s) => s.car);
  const patchProject = useStore((s) => s.patchProject);
  const needles = project.physicalNeedles ?? [];
  const [sel, setSel] = useState(0);
  const [kn5, setKn5] = useState<Kn5Info | null>(null);
  const [kn5File, setKn5File] = useState(car?.mainKn5 ?? car?.kn5Files[0] ?? '');
  const [filter, setFilter] = useState('');
  const [showIni, setShowIni] = useState(false);

  useEffect(() => {
    if (!car || !kn5File) return;
    api
      .readKn5(car.path, kn5File)
      .then(setKn5)
      .catch((e) => toast(`No se pudo leer ${kn5File}: ${(e as Error).message}`, 'err'));
  }, [car, kn5File]);

  const candidates = useMemo(() => {
    if (!kn5) return [];
    const f = filter.toLowerCase();
    const hint = /arrow|aguja|needle|ago|lancetta|pointer|hand|ind/i;
    return kn5.nodes
      .filter((n) => n.path.includes('/'))
      .filter((n) => (f ? n.name.toLowerCase().includes(f) : hint.test(n.name)))
      .slice(0, 400);
  }, [kn5, filter]);

  const n = needles[sel];
  const set = (fn: (x: PhysicalNeedle) => void) => patchProject((p) => {
    const t = p.physicalNeedles[sel];
    if (t) fn(t);
  });
  const inputDef = NEEDLE_INPUTS.find((i) => i.id === n?.input);

  function add(object = '') {
    patchProject((p) => p.physicalNeedles.push(createPhysicalNeedle(object)));
    setSel(needles.length);
  }
  function remove(i: number) {
    patchProject((p) => p.physicalNeedles.splice(i, 1));
    setSel(Math.max(0, Math.min(i, needles.length - 2)));
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 860 }} onClick={(e) => e.stopPropagation()}>
        <h2>Agujas físicas del coche</h2>
        <p className="muted small">
          Agujas del modelo 3D (cuentarrevoluciones, presión, temperatura…) que giran con un valor del coche. No dependen de ningún display: al generar e instalar se escribe una sección{' '}
          <code>[ANALOG_INDICATOR_...]</code> por aguja en <code>ext_config.ini</code> y se desactivan las secciones originales que muevan el mismo objeto.
        </p>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ width: 240 }}>
            <h3>
              <span>Agujas ({needles.length})</span>
              <button className="small ghost" onClick={() => add()}>
                <Icon name="plus" size={12} /> Añadir
              </button>
            </h3>
            {needles.length === 0 && <div className="muted small mb8">Sin agujas. Elige un nodo del modelo a la derecha o pulsa Añadir.</div>}
            {needles.map((x, i) => (
              <div key={x.id} className={`rule ${i === sel ? 'selected' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setSel(i)}>
                <div className="row gap4">
                  <span className="grow">
                    {x.name || x.object || '(sin nombre)'}
                    <div className="muted small mono">{x.object || '— sin objeto —'} · {x.input}</div>
                  </span>
                  <button className="icon" title="Quitar" onClick={(e) => ((e.stopPropagation(), remove(i)))}>
                    <Icon name="close" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="grow">
            {n ? (
              <>
                <Prop label="Nombre">
                  <Txt value={n.name} onChange={(v) => set((x) => (x.name = v))} />
                </Prop>
                <Prop label="Objeto (nodo)" title="Nombre exacto del nodo de la aguja en el kn5 (OBJECT_NAME). Suele ser un dummy que contiene la malla de la aguja; su pivote es el eje de giro.">
                  <Txt value={n.object} onChange={(v) => set((x) => (x.object = v))} />
                </Prop>
                <Prop label="Entrada" title="Valor del coche que mueve la aguja (INPUT de CSP)">
                  <div className="row gap4">
                    <Sel
                      value={NEEDLE_INPUTS.some((i) => i.id === n.input) ? n.input : '__custom'}
                      onChange={(v) =>
                        set((x) => {
                          if (v === '__custom') return;
                          const def = NEEDLE_INPUTS.find((i) => i.id === v)!;
                          x.input = v;
                          x.lowerBound = def.range[0];
                          x.upperBound = def.range[1];
                          if (x.lut.length === 2) {
                            x.lut[0].value = def.range[0];
                            x.lut[1].value = def.range[1];
                          }
                        })
                      }
                      options={[...NEEDLE_INPUTS.map((i) => ({ value: i.id, label: `${i.label} — ${i.id}` })), { value: '__custom', label: 'Otra (escribir)…' }]}
                    />
                  </div>
                </Prop>
                {!NEEDLE_INPUTS.some((i) => i.id === n.input) && (
                  <Prop label="INPUT">
                    <Txt value={n.input} onChange={(v) => set((x) => (x.input = v.toUpperCase()))} />
                  </Prop>
                )}
                <h3>
                  <span>Recorrido (valor → ángulo)</span>
                  <button className="small ghost" onClick={() => set((x) => x.lut.push({ value: x.lut.length ? x.lut[x.lut.length - 1].value : 0, angle: x.lut.length ? x.lut[x.lut.length - 1].angle : 0 }))}>
                    <Icon name="plus" size={12} /> Punto
                  </button>
                </h3>
                <div className="muted small mb8">
                  Ángulo en grados respecto a la posición en que está modelada la aguja; entre puntos CSP interpola. Con dos puntos el recorrido es lineal; añade más para escalas no lineales (p. ej. velocímetros).
                  {inputDef?.unit ? ` Unidad: ${inputDef.unit}.` : ''}
                </div>
                {[...n.lut]
                  .map((p, i) => ({ p, i }))
                  .sort((a, b) => a.p.value - b.p.value)
                  .map(({ p, i }) => (
                    <div key={i} className="row gap4 mb8">
                      <Num value={p.value} onChange={(v) => set((x) => (x.lut[i].value = v))} />
                      <span className="muted">→</span>
                      <Num value={p.angle} onChange={(v) => set((x) => (x.lut[i].angle = v))} />
                      <span className="muted small">°</span>
                      <button className="icon" title="Quitar punto" disabled={n.lut.length <= 2} onClick={() => set((x) => x.lut.splice(i, 1))}>
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  ))}
                <Prop label="Límites del valor">
                  <div className="row gap4">
                    <Chk value={n.lowerBound !== undefined} label="" onChange={(v) => set((x) => ((x.lowerBound = v ? x.lut[0]?.value ?? 0 : undefined), (x.upperBound = v ? x.lut[x.lut.length - 1]?.value ?? 1 : undefined)))} />
                    <Num value={n.lowerBound ?? 0} disabled={n.lowerBound === undefined} onChange={(v) => set((x) => (x.lowerBound = v))} />
                    <Num value={n.upperBound ?? 0} disabled={n.upperBound === undefined} onChange={(v) => set((x) => (x.upperBound = v))} />
                  </div>
                </Prop>
                <Prop label="Retardo subir / bajar" title="0 = instantáneo; 0,8 = suave; 0,99 = muy lento (INPUT_LAG_UP / INPUT_LAG_DOWN)">
                  <div className="pair">
                    <Num value={n.lagUp} onChange={(v) => set((x) => (x.lagUp = v))} min={0} max={0.999} step={0.05} />
                    <Num value={n.lagDown} onChange={(v) => set((x) => (x.lagDown = v))} min={0} max={0.999} step={0.05} />
                  </div>
                </Prop>
                <Prop label="Retardo por velocidad" title="Retardo adicional según lo rápido que cambia el valor (SPEED_LAG); 0 = ninguno">
                  <Num value={n.speedLag ?? 0} onChange={(v) => set((x) => (x.speedLag = v > 0 ? v : undefined))} min={0} max={0.999} step={0.05} />
                </Prop>
                <Prop label="Líneas extra" title="Claves adicionales de la sección, tal cual (una por línea)">
                  <textarea rows={2} value={n.extra ?? ''} onChange={(e) => set((x) => (x.extra = e.target.value || undefined))} style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12 }} />
                </Prop>
              </>
            ) : (
              <div className="muted">Selecciona o añade una aguja.</div>
            )}
          </div>
          <div style={{ width: 260 }}>
            <h3>Nodos del modelo</h3>
            {car && (
              <select value={kn5File} onChange={(e) => setKn5File(e.target.value)} style={{ width: '100%' }}>
                {car.kn5Files.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            )}
            <input type="text" placeholder="Filtrar (vacío = candidatos a aguja)" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
            <div className="mesh-list mt8" style={{ maxHeight: 360 }}>
              {candidates.map((c) => (
                <div
                  key={c.path}
                  className={n && c.name === n.object ? 'selected' : ''}
                  title={`${c.path} (${c.kind === 'dummy' ? 'dummy' : 'malla'})`}
                  onClick={() => (n ? set((x) => ((x.object = c.name), (!x.name || x.name === NEEDLE_INPUTS.find((i) => i.id === x.input)?.label) && (x.name = c.name))) : add(c.name))}
                >
                  <span>{c.name}</span>
                  <span className="muted">{c.kind === 'dummy' ? 'dummy' : 'malla'}</span>
                </div>
              ))}
              {kn5 && candidates.length === 0 && <div className="muted small">Sin coincidencias; escribe parte del nombre.</div>}
              {!kn5 && <div className="muted small">Leyendo modelo…</div>}
            </div>
            <div className="muted small mt8">Pulsa un nodo para asignarlo a la aguja seleccionada (o crear una nueva).</div>
          </div>
        </div>
        <details className="mt8" open={showIni} onToggle={(e) => setShowIni((e.target as HTMLDetailsElement).open)}>
          <summary className="muted small">Vista previa de las secciones generadas</summary>
          <pre style={{ maxHeight: 200 }}>{generateNeedlesIni(needles) || '; (sin agujas con objeto)'}</pre>
        </details>
        <div className="row mt8">
          {car && (
            <button
              className="small danger"
              onClick={async () => {
                const idx = await api.confirm('¿Quitar las agujas del coche?', 'Se elimina el bloque de ext_config.ini y se reactivan las agujas originales. El proyecto conserva la lista.', ['Quitar', 'Cancelar']);
                if (idx !== 0) return;
                try {
                  const done = await api.removeNeedles(car.path, { kind: 'car' });
                  toast(done.join('. ') || 'No había agujas instaladas.');
                } catch (e) {
                  toast((e as Error).message, 'err');
                }
              }}
            >
              Quitar del coche
            </button>
          )}
          <span className="grow" />
          <span className="muted small">Se aplican al pulsar "Generar e instalar".</span>
          <button className="outline" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
