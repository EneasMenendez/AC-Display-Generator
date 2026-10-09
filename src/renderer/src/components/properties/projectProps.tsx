import type { DisplayProfile } from '@shared/profile';
import { DEFAULT_TOUCH, createTrigger, pageConditions, setPageConditions } from '@shared/model';
import { TEMPLATES, createTemplatePage, type TemplateId } from '@shared/templates';
import { switchVar, displayHasTouch, usedSwitches } from '@shared/touch';
import type { DisplayDef } from '@shared/profile';
import { hasUvRegion, physicalSizeFromMesh, regionFromKn5Uv, regionFromPx, uvRegionPx, type UvRegion } from '@shared/uv';
import { api } from '../../api';
import { useStore, toast, activeDisplayOf } from '../../store';
import { Chk, ColorField, Num, Prop, Sel, Txt } from '../fields';
import { Icon } from '../icons';
import { BUTTON_OPTIONS, CondList, TriggerProps, saveDisplayDef } from './shared';

/**
 * Propiedades cuando no hay nada seleccionado: proyecto, display (área visible, emisión, táctil,
 * refresco…), páginas y fondo.
 */

/**
 * Área visible: parte de la textura que la malla muestra realmente (rectángulo UV). Se guarda en el
 * perfil del display (extension/display_profile.json) y el editor la marca sobre el lienzo.
 */
export function VisibleAreaProps({ display }: { display: DisplayDef }) {
  const dp = useStore(activeDisplayOf)!;
  const profile = useStore((s) => s.profile)!;
  const car = useStore((s) => s.car);
  const setProfile = useStore((s) => s.setProfile);
  const profileFile = useStore((s) => s.profileFile);
  const tex = dp.canvas;
  const px = uvRegionPx({ uv_region: display.uv_region, texture_size: tex });
  const active = hasUvRegion(display);

  async function apply(region: UvRegion | null, physical?: { width: number; height: number } | null) {
    const next: DisplayProfile = {
      ...profile,
      displays: profile.displays.map((d) => (d.id === display.id ? { ...d, uv_region: region ?? { x: 0, y: 0, width: 1, height: 1 }, ...(physical ? { physical_size_m: physical } : {}) } : d)),
    };
    let file = profileFile;
    if (car) {
      try {
        file = await api.saveProfileToCar(next, car.path);
      } catch (e) {
        toast(`No se pudo guardar el perfil en el vehículo: ${(e as Error).message}`, 'err');
      }
    }
    setProfile(next, file);
  }
  const setPx = (patch: Partial<typeof px>) => {
    const n = { ...px, ...patch };
    n.x = Math.max(0, Math.min(tex.width - 1, n.x));
    n.y = Math.max(0, Math.min(tex.height - 1, n.y));
    n.width = Math.max(1, Math.min(tex.width - n.x, n.width));
    n.height = Math.max(1, Math.min(tex.height - n.y, n.height));
    void apply(regionFromPx(n, tex));
  };
  async function detect() {
    if (!car?.mainKn5) return toast('El vehículo no tiene un modelo kn5 legible.', 'err');
    try {
      const kn5 = await api.readKn5(car.path, car.mainKn5);
      const mesh = kn5.meshes.find((m) => display.meshes.some((n) => n.toLowerCase() === m.name.toLowerCase()));
      if (!mesh) return toast(`La malla ${display.meshes.join(', ')} no está en ${car.mainKn5}.`, 'err');
      const region = regionFromKn5Uv(mesh.uv);
      if (!region) return toast('La malla usa coordenadas UV fuera de la textura (repetida o con bisel): ajusta el área a mano.', 'err');
      await apply(region, physicalSizeFromMesh(mesh.size));
      const r = uvRegionPx({ uv_region: region, texture_size: tex });
      toast(hasUvRegion({ uv_region: region }) ? `Área visible: ${r.width}×${r.height} px desde (${r.x}, ${r.y})` : 'La malla muestra toda la textura.');
    } catch (e) {
      toast((e as Error).message, 'err');
    }
  }
  return (
    <div className="prop-group">
      <h3>
        <span>Área visible</span>
        <button className="small ghost" title="Leer el rectángulo UV de la malla en el modelo kn5" onClick={detect}>
          <Icon name="refresh" size={12} /> Detectar
        </button>
      </h3>
      <div className="muted small mb8">
        {active
          ? `La malla muestra ${px.width}×${px.height} px de la textura desde (${px.x}, ${px.y}); lo que quede fuera no se ve en el coche.`
          : 'La malla muestra toda la textura. Si en el juego el contenido aparece desplazado o recortado, pulsa Detectar.'}
      </div>
      <Prop label="Origen X / Y">
        <div className="pair">
          <Num value={px.x} onChange={(v) => setPx({ x: Math.round(v) })} min={0} />
          <Num value={px.y} onChange={(v) => setPx({ y: Math.round(v) })} min={0} />
        </div>
      </Prop>
      <Prop label="Ancho / Alto">
        <div className="pair">
          <Num value={px.width} onChange={(v) => setPx({ width: Math.round(v) })} min={1} />
          <Num value={px.height} onChange={(v) => setPx({ height: Math.round(v) })} min={1} />
        </div>
      </Prop>
      {active && (
        <button className="small ghost" onClick={() => apply(null)}>
          Usar toda la textura
        </button>
      )}
    </div>
  );
}

