import { useMemo } from 'react';
import { VARIABLES, VARIABLE_MAP } from '@shared/variables';
import { collectVariables } from '@shared/generator';
import { pageConditions } from '@shared/model';
import { useStore, activeDisplayOf } from '../store';

const MAIN = ['rpm', 'speed', 'gear', 'throttle', 'brake', 'fuel', 'water_temp', 'oil_temp', 'oil_pressure', 'delta', 'lap_time', 'last_lap', 'best_lap', 'battery_voltage', 'turbo_boost', 'race_position'];
const MAIN_BOOL = ['limiter_on', 'abs_active', 'tc_active', 'headlights', 'high_beams', 'turn_left', 'turn_right', 'pit_limiter', 'in_pitlane', 'is_replay', 'drs_active'];

const SCENARIOS: { label: string; values: Record<string, number | boolean> }[] = [
  { label: 'Ralentí', values: { rpm: 900, speed: 0, gear: 0, throttle: 0, brake: 0, limiter_on: false } },
  { label: 'Vuelta rápida', values: { rpm: 6800, speed: 164, gear: 4, throttle: 1, brake: 0, limiter_on: false, delta: -0.42 } },
  { label: 'Corte', values: { rpm: 8000, speed: 187, gear: 5, throttle: 1, brake: 0, limiter_on: true } },
  { label: 'Boxes', values: { rpm: 3200, speed: 78, gear: 2, throttle: 0.3, pit_limiter: true, in_pitlane: true, limiter_on: false } },
  { label: 'Avisos', values: { water_temp: 121, oil_pressure: 0.6, fuel: 3, battery_voltage: 11.4, abs_active: true, tc_active: true, limiter_on: false } },
];

export function PreviewPanel() {
  const dp = useStore(activeDisplayOf);
  const activePage = useStore((s) => s.activePage);
  const setActivePage = useStore((s) => s.setActivePage);
  const followPageRules = useStore((s) => s.followPageRules);
  const setFollowPageRules = useStore((s) => s.setFollowPageRules);
  const sim = useStore((s) => s.sim);
  const setSim = useStore((s) => s.setSim);
  const resetSim = useStore((s) => s.resetSim);
  const simAuto = useStore((s) => s.simAuto);
  const setSimAuto = useStore((s) => s.setSimAuto);
  const ambient = useStore((s) => s.ambient);
  const setAmbient = useStore((s) => s.setAmbient);
  const profile = useStore((s) => s.profile);

  const ids = useMemo(() => {
    const used = dp ? collectVariables(dp) : [];
    const all = [...new Set([...used, ...MAIN])].filter((id) => VARIABLE_MAP[id] && VARIABLE_MAP[id].type !== 'boolean');
    return all;
  }, [dp]);
  const bools = useMemo(() => {
    const used = dp ? collectVariables(dp) : [];
    return [...new Set([...used, ...MAIN_BOOL])].filter((id) => VARIABLE_MAP[id]?.type === 'boolean');
  }, [dp]);

  const limiter = profile?.displays.find((d) => d.id === dp?.display_id)?.defaults.rpm_limiter ?? 8000;

  return (
    <div>
      <div className="sim-head">
        <h3>Simulación</h3>
        {SCENARIOS.map((sc) => (
          <button
            key={sc.label}
            className="scenario"
            onClick={() => {
              for (const [k, v] of Object.entries(sc.values)) setSim(k, k === 'rpm' && v === 8000 ? limiter : v);
            }}
          >
            {sc.label}
          </button>
        ))}
        <button className={`scenario ${simAuto ? 'active' : ''}`} onClick={() => setSimAuto(!simAuto)}>
          RPM automáticas
        </button>
        <button className="scenario" onClick={resetSim}>
          Reiniciar
        </button>
        {dp && dp.pages.length > 1 && (
          <span className="row" style={{ gap: 2, marginLeft: 8 }}>
            <span className="muted small">Página:</span>
            {dp.pages.map((pg, i) => (
              <button key={pg.id} className={`scenario ${i === activePage && !followPageRules ? 'active' : ''}`} onClick={() => (setFollowPageRules(false), setActivePage(i))}>
                {pg.kind === 'boot' ? '▶ ' : pg.kind === 'function' ? '⚡ ' : ''}
                {pg.name}
              </button>
            ))}
            {dp.pages.some((pg) => pageConditions(pg).length > 0 || pg.kind) && (
              <button className={`scenario ${followPageRules ? 'active' : ''}`} onClick={() => setFollowPageRules(!followPageRules)} title="En modo previsualización, cambiar de página como en el juego (arranque, botones, condiciones)">
                Automático
              </button>
            )}
          </span>
        )}
        {dp && dp.pages.some((pg) => pg.kind === 'boot') && (
          <button className="scenario" onClick={() => useStore.getState().playBoot()} title="Reproduce la secuencia de arranque completa con su temporización, vídeos y fundidos, y pasa a la página principal">
            ▶ Reproducir arranque
          </button>
        )}
        <span className="grow" />
        <label className="row small muted">
          Ambiente día/noche
          <input type="range" min={0.2} max={1} step={0.05} value={ambient} onChange={(e) => setAmbient(parseFloat(e.target.value))} style={{ width: 100 }} />
        </label>
      </div>
      <div className="sim-grid">
        {ids.map((id) => {
          const def = VARIABLE_MAP[id];
          const [min, max] = id === 'rpm' ? [0, Math.round(limiter * 1.05)] : def.range;
          const v = Number(sim[id] ?? 0);
          const step = def.type === 'integer' ? 1 : def.type === 'time_ms' ? 100 : (max - min) / 200;
          return (
            <div key={id} className="sim-item" title={def.description || def.lua}>
              <label>
                <span>
                  {def.label}
                  {def.physics_only ? ' *' : ''}
                </span>
                <span className="val">
                  {def.type === 'time_ms' ? (v / 1000).toFixed(1) + 's' : def.unit === '%' ? Math.round(v * 100) + '%' : Math.round(v * 100) / 100}
                  {def.unit && def.unit !== '%' && def.type !== 'time_ms' ? ` ${def.unit}` : ''}
                </span>
              </label>
              <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setSim(id, parseFloat(e.target.value))} />
            </div>
          );
        })}
      </div>
      <div className="sim-toggles">
        {bools.map((id) => (
          <button key={id} className={sim[id] === true ? 'active' : ''} onClick={() => setSim(id, !(sim[id] === true))}>
            {VARIABLE_MAP[id].label}
          </button>
        ))}
      </div>
      {VARIABLES.some((v) => v.physics_only && (ids.includes(v.id) || bools.includes(v.id))) && (
        <div className="muted small mt8">* Variables no disponibles en replays ni en coches remotos (activa "Es replay" para comprobar el comportamiento).</div>
      )}
    </div>
  );
}
