import { useEffect, useMemo, useState } from 'react';
import { createPhysicalButton, type PhysicalButton } from '@shared/model';
import { TOUCH_ACTIONS, TOUCH_ACTION_MAP, TOUCH_GROUPS, TOUCH_SWITCHES, isSwitchAction, switchVar } from '@shared/touch';
import type { Kn5Info } from '@shared/types';
import { api } from '../api';
import { useStore, activeDisplayOf, toast } from '../store';
import { fireTouch, type TouchSimApi } from '../render/touchSim';
import { Chk, Num, Prop, Sel, Txt } from './fields';
import { Icon } from './icons';

/**
 * Botones físicos: mallas del modelo 3D que se pulsan con el ratón dentro del coche (una botonera,
 * un pulsador del salpicadero…). CSP los resuelve con `ac.isMeshPressed` (raycast solo mientras el
 * ratón está pulsado), así que no hace falta que la pantalla sea táctil; los atiende el script del
 * display que se está editando.
 */
export function PhysicalButtonsDialog({ onClose }: { onClose: () => void }) {
  const dp = useStore(activeDisplayOf)!;
  const car = useStore((s) => s.car);
  const patchDisplay = useStore((s) => s.patchDisplay);
  const setActivePage = useStore((s) => s.setActivePage);
  const buttons = dp.physicalButtons ?? [];
  const [sel, setSel] = useState(0);
  const [kn5, setKn5] = useState<Kn5Info | null>(null);
  const [kn5File, setKn5File] = useState(car?.mainKn5 ?? car?.kn5Files[0] ?? '');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!car || !kn5File) return;
    api
      .readKn5(car.path, kn5File)
      .then(setKn5)
      .catch((e) => toast(`No se pudo leer ${kn5File}: ${(e as Error).message}`, 'err'));
  }, [car, kn5File]);

  // los coches rara vez llaman "button" a sus mallas, así que sin filtro se listan todas (por nombre)
  // y el filtro busca tanto en el nombre como en el material
  const candidates = useMemo(() => {
    if (!kn5) return [];
    const f = filter.trim().toLowerCase();
    return kn5.meshes
      .filter((m) => !f || m.name.toLowerCase().includes(f) || m.material.toLowerCase().includes(f))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 400);
  }, [kn5, filter]);

  const b = buttons[sel];
  const def = b ? TOUCH_ACTION_MAP[b.action] : undefined;
  const normalPages = dp.pages.filter((pg) => !pg.kind || pg.kind === 'normal');
  const set = (fn: (x: PhysicalButton) => void) =>
    patchDisplay((d) => {
      const t = (d.physicalButtons ?? [])[sel];
      if (t) fn(t);
    });

  function add(mesh = '') {
    patchDisplay((d) => {
      d.physicalButtons = d.physicalButtons ?? [];
      d.physicalButtons.push(createPhysicalButton(mesh));
    });
    setSel(buttons.length);
  }
  function remove(i: number) {
    patchDisplay((d) => d.physicalButtons?.splice(i, 1));
    setSel(Math.max(0, Math.min(i, buttons.length - 2)));
  }

  /** prueba de la acción en el editor (páginas e interruptores; las del coche solo avisan) */
  function test(x: PhysicalButton) {
    const api2: TouchSimApi = {
      get: (id) => useStore.getState().sim[id],
      set: (id, v) => useStore.getState().setSim(id, v),
      stepPage: (delta) => {
        const i = normalPages.findIndex((pg) => pg.id === dp.pages[useStore.getState().activePage]?.id);
        let next = (i < 0 ? 0 : i) + delta;
        const wrap = dp.settings.pageSwitch.wrap !== false;
        if (next >= normalPages.length) next = wrap ? 0 : normalPages.length - 1;
        else if (next < 0) next = wrap ? normalPages.length - 1 : 0;
        api2.gotoPage(next);
      },
      gotoPage: (i) => {
        const pg = normalPages[Math.max(0, Math.min(normalPages.length - 1, i))];
        const idx = pg ? dp.pages.findIndex((x2) => x2.id === pg.id) : -1;
        if (idx >= 0) setActivePage(idx);
      },
      indexOfPage: (pageId) => {
        const i = normalPages.findIndex((pg) => pg.id === pageId);
        return i < 0 ? null : i;
      },
      previousPage: () => 0,
      playBoot: () => useStore.getState().playBoot(),
      note: (text) => toast(text),
    };
    fireTouch({ config: { action: x.action, switch: x.switch, step: x.step, pageId: x.pageId } }, 'press', api2);
    if (isSwitchAction(x.action)) toast(`${switchVar(x.switch || 'a')} = ${useStore.getState().sim[switchVar(x.switch || 'a')] === true ? 'activado' : 'desactivado'}`);
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={{ width: 900 }} onClick={(e) => e.stopPropagation()}>
        <h2>Botones físicos del coche</h2>
        <p className="muted small">
          Mallas del modelo 3D que se pueden pulsar con el ratón dentro del coche (una botonera, un pulsador del salpicadero…). No se escribe nada en{' '}
          <code>ext_config.ini</code>: los atiende el script de <b>{dp.name}</b>, así que ese display tiene que estar instalado. CSP solo hace el raycast mientras el botón del ratón está pulsado, por lo que
          no cuesta rendimiento el resto del tiempo.
        </p>
        <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
          <div style={{ width: 230 }}>
            <h3>
              <span>Botones ({buttons.length})</span>
              <button className="small ghost" onClick={() => add()}>
                <Icon name="plus" size={12} /> Añadir
              </button>
            </h3>
            {buttons.length === 0 && <div className="muted small mb8">Sin botones. Elige una malla a la derecha o pulsa Añadir.</div>}
            {buttons.map((x, i) => (
              <div key={x.id} className={`rule ${i === sel ? 'selected' : ''}`} style={{ cursor: 'pointer', ...(i === sel ? { outline: '1px solid var(--accent)' } : {}) }} onClick={() => setSel(i)}>
                <div className="row gap4">
                  <span className="grow">
                    {x.name || x.mesh || '(sin nombre)'}
                    <div className="muted small mono">
                      {x.mesh || '— sin malla —'} · {TOUCH_ACTION_MAP[x.action]?.label ?? x.action}
                    </div>
                  </span>
                  <button className="icon" title="Quitar" onClick={(e) => ((e.stopPropagation(), remove(i)))}>
                    <Icon name="close" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="grow">
            {b ? (
              <>
                <Prop label="Nombre">
                  <Txt value={b.name} onChange={(v) => set((x) => (x.name = v))} />
                </Prop>
                <Prop label="Malla" title='Nombre exacto de la malla del kn5; también valen los filtros de CSP: "{ mesh1, mesh2 }" o "material:MiMaterial"'>
                  <Txt value={b.mesh} onChange={(v) => set((x) => (x.mesh = v))} />
                </Prop>
                <Prop label="Acción">
                  <Sel
                    value={b.action}
                    onChange={(v) => set((x) => (x.action = v as typeof x.action))}
                    options={TOUCH_GROUPS.flatMap((grp) => TOUCH_ACTIONS.filter((a) => a.group === grp).map((a) => ({ value: a.id, label: `${grp} · ${a.label}` })))}
                  />
                </Prop>
                {def?.note && <div className="muted small mb8">{def.note}</div>}
                {b.action === 'page_go' && (
                  <Prop label="Página destino">
                    <Sel value={b.pageId ?? normalPages[0]?.id ?? ''} onChange={(v) => set((x) => (x.pageId = v))} options={normalPages.map((pg) => ({ value: pg.id, label: pg.name }))} />
                  </Prop>
                )}
                {isSwitchAction(b.action) && (
                  <Prop label="Interruptor" title="Variable interna del display (Interruptor táctil A…F): úsala en reglas, iconos o condiciones de página">
                    <Sel value={b.switch} onChange={(v) => set((x) => (x.switch = v))} options={TOUCH_SWITCHES.map((k) => ({ value: k, label: `Interruptor ${k.toUpperCase()} (${switchVar(k)})` }))} />
                  </Prop>
                )}
                <Prop label="Pulsación" title="tap: actúa al pulsar · mientras se mantiene: hasta soltar · repetir: repite mientras se mantiene">
                  <Sel
                    value={b.behavior}
                    onChange={(v) => set((x) => (x.behavior = v))}
                    options={[
                      { value: 'tap', label: 'Al pulsar' },
                      { value: 'hold', label: 'Mientras se mantiene' },
                      { value: 'repeat', label: 'Repetir al mantener' },
                    ]}
                  />
                </Prop>
                {b.behavior === 'repeat' && (
                  <Prop label="Repetir cada (ms)">
                    <Num value={b.repeatMs} onChange={(v) => set((x) => (x.repeatMs = Math.max(50, v)))} min={50} max={2000} step={10} />
                  </Prop>
                )}
                {def?.usesStep && (
                  <Prop label="Paso">
                    <Num value={b.step} onChange={(v) => set((x) => (x.step = Math.max(0, v)))} min={0} step={0.005} />
                  </Prop>
                )}
                <h3>Zona sensible (opcional)</h3>
                <div className="muted small mb8">
                  Si la botonera es una sola malla, limita cada botón a su parte: por región de la textura (UV) o por cercanía a un punto del coche. Sin límites, vale toda la malla.
                </div>
                <Prop label="Región UV" title="Parte de la UV de la malla que corresponde a este botón (0–1)">
                  <div className="row gap4">
                    <Chk
                      value={!!b.uv}
                      label=""
                      onChange={(v) => set((x) => (x.uv = v ? { x: 0, y: 0, width: 0.5, height: 0.5 } : undefined))}
                    />
                    <Num value={b.uv?.x ?? 0} disabled={!b.uv} min={0} max={1} step={0.01} onChange={(v) => set((x) => x.uv && (x.uv.x = v))} />
                    <Num value={b.uv?.y ?? 0} disabled={!b.uv} min={0} max={1} step={0.01} onChange={(v) => set((x) => x.uv && (x.uv.y = v))} />
                    <Num value={b.uv?.width ?? 1} disabled={!b.uv} min={0.01} max={1} step={0.01} onChange={(v) => set((x) => x.uv && (x.uv.width = v))} />
                    <Num value={b.uv?.height ?? 1} disabled={!b.uv} min={0.01} max={1} step={0.01} onChange={(v) => set((x) => x.uv && (x.uv.height = v))} />
                  </div>
                </Prop>
                <Prop label="Punto y radio (m)" title="Solo se registran las pulsaciones que caigan a menos de ese radio del punto, en coordenadas del coche (X derecha, Y arriba, Z adelante)">
                  <div className="row gap4">
                    <Chk value={!!b.point} label="" onChange={(v) => set((x) => ((x.point = v ? { x: 0, y: 0, z: 0 } : undefined), (x.radius = v ? 0.03 : undefined)))} />
                    <Num value={b.point?.x ?? 0} disabled={!b.point} step={0.005} onChange={(v) => set((x) => x.point && (x.point.x = v))} />
                    <Num value={b.point?.y ?? 0} disabled={!b.point} step={0.005} onChange={(v) => set((x) => x.point && (x.point.y = v))} />
                    <Num value={b.point?.z ?? 0} disabled={!b.point} step={0.005} onChange={(v) => set((x) => x.point && (x.point.z = v))} />
                    <span className="muted small">r</span>
                    <Num value={b.radius ?? 0.03} disabled={!b.point} min={0.005} step={0.005} onChange={(v) => set((x) => (x.radius = v))} />
                  </div>
                </Prop>
                {b.point && (
                  <Prop label="Coordenadas">
                    <Chk value={!!b.localPoint} label="Locales a la malla (no del coche)" onChange={(v) => set((x) => (x.localPoint = v || undefined))} />
                  </Prop>
                )}
                <div className="row mt8 gap4">
                  <button className="small outline" onClick={() => test(b)}>
                    Probar la acción aquí
                  </button>
                  <span className="muted small">Cambia de página o conmuta el interruptor en el editor; las acciones del coche solo ocurren en el juego.</span>
                </div>
              </>
            ) : (
              <div className="muted">Selecciona o añade un botón.</div>
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
            <input type="text" placeholder="Filtrar por nombre o material" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: '100%', marginTop: 6 }} />
            <div className="mesh-list mt8" style={{ maxHeight: 360 }}>
              {candidates.map((m) => (
                <div
                  key={m.name}
                  className={b && m.name === b.mesh ? 'selected' : ''}
                  title={`${m.name} — material ${m.material}`}
                  onClick={() => (b ? set((x) => ((x.mesh = m.name), (!x.name || x.name === 'Botón físico') && (x.name = m.name))) : add(m.name))}
                >
                  <span>{m.name}</span>
                  <span className="muted" style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
                    {m.material}
                  </span>
                </div>
              ))}
              {kn5 && candidates.length === 0 && <div className="muted small">Sin coincidencias; escribe parte del nombre.</div>}
              {!kn5 && <div className="muted small">Leyendo modelo…</div>}
            </div>
            <div className="muted small mt8">
              Pulsa una malla para asignarla al botón seleccionado (o crear uno nuevo). También valen los filtros de CSP:{' '}
              <code>{'{ mesh1, mesh2 }'}</code> o <code>material:MiMaterial</code>.
            </div>
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