/**
 * Emisión de la pantalla en el juego: cuánta luz emite el material del display. Es lo que decide si
 * las luces con luminancia alta "florecen" (bloom) en CSP. Se guarda en el perfil del vehículo.
 */
export function ScreenEmissionProps({ display }: { display: DisplayDef }) {
  const profile = useStore((s) => s.profile)!;
  const car = useStore((s) => s.car);
  const setProfile = useStore((s) => s.setProfile);
  const profileFile = useStore((s) => s.profileFile);
  const em = display.emissive;
  const level = em.ks_emissive[0];
  async function apply(patch: Partial<DisplayDef['emissive']>) {
    const next: DisplayProfile = {
      ...profile,
      displays: profile.displays.map((d) => (d.id === display.id ? { ...d, emissive: { ...d.emissive, ...patch } } : d)),
    };
    let file = profileFile;
    if (car) {
      try {
        file = await api.saveProfileToCar(next, car.path);
      } catch (e) {
        toast(`No se pudo guardar el perfil en el vehículo: ${(e as Error).message}`, 'err');
      }
    }
    setProfile(next, file);
  }
  return (
    <div className="prop-group">
      <h3>Emisión en el juego</h3>
      <Prop label="Material" title="none: se deja como está en el coche. Solo emisión: añade ksEmissive a la malla conservando su shader (p. ej. DigitalScreen). Shader ksPerPixel: reemplaza el shader y fija la emisión.">
        <Sel
          value={em.mode === 'custom' ? 'custom' : em.mode}
          onChange={(v) => v !== 'custom' && apply({ mode: v as DisplayDef['emissive']['mode'] })}
          options={[
            { value: 'none', label: 'Como el coche' },
            { value: 'props', label: 'Solo emisión (conserva shader)' },
            { value: 'shader_replacement', label: 'Shader ksPerPixel + emisión' },
            ...(em.mode === 'custom' ? [{ value: 'custom', label: 'Personalizado (ini)' }] : []),
          ]}
        />
      </Prop>
      {(em.mode === 'props' || em.mode === 'shader_replacement') && (
        <Prop label="Emisión (ksEmissive)" title="1 = brillo normal; 2–4 hace que los píxeles blancos/saturados florezcan con el bloom de CSP. Sube la luminancia de las luces y baja el brillo global del display para que solo destaquen ellas.">
          <Num value={level} onChange={(v) => apply({ ks_emissive: [v, v, v] })} min={0} max={20} step={0.5} />
        </Prop>
      )}
      <div className="muted small">
        La emisión es lo que hace visible la pantalla a oscuras (de noche el material del coche suele traer un valor bajo). Se escribe al final de <code>ext_config.ini</code>, por encima del material del coche. Orientativo: 3–4 para verse de noche; con luminancia &gt; 1 en las luces, además destellan.
      </div>
    </div>
  );
}

