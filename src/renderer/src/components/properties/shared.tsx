import type { DisplayElement, ElementAnim, Glow, PageCondition, PageTrigger, Rule, TextStyle, Threshold } from '@shared/model';
import { DEFAULT_ANIM, DEFAULT_GLOW, newId } from '@shared/model';
import type { DisplayDef, DisplayProfile } from '@shared/profile';
import { VARIABLE_MAP } from '@shared/variables';
import { api } from '../../api';
import { useStore, toast } from '../../store';
import { Chk, ColorField, FontSelect, Num, Prop, RpmField, Sel, VarSelect } from '../fields';
import { Icon } from '../icons';

/**
 * Piezas comunes del panel de propiedades: controles reutilizables (destello, estilo de texto,
 * imagen, umbrales), editores de reglas/condiciones y utilidades compartidas.
 */

export const BUTTON_OPTIONS = [
  { value: 'kers_button', label: 'Botón KERS' },
  ...(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const).map((l) => ({ value: `extra_${l}`, label: `Extra ${l.toUpperCase()}` })),
  { value: 'drs_active', label: 'DRS' },
  { value: 'handbrake_on', label: 'Freno de mano' },
  { value: 'clutch_full', label: 'Embrague a fondo' },
  { value: 'pit_limiter', label: 'Limitador de boxes' },
  { value: 'headlights', label: 'Luces' },
  { value: 'high_beams', label: 'Luces largas' },
];

/** Destello y ciclo de parpadeo de una luz. */
export function GlowProps({ glow, blinkDuty, hasBlink, onGlow, onDuty }: { glow: Glow | undefined; blinkDuty: number | undefined; hasBlink: boolean; onGlow: (g: Glow) => void; onDuty: (d: number) => void }) {
  const g = glow ?? DEFAULT_GLOW;
  return (
    <>
      <h3>Luminancia y destello</h3>
      <Prop label="Luminancia" title="Brillo de la luz encendida: 1 = el color tal cual; 1,5–3 la satura hacia blanco y refuerza el halo (en el juego, con la pantalla emisiva, hace que CSP la haga florecer)">
        <Num value={g.luminance ?? 1} onChange={(v) => onGlow({ ...g, luminance: Math.max(0.2, Math.min(4, v)) })} min={0.2} max={4} step={0.1} />
      </Prop>
      <Prop label="Núcleo" title="Punto caliente blanquecino en el centro de la luz (0 = ninguno, 1 = máximo); depende también de la luminancia">
        <Num value={g.core ?? 0.5} onChange={(v) => onGlow({ ...g, core: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.1} />
      </Prop>
      <Prop label="Halo (px)" title="Tamaño del resplandor alrededor de la luz encendida; 0 = sin halo">
        <Num value={g.size} onChange={(v) => onGlow({ ...g, size: Math.max(0, v) })} min={0} max={200} />
      </Prop>
      <Prop label="Intensidad halo" title="Opacidad del halo (0–1)">
        <Num value={g.intensity} onChange={(v) => onGlow({ ...g, intensity: Math.max(0, Math.min(1, v)) })} min={0} max={1} step={0.1} />
      </Prop>
      {hasBlink && (
        <Prop label="Parpadeo: % encendido" title="Parte del ciclo de parpadeo en que la luz está encendida (50 = simétrico; menos = destellos cortos)">
          <Num value={Math.round((blinkDuty ?? 0.5) * 100)} onChange={(v) => onDuty(Math.max(5, Math.min(95, v)) / 100)} min={5} max={95} step={5} />
        </Prop>
      )}
    </>
  );
}

/** Selector de textura (asset de imagen del proyecto) con botón para quitarla. */
export function ImageField({ value, onChange, onSize }: { value: string | undefined; onChange: (v: string | undefined) => void; onSize?: (w: number, h: number) => void }) {
  return (
    <div className="row gap4">
      <span className="small mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={value}>
        {value ? value.split('/').pop() : '—'}
      </span>
      <button
        className="small outline"
        onClick={async () => {
          const a = await api.pickAsset('image');
          if (!a) return;
          if (a.error) toast(a.error, 'err');
          useStore.getState().addAssetUrl(a.path, a.dataUrl);
          onChange(a.path);
          if (a.width && a.height && onSize) onSize(a.width, a.height);
        }}
      >
        Elegir…
      </button>
      {value && (
        <button className="icon" title="Quitar textura" onClick={() => onChange(undefined)}>
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}

export function applyRange(e: DisplayElement, variable: string): void {
  const def = VARIABLE_MAP[variable];
  if (!def) return;
  if (e.type === 'bar' || e.type === 'gauge' || e.type === 'needle') {
    e.config.min = def.range[0];
    e.config.max = def.range[1];
  }
}

export function centerEl(w: number | undefined, h: number | undefined, id: string, d: { pages: { elements: DisplayElement[] }[] }): void {
  const el = d.pages.flatMap((pg) => pg.elements).find((e) => e.id === id);
  if (!el) return;
  if (w !== undefined) el.x = Math.round(w / 2 - el.width / 2);
  if (h !== undefined) el.y = Math.round(h / 2 - el.height / 2);
}

export function typeLabel(t: DisplayElement['type']): string {
  return {
    text: 'Texto',
    rpm_bar: 'Barra RPM',
    shift_light: 'Shift light',
    bar: 'Barra',
    gear: 'Marcha',
    icon: 'Icono',
    image: 'Imagen',
    rect: 'Rectángulo',
    line: 'Línea',
    circle: 'Círculo',
    gauge: 'Indicador circular',
    shift_lights: 'Luces de cambio',
    needle: 'Aguja',
    video: 'Vídeo',
    button: 'Botón táctil',
  }[t];
}

export function StyleProps({ style, onChange }: { style: TextStyle; onChange: (s: TextStyle) => void }) {
  const set = (patch: Partial<TextStyle>) => onChange({ ...style, ...patch });
  return (
    <>
      <Prop label="Fuente">
        <div className="row gap4">
          <FontSelect value={style.font} onChange={(v) => set({ font: v })} />
          <button
            className="icon"
            title="Importar fuente TTF/OTF al proyecto"
            onClick={async () => {
              const a = await api.pickAsset('font');
              if (!a?.name) return;
              useStore.getState().patchDisplay((d) => (d.fonts[a.name!] = a.path));
              const face = new FontFace(a.name, `url(${a.dataUrl})`);
              face.load().then((f) => document.fonts.add(f)).catch(() => undefined);
              set({ font: a.name });
            }}
          >
            <Icon name="plus" size={12} />
          </button>
        </div>
      </Prop>
      <Prop label="Tamaño / Espaciado">
        <div className="pair">
          <Num value={style.size} onChange={(v) => set({ size: v })} min={4} />
          <Num value={style.letterSpacing} onChange={(v) => set({ letterSpacing: v })} />
        </div>
      </Prop>
      <Prop label="Color">
        <ColorField value={style.color} onChange={(v) => set({ color: v })} />
      </Prop>
      <Prop label="Alineación">
        <div className="pair">
          <Sel value={style.align} onChange={(v) => set({ align: v })} options={[{ value: 'left', label: 'Izquierda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Derecha' }]} />
          <Sel value={style.valign} onChange={(v) => set({ valign: v })} options={[{ value: 'top', label: 'Arriba' }, { value: 'middle', label: 'Medio' }, { value: 'bottom', label: 'Abajo' }]} />
        </div>
      </Prop>
      <Prop label="Negrita">
        <Chk value={style.bold} onChange={(v) => set({ bold: v })} />
      </Prop>
    </>
  );
}

export function unitChoices(base: string): { value: string; label: string }[] {
  const map: Record<string, string[]> = { 'km/h': ['mph'], '°C': ['°F'], bar: ['psi'], psi: ['bar'], L: ['gal'] };
  const alts = map[base];
  if (!alts) return [];
  return [{ value: '', label: `${base} (automático)` }, { value: base, label: base }, ...alts.map((a) => ({ value: a, label: a }))];
}

export function ThresholdsEditor({ thresholds, onChange }: { thresholds: Threshold[]; onChange: (t: Threshold[]) => void }) {
  return (
    <div className="mt8">
      <h3>
        <span>Umbrales de color</span>
        <button className="small ghost" onClick={() => onChange([...thresholds, { value: 0, color: '#FF2D2D' }])}>
          <Icon name="plus" size={12} /> Añadir
        </button>
      </h3>
      {thresholds.map((t, i) => (
        <div key={i} className="row gap4 mb8">
          <span className="muted small">≥</span>
          <Num value={t.value} onChange={(v) => onChange(thresholds.map((x, j) => (j === i ? { ...x, value: v } : x)))} />
          <ColorField value={t.color} onChange={(v) => onChange(thresholds.map((x, j) => (j === i ? { ...x, color: v } : x)))} />
          <button className="icon" onClick={() => onChange(thresholds.filter((_, j) => j !== i))}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Animación de entrada/salida del elemento respecto al momento en que se muestra su página. */
export function AnimProps({ el, update }: { el: DisplayElement; update: (fn: (e: DisplayElement) => void) => void }) {
  const a: ElementAnim = { ...DEFAULT_ANIM, ...(el.anim ?? {}) };
  const set = (patch: Partial<ElementAnim>) => update((e) => (e.anim = { ...DEFAULT_ANIM, ...(e.anim ?? {}), ...patch }));
  const active = a.delay > 0 || a.fadeIn > 0 || a.fadeOut > 0;
  return (
    <div className="prop-group">
      <h3>
        <span>Animación</span>
        {active && (
          <button className="small ghost" onClick={() => update((e) => (e.anim = undefined))}>
            Quitar
          </button>
        )}
      </h3>
      <Prop label="Retardo / Entrada (s)" title="Segundos hasta aparecer y duración del fundido de entrada, contados desde que se muestra la página">
        <div className="pair">
          <Num value={a.delay} onChange={(v) => set({ delay: Math.max(0, v) })} min={0} step={0.1} />
          <Num value={a.fadeIn} onChange={(v) => set({ fadeIn: Math.max(0, v) })} min={0} step={0.1} />
        </div>
      </Prop>
      <Prop label="Salida (s)" title="Fundido de salida antes de que termine la pantalla de arranque (solo páginas de arranque)">
        <Num value={a.fadeOut} onChange={(v) => set({ fadeOut: Math.max(0, v) })} min={0} step={0.1} />
      </Prop>
      <Prop label="Desde / Distancia" title="Desplazamiento de entrada (se combina con el fundido)">
        <div className="pair">
          <Sel value={a.from} onChange={(v) => set({ from: v })} options={[{ value: 'none', label: 'Sin desplazar' }, { value: 'up', label: 'Arriba' }, { value: 'down', label: 'Abajo' }, { value: 'left', label: 'Izquierda' }, { value: 'right', label: 'Derecha' }]} />
          <Num value={a.distance} onChange={(v) => set({ distance: v })} min={0} />
        </div>
      </Prop>
      <div className="muted small">Se ve en previsualización con "Automático" o "Reproducir arranque"; en edición los elementos se muestran en su estado final.</div>
    </div>
  );
}

/** Editor de una lista de condiciones (variable / operador / valor). */
export function CondList({ list, onChange, limiter, emptyLabel }: { list: PageCondition[]; onChange: (l: PageCondition[]) => void; limiter: number; emptyLabel: string }) {
  const setAt = (i: number, patch: Partial<PageCondition>) => onChange(list.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="col gap4">
      {list.length === 0 && <div className="muted small">{emptyLabel}</div>}
      {list.map((c, i) => (
        <div key={i} className="row gap4">
          <VarSelect value={c.variable} onChange={(v) => v && setAt(i, { variable: v, value: VARIABLE_MAP[v]?.type === 'boolean' ? true : 0, op: VARIABLE_MAP[v]?.type === 'boolean' ? '==' : c.op })} />
          {VARIABLE_MAP[c.variable]?.type === 'boolean' ? (
            <Sel value={c.value === true ? 'true' : 'false'} onChange={(v) => setAt(i, { op: '==', value: v === 'true' })} options={[{ value: 'true', label: 'activo' }, { value: 'false', label: 'inactivo' }]} />
          ) : (
            <>
              <select value={c.op} onChange={(e) => setAt(i, { op: e.target.value as PageCondition['op'] })} style={{ width: 56 }}>
                {['>', '>=', '<', '<=', '==', '!='].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              {c.variable === 'rpm' ? (
                <RpmField value={typeof c.value === 'boolean' ? 0 : c.value} limiter={limiter} onChange={(v) => setAt(i, { value: v })} />
              ) : (
                <Num value={Number(c.value)} onChange={(v) => setAt(i, { value: v })} />
              )}
            </>
          )}
          <button className="icon" title="Quitar condición" onClick={() => onChange(list.filter((_, j) => j !== i))}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <button className="small ghost" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...list, { variable: 'speed', op: '<', value: 5 }])}>
        <Icon name="plus" size={12} /> Condición
      </button>
    </div>
  );
}

/** Activador de una pantalla de funcionalidad. */
export function TriggerProps({ tr, onChange, limiter }: { tr: PageTrigger; onChange: (t: PageTrigger) => void; limiter: number }) {
  const set = (patch: Partial<PageTrigger>) => onChange({ ...tr, ...patch });
  const known = BUTTON_OPTIONS.some((o) => o.value === tr.input);
  return (
    <div className="col gap4 mt8">
      <Prop label="Activador" title="Botón o estado que muestra esta pantalla">
        <Sel value={known ? tr.input : '__other'} onChange={(v) => v !== '__other' && set({ input: v })} options={[...BUTTON_OPTIONS, { value: '__other', label: 'Otra variable…' }]} />
      </Prop>
      {!known && (
        <Prop label="Variable">
          <VarSelect value={tr.input} onlyBoolean onChange={(v) => v && set({ input: v })} />
        </Prop>
      )}
      <Prop label="Modo">
        <Sel value={tr.mode} onChange={(v) => set({ mode: v })} options={[{ value: 'hold', label: 'Mientras se mantiene' }, { value: 'toggle', label: 'Conmutar (pulsar entra / pulsar sale)' }, { value: 'latch', label: 'Enclavar (entra con el botón, sale por condición)' }]} />
      </Prop>
      <Prop label="Prioridad / Salir a" title="Si varias pantallas se activan a la vez gana la de mayor prioridad">
        <div className="pair">
          <Num value={tr.priority} onChange={(v) => set({ priority: Math.round(v) })} />
          <Sel value={tr.returnTo} onChange={(v) => set({ returnTo: v })} options={[{ value: 'previous', label: 'Página anterior' }, { value: 'main', label: 'Principal' }]} />
        </div>
      </Prop>
      <div className="small muted">Entrar solo si (todas):</div>
      <CondList list={tr.enter} onChange={(l) => set({ enter: l })} limiter={limiter} emptyLabel="Sin condiciones de entrada." />
      {tr.mode !== 'hold' && (
        <>
          <div className="small muted">Salir cuando (cualquiera):</div>
          <CondList list={tr.exit} onChange={(l) => set({ exit: l })} limiter={limiter} emptyLabel="Sin condiciones de salida." />
          <Prop label="Salir tras (s)" title="0 = no se cierra sola">
            <Num value={tr.exitAfterS} onChange={(v) => set({ exitAfterS: Math.max(0, v) })} min={0} step={0.5} />
          </Prop>
        </>
      )}
    </div>
  );
}

export function RulesEditor({ el, update, limiter }: { el: DisplayElement; update: (fn: (e: DisplayElement) => void) => void; limiter: number }) {
  const setRule = (id: string, fn: (r: Rule) => void) =>
    update((e) => {
      const r = e.rules.find((x) => x.id === id);
      if (r) fn(r);
    });
  return (
    <div className="prop-group">
      <h3>
        <span>Estados (reglas)</span>
        <button className="small ghost" onClick={() => update((e) => e.rules.push({ id: newId('rule'), when: { variable: 'rpm', op: '>=', value: '95%' }, set: { color: '#FF2D2D' } }))}>
          <Icon name="plus" size={12} /> Añadir
        </button>
      </h3>
      {el.rules.length === 0 && <div className="muted small">Sin reglas. Una regla cambia color, visibilidad, opacidad o parpadeo cuando una variable cumple una condición.</div>}
      {el.rules.map((r) => {
        const def = VARIABLE_MAP[r.when.variable];
        const isBool = def?.type === 'boolean';
        return (
          <div key={r.id} className="rule">
            <div className="row gap4">
              <span className="muted small">Si</span>
              <VarSelect value={r.when.variable} onChange={(v) => v && setRule(r.id, (x) => ((x.when.variable = v), (x.when.value = VARIABLE_MAP[v]?.type === 'boolean' ? true : 0)))} />
              <button className="icon" onClick={() => update((e) => (e.rules = e.rules.filter((x) => x.id !== r.id)))}>
                <Icon name="close" size={12} />
              </button>
            </div>
            <div className="row gap4">
              {isBool ? (
                <Sel value={r.when.value === true ? 'true' : 'false'} onChange={(v) => setRule(r.id, (x) => ((x.when.op = '=='), (x.when.value = v === 'true')))} options={[{ value: 'true', label: 'está activo' }, { value: 'false', label: 'NO está activo' }]} />
              ) : (
                <>
                  <select value={r.when.op} onChange={(e) => setRule(r.id, (x) => (x.when.op = e.target.value as Rule['when']['op']))} style={{ width: 56 }}>
                    {['>', '>=', '<', '<=', '==', '!='].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  {r.when.variable === 'rpm' ? (
                    <RpmField value={typeof r.when.value === 'boolean' ? 0 : r.when.value} limiter={limiter} onChange={(v) => setRule(r.id, (x) => (x.when.value = v))} />
                  ) : (
                    <Num value={Number(r.when.value)} onChange={(v) => setRule(r.id, (x) => (x.when.value = v))} />
                  )}
                </>
              )}
            </div>
            <div className="row gap4 wrap">
              <Chk value={r.set.color !== undefined} label="Color" onChange={(v) => setRule(r.id, (x) => (x.set.color = v ? '#FF2D2D' : undefined))} />
              {r.set.color !== undefined && <ColorField value={r.set.color} onChange={(v) => setRule(r.id, (x) => (x.set.color = v))} />}
            </div>
            <div className="row gap4 wrap">
              <Chk value={r.set.visible !== undefined} label="Visibilidad" onChange={(v) => setRule(r.id, (x) => (x.set.visible = v ? false : undefined))} />
              {r.set.visible !== undefined && (
                <Sel value={r.set.visible ? 'show' : 'hide'} onChange={(v) => setRule(r.id, (x) => (x.set.visible = v === 'show'))} options={[{ value: 'hide', label: 'ocultar' }, { value: 'show', label: 'mostrar' }]} />
              )}
            </div>
            <div className="row gap4 wrap">
              <Chk value={r.set.blinkHz !== undefined} label="Parpadeo (Hz)" onChange={(v) => setRule(r.id, (x) => (x.set.blinkHz = v ? 4 : undefined))} />
              {r.set.blinkHz !== undefined && <Num value={r.set.blinkHz} onChange={(v) => setRule(r.id, (x) => (x.set.blinkHz = v))} min={0.5} max={30} step={0.5} />}
              <Chk value={r.set.opacity !== undefined} label="Opacidad" onChange={(v) => setRule(r.id, (x) => (x.set.opacity = v ? 0.5 : undefined))} />
              {r.set.opacity !== undefined && <Num value={r.set.opacity} onChange={(v) => setRule(r.id, (x) => (x.set.opacity = v))} min={0} max={1} step={0.05} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Guarda un cambio en la definición del display del perfil (y en extension/display_profile.json). */
export async function saveDisplayDef(displayId: string, patch: Partial<DisplayDef>): Promise<void> {
  const s = useStore.getState();
  if (!s.profile) return;
  const next: DisplayProfile = { ...s.profile, displays: s.profile.displays.map((d) => (d.id === displayId ? { ...d, ...patch } : d)) };
  let file = s.profileFile;
  if (s.car) {
    try {
      file = await api.saveProfileToCar(next, s.car.path);
    } catch (e) {
      toast(`No se pudo guardar el perfil en el vehículo: ${(e as Error).message}`, 'err');
    }
  }
  s.setProfile(next, file);
}