export function ProjectProps() {
  const project = useStore((s) => s.project)!;
  const dp = useStore(activeDisplayOf)!;
  const activePage = useStore((s) => s.activePage);
  const profile = useStore((s) => s.profile);
  const car = useStore((s) => s.car);
  const patchProject = useStore((s) => s.patchProject);
  const patchDisplay = useStore((s) => s.patchDisplay);
  const addPage = useStore((s) => s.addPage);
  const removePage = useStore((s) => s.removePage);
  const movePage = useStore((s) => s.movePage);
  const setActivePage = useStore((s) => s.setActivePage);
  const s = dp.settings;
  const set = (patch: Partial<typeof s>) => patchDisplay((d) => Object.assign(d.settings, patch));
  const display = profile?.displays.find((d) => d.id === dp.display_id);
  const limiter = display?.defaults.rpm_limiter ?? 8000;
  return (
    <div>
      <div className="prop-group">
        <h3>Proyecto</h3>
        <Prop label="Nombre">
          <Txt value={project.name} onChange={(v) => patchProject((p) => (p.name = v))} />
        </Prop>
        <table className="info small">
          <tbody>
            <tr>
              <td>Vehículo</td>
              <td>{car?.name ?? project.car_id}</td>
            </tr>
            <tr>
              <td>Perfil</td>
              <td>{profile?.name ?? project.profile.id}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="prop-group">
        <h3>
          <span>Display</span>
          <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>
            {project.displays.length > 1 ? `${project.displays.indexOf(dp) + 1} de ${project.displays.length}` : ''}
          </span>
        </h3>
        <Prop label="Nombre">
          <Txt value={dp.name} onChange={(v) => patchDisplay((d) => (d.name = v))} />
        </Prop>
        <table className="info small">
          <tbody>
            <tr>
              <td>Malla</td>
              <td className="mono">{display?.meshes.join(', ') ?? '—'}</td>
            </tr>
            <tr>
              <td>Textura</td>
              <td>
                {dp.canvas.width}×{dp.canvas.height} px
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {project.displays.length > 1 && (
        <div className="prop-group">
          <button
            className="small danger"
            onClick={async () => {
              const idx = await api.confirm(`¿Quitar el display "${dp.name}" del proyecto?`, 'Se pierden sus páginas y elementos (no se toca nada en el vehículo hasta volver a generar).', ['Quitar', 'Cancelar']);
              if (idx === 0) useStore.getState().removeDisplay(project.displays.indexOf(dp));
            }}
          >
            Quitar este display del proyecto
          </button>
        </div>
      )}
      {display && <VisibleAreaProps display={display} />}
      {display && <ScreenEmissionProps display={display} />}
      <div className="prop-group">
        <h3>
          <span>Páginas ({dp.pages.length})</span>
          <button className="small ghost" onClick={() => addPage()}>
            <Icon name="plus" size={12} /> Añadir
          </button>
        </h3>
        <div className="row gap4 mb8 wrap">
          <button className="small outline" onClick={() => addPage(undefined, 'boot')} title="Pantalla de arranque: se muestra durante unos segundos al cargar el coche">
            ▶ Arranque
          </button>
          <button className="small outline" onClick={() => addPage(undefined, 'function')} title="Pantalla de funcionalidad: se activa con un botón (KERS, Extra…)">
            ⚡ Funcionalidad
          </button>
          <select
            value=""
            onChange={(e) => {
              const id = e.target.value as TemplateId | '';
              if (!id) return;
              useStore.getState().addPageObject(createTemplatePage(id, dp.canvas, limiter));
              toast(`Plantilla "${TEMPLATES.find((t) => t.id === id)?.label}" añadida: edítala como cualquier página.`);
            }}
            style={{ width: 'auto' }}
            title="Páginas prehechas que se añaden y luego se editan libremente"
          >
            <option value="">Plantilla…</option>
            {TEMPLATES.map((t) => (
              <option key={t.id} value={t.id} title={t.description}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {dp.pages.map((pg, i) => (
          <div key={pg.id} className={`rule ${i === activePage ? 'selected' : ''}`} style={i === activePage ? { outline: '1px solid var(--accent)' } : undefined}>
            <div className="row gap4">
              <button className="icon" title="Editar esta página" onClick={() => setActivePage(i)}>
                <Icon name={i === activePage ? 'check' : 'play'} size={12} />
              </button>
              <Txt value={pg.name} onChange={(v) => patchDisplay((d) => (d.pages[i].name = v))} />
              <button className="icon" title="Subir" disabled={i === 0} onClick={() => movePage(i, i - 1)}>
                <Icon name="up" size={12} />
              </button>
              <button className="icon" title="Bajar" disabled={i === dp.pages.length - 1} onClick={() => movePage(i, i + 1)}>
                <Icon name="down" size={12} />
              </button>
              <button className="icon" title="Eliminar página" disabled={dp.pages.length <= 1} onClick={() => removePage(i)}>
                <Icon name="close" size={12} />
              </button>
            </div>
            <div className="row gap4 mt8">
              <span className="muted small">Tipo</span>
              <Sel
                value={pg.kind ?? 'normal'}
                onChange={(v) =>
                  patchDisplay((d) => {
                    const p = d.pages[i];
                    p.kind = v === 'normal' ? undefined : v;
                    if (v === 'boot') {
                      p.duration = p.duration ?? 3;
                      p.trigger = undefined;
                      p.when = undefined;
                    } else if (v === 'function') {
                      p.trigger = p.trigger ?? createTrigger();
                      p.when = undefined;
                    } else p.trigger = undefined;
                  })
                }
                options={[{ value: 'normal', label: 'Datos (normal)' }, { value: 'boot', label: '▶ Arranque' }, { value: 'function', label: '⚡ Funcionalidad' }]}
              />
              {pg.kind === 'boot' && (
                <>
                  <span className="muted small">Duración (s)</span>
                  <Num value={pg.duration ?? 3} onChange={(v) => patchDisplay((d) => (d.pages[i].duration = Math.max(0.1, v)))} min={0.1} step={0.5} />
                </>
              )}
            </div>
            {pg.kind === 'function' && pg.trigger && <TriggerProps tr={pg.trigger} onChange={(t) => patchDisplay((d) => (d.pages[i].trigger = t))} limiter={limiter} />}
            {!pg.kind && (
              <div className="row gap4 wrap">
                <Chk
                  value={pageConditions(pg).length > 0}
                  label="Mostrar automáticamente si (cualquiera)"
                  onChange={(v) => patchDisplay((d) => setPageConditions(d.pages[i], v ? [{ variable: 'in_pitlane', op: '==', value: true }] : []))}
                />
              </div>
            )}
            {!pg.kind && pageConditions(pg).length > 0 && (
              <CondList list={pageConditions(pg)} onChange={(l) => patchDisplay((d) => setPageConditions(d.pages[i], l))} limiter={limiter} emptyLabel="Sin condiciones." />
            )}
          </div>
        ))}
        <Prop label="Cambiar con" title="Entrada extra de CSP (botón del volante/tecla) que pasa a la página siguiente">
          <Sel
            value={s.pageSwitch.input}
            onChange={(v) => set({ pageSwitch: { ...s.pageSwitch, input: v } })}
            options={[
              { value: 'none', label: 'Sin botón (solo automático)' },
              ...(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const).map((l) => ({ value: `extra${l}` as const, label: `Extra ${l}` })),
            ]}
          />
        </Prop>
        {s.pageSwitch.input !== 'none' && (
          <Prop label="Opciones">
            <div className="col gap4">
              <Chk value={s.pageSwitch.wrap} label="Volver a la primera tras la última" onChange={(v) => set({ pageSwitch: { ...s.pageSwitch, wrap: v } })} />
              <Chk value={s.pageSwitch.remember} label="Recordar la página entre sesiones" onChange={(v) => set({ pageSwitch: { ...s.pageSwitch, remember: v } })} />
            </div>
          </Prop>
        )}
        <div className="muted small">Las páginas con condición tienen prioridad (en orden); si ninguna se cumple se muestra la elegida con el botón.</div>
      </div>
      <div className="prop-group">
        <h3>Fondo</h3>
        <Prop label="Imagen">
          <div className="row gap4">
            <span className="small mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {dp.background.file ?? '— color plano —'}
            </span>
            <button
              className="small outline"
              onClick={async () => {
                const a = await api.pickAsset('image');
                if (!a) return;
                if (a.error) toast(a.error, 'err');
                if (a.width && a.height && (a.width !== dp.canvas.width || a.height !== dp.canvas.height)) {
                  toast(`La imagen (${a.width}×${a.height}) no coincide con la textura (${dp.canvas.width}×${dp.canvas.height}); se escalará.`, 'err');
                }
                useStore.getState().addAssetUrl(a.path, a.dataUrl);
                patchDisplay((d) => (d.background.file = a.path));
              }}
            >
              Cambiar…
            </button>
            {dp.background.file && (
              <button className="icon" onClick={() => patchDisplay((d) => (d.background.file = null))}>
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        </Prop>
        <Prop label="Color">
          <ColorField value={dp.background.color} onChange={(v) => patchDisplay((d) => (d.background.color = v))} />
        </Prop>
      </div>
      <div className="prop-group">
        <h3>Brillo</h3>
        <Prop label="Brillo global">
          <Num value={s.brightness} onChange={(v) => set({ brightness: v })} min={0.05} max={3} step={0.05} />
        </Prop>
        <Prop label="Cambio de brillo" title="Cambia el brillo del contenido del display cuando se cumple la condición (luces encendidas o noche). No sustituye a la emisión del material: la visibilidad de la pantalla a oscuras la da 'Emisión en el juego'.">
          <Sel value={s.nightMode} onChange={(v) => set({ nightMode: v })} options={[{ value: 'off', label: 'Sin cambio' }, { value: 'headlights', label: 'Con las luces encendidas' }, { value: 'time', label: 'Por hora (20:00–07:00)' }]} />
        </Prop>
        {s.nightMode !== 'off' && (
          <Prop label="Brillo × en ese caso" title="1 = igual; < 1 atenúa (como un dimmer de salpicadero); > 1 aumenta el brillo del contenido">
            <Num value={s.nightBrightness} onChange={(v) => set({ nightBrightness: v })} min={0.05} max={3} step={0.05} />
          </Prop>
        )}
      </div>
      {dp.pages.some((p) => p.kind === 'boot') && (
        <div className="prop-group">
          <h3>Arranque</h3>
          <div className="muted small mb8">
            Secuencia: {dp.pages.filter((p) => p.kind === 'boot').map((p) => `${p.name} (${p.duration ?? 3} s)`).join(' → ')}. Se reproduce al cargar la sesión.
          </div>
          <Prop label="Repetir con" title="Botón que vuelve a reproducir la secuencia">
            <Sel value={s.boot.replayButton} onChange={(v) => set({ boot: { ...s.boot, replayButton: v } })} options={[{ value: 'none', label: 'Sin botón' }, ...BUTTON_OPTIONS]} />
          </Prop>
          <Prop label="Saltar con" title="Botón que salta la secuencia">
            <Sel value={s.boot.skipButton} onChange={(v) => set({ boot: { ...s.boot, skipButton: v } })} options={[{ value: 'none', label: 'Sin botón' }, ...BUTTON_OPTIONS]} />
          </Prop>
          <Prop label="Saltar a más de (km/h)" title="0 = no saltar por velocidad">
            <Num value={s.boot.skipSpeedKmh} onChange={(v) => set({ boot: { ...s.boot, skipSpeedKmh: Math.max(0, v) } })} min={0} />
          </Prop>
          <Prop label="Transición">
            <div className="pair">
              <Sel value={s.boot.transition} onChange={(v) => set({ boot: { ...s.boot, transition: v } })} options={[{ value: 'cut', label: 'Corte' }, { value: 'fade', label: 'Fundido' }]} />
              <Num value={s.boot.transitionS} disabled={s.boot.transition !== 'fade'} onChange={(v) => set({ boot: { ...s.boot, transitionS: Math.max(0, v) } })} min={0} step={0.1} />
            </div>
          </Prop>
          <Prop label="Sonido" title="Audio que suena al empezar la secuencia (MP3/WAV/OGG)">
            <div className="row gap4">
              <span className="small mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.boot.sound}>
                {s.boot.sound ? s.boot.sound.split('/').pop() : '—'}
              </span>
              <button
                className="small outline"
                onClick={async () => {
                  const a = await api.pickAsset('audio');
                  if (!a) return;
                  useStore.getState().addAssetUrl(a.path, a.dataUrl);
                  set({ boot: { ...s.boot, sound: a.path } });
                }}
              >
                Elegir…
              </button>
              {s.boot.sound && (
                <button className="icon" title="Quitar sonido" onClick={() => set({ boot: { ...s.boot, sound: undefined } })}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          </Prop>
          {s.boot.sound && (
            <Prop label="Volumen">
              <Num value={s.boot.soundVolume} onChange={(v) => set({ boot: { ...s.boot, soundVolume: Math.max(0, Math.min(1, v)) } })} min={0} max={1} step={0.1} />
            </Prop>
          )}
          <Prop label="Opciones">
            <div className="col gap4">
              <Chk value={s.boot.engineStart} label="Repetir al arrancar el motor" onChange={(v) => set({ boot: { ...s.boot, engineStart: v } })} />
              <Chk value={s.boot.skipInReplay} label="Omitir en replays" onChange={(v) => set({ boot: { ...s.boot, skipInReplay: v } })} />
            </div>
          </Prop>
        </div>
      )}
      <div className="prop-group">
        <h3>Pantalla táctil</h3>
        <Prop label="Táctil" title="Escribe INTERACTIVE = 1 en la sección del display: CSP proyecta el puntero del ratón sobre la malla y lo convierte en coordenadas de la pantalla. Cuesta un raycast cuando se usa el ratón, por eso conviene dejarlo en automático.">
          <Sel
            value={s.touch?.mode ?? 'auto'}
            onChange={(v) => set({ touch: { ...DEFAULT_TOUCH, ...(s.touch ?? {}), mode: v } })}
            options={[
              { value: 'auto', label: 'Automático (si hay botones o gestos)' },
              { value: 'on', label: 'Siempre activo' },
              { value: 'off', label: 'Desactivado' },
            ]}
          />
        </Prop>
        <Prop label="Opciones">
          <div className="col gap4">
            <Chk value={s.touch?.hover !== false} label="Resaltar el botón bajo el puntero" onChange={(v) => set({ touch: { ...DEFAULT_TOUCH, ...(s.touch ?? {}), hover: v } })} />
            <Chk value={!!s.touch?.swipePages} label="Deslizar en horizontal cambia de página" onChange={(v) => set({ touch: { ...DEFAULT_TOUCH, ...(s.touch ?? {}), swipePages: v } })} />
          </div>
        </Prop>
        {s.touch?.swipePages && (
          <Prop label="Recorrido mínimo (%)">
            <Num value={s.touch?.swipePct ?? 25} onChange={(v) => set({ touch: { ...DEFAULT_TOUCH, ...(s.touch ?? {}), swipePct: Math.max(5, Math.min(90, v)) } })} min={5} max={90} />
          </Prop>
        )}
        {usedSwitches(dp).length > 0 && (
          <Prop label="Interruptores">
            <div className="col gap4">
              {usedSwitches(dp).map((k) => {
                const sd = s.touch?.switches?.find((x) => x.key === k);
                return (
                  <span key={k} className="small mono">
                    {switchVar(k)} — {sd?.label ?? `Interruptor ${k.toUpperCase()}`}
                    {sd?.initial ? ' · empieza activado' : ''}
                    {sd?.remember ? ' · se recuerda' : ''}
                  </span>
                );
              })}
            </div>
          </Prop>
        )}
        <div className="muted small">
          {displayHasTouch(dp)
            ? 'Este display se instala como táctil. En el modo previsualización puedes pulsar los botones con el ratón para probarlos.'
            : 'Añade un botón táctil (o activa los gestos) para que el display se instale como táctil.'}
        </div>
      </div>
      <div className="prop-group">
        <h3>Refresco</h3>
        <Prop label="Frecuencia" title="Cuántas veces por segundo se redibuja el display en el juego. Los displays reales suelen ir a 10–30 Hz; con menos frecuencia los valores rápidos (milésimas) se leen mejor y se ahorra rendimiento.">
          <Sel
            value={String(s.refreshHz || 0)}
            onChange={(v) => set({ refreshHz: Number(v) })}
            options={[
              { value: '0', label: 'Cada frame (máxima)' },
              ...[60, 30, 25, 20, 15, 10, 5].map((hz) => ({ value: String(hz), label: `${hz} Hz` })),
            ]}
          />
        </Prop>
        <div className="muted small">Cada texto puede tener además su propia frecuencia (propiedades del texto → Actualizar).</div>
        {display && (
          <Prop label="Frame anterior" title="KEEP_BACKGROUND de CSP. Desactivado, CSP limpia la textura antes de cada frame (el fondo se repinta igualmente). Activado puede dejar restos (ghosting) en los valores que cambian rápido.">
            <Chk value={display.keep_background} label="Conservar entre frames (KEEP_BACKGROUND)" onChange={(v) => void saveDisplayDef(display.id, { keep_background: v })} />
          </Prop>
        )}
      </div>
      <div className="prop-group">
        <h3>Unidades</h3>
        <Prop label="Sistema">
          <Sel value={s.units} onChange={(v) => set({ units: v })} options={[{ value: 'auto', label: 'Automático (según el coche)' }, { value: 'metric', label: 'Métrico (km/h, °C, bar, L)' }, { value: 'imperial', label: 'Imperial (mph, °F, psi, gal)' }]} />
        </Prop>
      </div>
      <div className="prop-group">
        <h3>Editor</h3>
        <Prop label="Rejilla (px)">
          <Num value={s.grid} onChange={(v) => set({ grid: v })} min={0} max={256} />
        </Prop>
        <Prop label="Ajuste">
          <div className="col gap4">
            <Chk value={s.snap} label="Ajustar a rejilla y bordes" onChange={(v) => set({ snap: v })} />
            <Chk value={s.snapToElements} label="Ajustar a otros elementos" onChange={(v) => set({ snapToElements: v })} />
          </div>
        </Prop>
      </div>
      <div className="muted small">Selecciona un elemento en el lienzo o en la lista de capas para editar sus propiedades.</div>
    </div>
  );
}
