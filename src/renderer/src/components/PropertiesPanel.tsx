import type { DisplayElement, ElementAnim, Glow, PageCondition, PageTrigger, Rule, TextStyle, Threshold, TimeFormat } from '@shared/model';
import { DEFAULT_ANIM, DEFAULT_GLOW, createTrigger, newId, pageConditions, setPageConditions } from '@shared/model';
import { TEMPLATES, createTemplatePage, type TemplateId } from '@shared/templates';
import { VARIABLE_MAP } from '@shared/variables';
import { api } from '../api';
import type { DisplayDef, DisplayProfile } from '@shared/profile';
import { hasUvRegion, physicalSizeFromMesh, regionFromKn5Uv, regionFromPx, uvRegionPx, type UvRegion } from '@shared/uv';
import { useStore, toast, activeDisplayOf, activePageOf } from '../store';
import { Chk, ColorField, FontSelect, Num, Prop, RpmField, Sel, Txt, VarSelect } from './fields';
import { Icon } from './icons';

export function PropertiesPanel() {
  const dp = useStore(activeDisplayOf);
  const page = useStore(activePageOf);
  const selection = useStore((s) => s.selection);
  const profile = useStore((s) => s.profile);
  const patchDisplay = useStore((s) => s.patchDisplay);
  if (!dp || !page) return null;
  const els = page.elements.filter((e) => selection.includes(e.id));
  const display = profile?.displays.find((d) => d.id === dp.display_id);
  const limiter = display?.defaults.rpm_limiter ?? 8000;

  if (els.length === 0) return <ProjectProps />;
  if (els.length > 1) return <MultiProps els={els} />;
  const el = els[0];
  const update = (patch: Partial<DisplayElement> | ((e: DisplayElement) => void), commit = true) => useStore.getState().updateElement(el.id, patch, commit);

  return (
    <div>
      <div className="prop-group">
        <h3>
          <span>{typeLabel(el.type)}</span>
          <span className="row gap4">
            <button className={`icon ${el.visible ? '' : 'active'}`} title={el.visible ? 'Ocultar' : 'Mostrar'} onClick={() => update({ visible: !el.visible })}>
              <Icon name={el.visible ? 'eye' : 'eyeOff'} size={14} />
            </button>
            <button className={`icon ${el.locked ? 'active' : ''}`} title={el.locked ? 'Desbloquear' : 'Bloquear'} onClick={() => update({ locked: !el.locked })}>
              <Icon name={el.locked ? 'lock' : 'unlock'} size={14} />
            </button>
          </span>
        </h3>
        <Prop label="Nombre">
          <Txt value={el.name} onChange={(v) => update({ name: v })} />
        </Prop>
        <Prop label="Posición X / Y">
          <div className="pair">
            <Num value={el.x} onChange={(v) => update({ x: v })} />
            <Num value={el.y} onChange={(v) => update({ y: v })} />
          </div>
        </Prop>
        <Prop label="Ancho / Alto">
          <div className="pair">
            <Num value={el.width} onChange={(v) => update({ width: v })} min={1} />
            <Num value={el.height} onChange={(v) => update({ height: v })} min={1} />
          </div>
        </Prop>
        <Prop label="Rotación / Opac.">
          <div className="pair">
            <Num value={el.rotation} onChange={(v) => update({ rotation: v })} step={1} />
            <Num value={el.opacity} onChange={(v) => update({ opacity: v })} step={0.05} min={0} max={1} />
          </div>
        </Prop>
        <div className="quick-actions">
          <button className="small ghost" onClick={() => patchDisplay((d) => centerEl(d.canvas.width, undefined, el.id, d))}>
            Centrar horizontal
          </button>
          <button className="small ghost" onClick={() => patchDisplay((d) => centerEl(undefined, d.canvas.height, el.id, d))}>
            Centrar vertical
          </button>
        </div>
      </div>

      {el.type === 'text' && <TextProps el={el} update={update} />}
      {el.type === 'gear' && (
        <div className="prop-group">
          <h3>Marcha</h3>
          <StyleProps style={el.config.style} onChange={(s) => update((e) => e.type === 'gear' && (e.config.style = s))} />
          <Prop label="Reversa / Neutral">
            <div className="pair">
              <Txt value={el.config.map['-1'] ?? 'R'} onChange={(v) => update((e) => e.type === 'gear' && (e.config.map['-1'] = v))} />
              <Txt value={el.config.map['0'] ?? 'N'} onChange={(v) => update((e) => e.type === 'gear' && (e.config.map['0'] = v))} />
            </div>
          </Prop>
          <Prop label="Color en limitador">
            <ColorField value={el.config.limiterColor ?? '#FF2D2D'} onChange={(v) => update((e) => e.type === 'gear' && (e.config.limiterColor = v))} />
          </Prop>
        </div>
      )}
      {el.type === 'rpm_bar' && (
        <div className="prop-group">
          <h3>Barra RPM</h3>
          <Prop label="Orientación">
            <Sel value={el.config.orientation} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.orientation = v))} options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]} />
          </Prop>
          <Prop label="Estilo">
            <Sel value={el.config.style} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.style = v))} options={[{ value: 'segments', label: 'Segmentos / LEDs' }, { value: 'continuous', label: 'Continua' }]} />
          </Prop>
          {el.config.style === 'segments' && (
            <Prop label="Segmentos / Sep.">
              <div className="pair">
                <Num value={el.config.segments} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.segments = v))} min={1} max={200} />
                <Num value={el.config.gap} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.gap = v))} min={0} />
              </div>
            </Prop>
          )}
          <Prop label="Esquinas">
            <Num value={el.config.radius} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.radius = v))} min={0} />
          </Prop>
          <Prop label="RPM mín.">
            <RpmField value={el.config.min} limiter={limiter} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.min = v))} />
          </Prop>
          <Prop label="RPM máx.">
            <RpmField value={el.config.max} limiter={limiter} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.max = v))} />
          </Prop>
          <Prop label="Advertencia">
            <RpmField value={el.config.warning} limiter={limiter} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.warning = v))} />
          </Prop>
          <Prop label="Zona roja">
            <RpmField value={el.config.redline} limiter={limiter} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.redline = v))} />
          </Prop>
          {(['normal', 'warning', 'redline', 'limiter', 'off'] as const).map((k) => (
            <Prop key={k} label={`Color ${{ normal: 'normal', warning: 'aviso', redline: 'rojo', limiter: 'limitador', off: 'apagado' }[k]}`}>
              <ColorField value={el.config.colors[k]} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.colors[k] = v))} />
            </Prop>
          ))}
          <Prop label="Parpadeo limit. (Hz)">
            <Num value={el.config.limiterBlinkHz} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.limiterBlinkHz = v))} min={0} max={30} step={0.5} />
          </Prop>
          <Prop label="Opciones">
            <div className="col gap4">
              <Chk value={el.config.perSegmentColors} label="Color por zona de cada segmento" onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.perSegmentColors = v))} />
              <Chk value={el.config.reverse} label="Invertir sentido" onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.reverse = v))} />
            </div>
          </Prop>
          {el.config.style === 'segments' && (
            <GlowProps
              glow={el.config.glow}
              blinkDuty={el.config.blinkDuty}
              hasBlink={el.config.limiterBlinkHz > 0}
              onGlow={(g) => update((e) => e.type === 'rpm_bar' && (e.config.glow = g))}
              onDuty={(d) => update((e) => e.type === 'rpm_bar' && (e.config.blinkDuty = d))}
            />
          )}
          {el.config.style === 'continuous' && (
            <>
              <h3>Textura personalizada</h3>
              <div className="muted small mb8">La textura de llenado se estira a toda la barra y se descubre según las RPM; la de fondo se dibuja entera debajo.</div>
              <Prop label="Llenado">
                <ImageField value={el.config.fillImage} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.fillImage = v))} onSize={(w, h) => update((e) => ((e.width = w), (e.height = h)))} />
              </Prop>
              <Prop label="Fondo">
                <ImageField value={el.config.bgImage} onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.bgImage = v))} />
              </Prop>
              {el.config.fillImage && (
                <Prop label="Opciones">
                  <Chk value={!!el.config.tintImage} label="Teñir la textura con el color de la zona" onChange={(v) => update((e) => e.type === 'rpm_bar' && (e.config.tintImage = v))} />
                </Prop>
              )}
            </>
          )}
        </div>
      )}
      {el.type === 'shift_lights' && (
        <div className="prop-group">
          <h3>Luces de cambio</h3>
          <Prop label="LEDs / Sep.">
            <div className="pair">
              <Num value={el.config.count} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.count = Math.max(1, Math.round(v))))} min={1} max={64} />
              <Num value={el.config.gap} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.gap = v))} min={0} />
            </div>
          </Prop>
          <Prop label="Orientación">
            <Sel value={el.config.orientation} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.orientation = v))} options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]} />
          </Prop>
          <Prop label="Forma">
            <Sel value={el.config.shape} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.shape = v))} options={[{ value: 'circle', label: 'Círculo' }, { value: 'rect', label: 'Rectángulo' }]} />
          </Prop>
          {el.config.shape === 'rect' && (
            <Prop label="Esquinas">
              <Num value={el.config.radius} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.radius = v))} min={0} />
            </Prop>
          )}
          <Prop label="Orden" title="Orden en que se encienden los LEDs">
            <Sel
              value={el.config.pattern}
              onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.pattern = v))}
              options={[
                { value: 'left_to_right', label: 'De un extremo al otro' },
                { value: 'edges_to_center', label: 'De los extremos al centro' },
                { value: 'center_to_edges', label: 'Del centro a los extremos' },
              ]}
            />
          </Prop>
          <Prop label="Primer LED a">
            <RpmField value={el.config.rpmStart} limiter={limiter} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.rpmStart = v))} />
          </Prop>
          <Prop label="Todos a">
            <RpmField value={el.config.rpmEnd} limiter={limiter} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.rpmEnd = v))} />
          </Prop>
          <h3>
            <span>Tramos de color</span>
            <button className="small ghost" onClick={() => update((e) => e.type === 'shift_lights' && e.config.zones.push({ count: 1, color: '#FFFFFF' }))}>
              <Icon name="plus" size={12} /> Añadir
            </button>
          </h3>
          <div className="muted small mb8">En orden de encendido; la suma debería ser {el.config.count} LEDs (ahora {el.config.zones.reduce((a, z) => a + z.count, 0)}).</div>
          {el.config.zones.map((z, i) => (
            <div key={i} className="row gap4 mb8">
              <Num value={z.count} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.zones[i].count = Math.max(0, Math.round(v))))} min={0} />
              <ColorField value={z.color} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.zones[i].color = v))} />
              <button className="icon" title="Quitar tramo" disabled={el.config.zones.length <= 1} onClick={() => update((e) => e.type === 'shift_lights' && e.config.zones.splice(i, 1))}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          <Prop label="Color apagado">
            <ColorField value={el.config.colorOff} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.colorOff = v))} />
          </Prop>
          <Prop label="Limitador">
            <div className="pair">
              <Num value={el.config.limiterBlinkHz} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.limiterBlinkHz = v))} min={0} max={30} step={0.5} />
              <ColorField value={el.config.limiterColor} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.limiterColor = v))} />
            </div>
          </Prop>
          <Prop label="Textura LED">
            <ImageField value={el.config.image} onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.image = v))} />
          </Prop>
          <Prop label="Opciones">
            <Chk value={el.config.dimOff} label="Mostrar los LEDs apagados" onChange={(v) => update((e) => e.type === 'shift_lights' && (e.config.dimOff = v))} />
          </Prop>
          <GlowProps
            glow={el.config.glow}
            blinkDuty={el.config.blinkDuty}
            hasBlink={el.config.limiterBlinkHz > 0}
            onGlow={(g) => update((e) => e.type === 'shift_lights' && (e.config.glow = g))}
            onDuty={(d) => update((e) => e.type === 'shift_lights' && (e.config.blinkDuty = d))}
          />
        </div>
      )}
      {el.type === 'video' && (
        <div className="prop-group">
          <h3>Vídeo</h3>
          <Prop label="Archivo" title="MP4 (H.264), WMV, WebM… (códecs de Windows / Media Foundation). Se copia al coche: vigila el tamaño.">
            <div className="row gap4">
              <span className="small mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={el.config.file}>
                {el.config.file ? el.config.file.split('/').pop() : '—'}
              </span>
              <button
                className="small outline"
                onClick={async () => {
                  const a = await api.pickAsset('video');
                  if (!a) return;
                  if (a.error) toast(a.error, 'err');
                  useStore.getState().addAssetUrl(a.path, a.dataUrl);
                  update((e) => e.type === 'video' && (e.config.file = a.path));
                }}
              >
                Elegir…
              </button>
            </div>
          </Prop>
          <Prop label="Ajuste">
            <Sel value={el.config.fit} onChange={(v) => update((e) => e.type === 'video' && (e.config.fit = v))} options={[{ value: 'stretch', label: 'Estirar' }, { value: 'fit', label: 'Encajar (bandas)' }, { value: 'fill', label: 'Rellenar (recorta)' }]} />
          </Prop>
          <Prop label="Velocidad / Volumen">
            <div className="pair">
              <Num value={el.config.rate} onChange={(v) => update((e) => e.type === 'video' && (e.config.rate = Math.max(0.1, v)))} min={0.1} max={4} step={0.1} />
              <Num value={el.config.volume} onChange={(v) => update((e) => e.type === 'video' && (e.config.volume = Math.max(0, Math.min(1, v))))} min={0} max={1} step={0.1} />
            </div>
          </Prop>
          <Prop label="Tinte">
            <ColorField value={el.config.tint} onChange={(v) => update((e) => e.type === 'video' && (e.config.tint = v))} />
          </Prop>
          <Prop label="Al terminar">
            <Sel value={el.config.onEnd} onChange={(v) => update((e) => e.type === 'video' && (e.config.onEnd = v))} options={[{ value: 'hold', label: 'Mantener el último frame' }, { value: 'hide', label: 'Ocultar' }]} />
          </Prop>
          <Prop label="Opciones">
            <div className="col gap4">
              <Chk value={el.config.loop} label="Bucle" onChange={(v) => update((e) => e.type === 'video' && (e.config.loop = v))} />
              <Chk value={el.config.muted} label="Silenciar" onChange={(v) => update((e) => e.type === 'video' && (e.config.muted = v))} />
            </div>
          </Prop>
          <div className="muted small">Se reinicia al entrar en la página y se detiene al salir. En el editor se reproduce en previsualización.</div>
        </div>
      )}
      {el.type === 'needle' && (
        <div className="prop-group">
          <h3>Aguja</h3>
          <Prop label="Variable">
            <VarSelect value={el.config.variable} onlyNumeric onChange={(v) => update((e) => e.type === 'needle' && v && ((e.config.variable = v), applyRange(e, v)))} />
          </Prop>
          <Prop label="Mín. / Máx." title="Valores de la variable en los extremos del recorrido">
            <div className="pair">
              <Num value={el.config.min} onChange={(v) => update((e) => e.type === 'needle' && (e.config.min = v))} />
              <Num value={el.config.max} onChange={(v) => update((e) => e.type === 'needle' && (e.config.max = v))} />
            </div>
          </Prop>
          <Prop label="Ángulo mín. / máx." title="Grados (horario) con el valor mínimo y con el máximo; 0 = la aguja tal y como está dibujada (apuntando hacia arriba)">
            <div className="pair">
              <Num value={el.config.angleMin} onChange={(v) => update((e) => e.type === 'needle' && (e.config.angleMin = v))} />
              <Num value={el.config.angleMax} onChange={(v) => update((e) => e.type === 'needle' && (e.config.angleMax = v))} />
            </div>
          </Prop>
          <Prop label="Eje X / Y" title="Punto de giro, en píxeles desde la esquina superior izquierda del elemento (también se puede arrastrar en el lienzo)">
            <div className="pair">
              <Num value={el.config.pivot.x} onChange={(v) => update((e) => e.type === 'needle' && (e.config.pivot.x = v))} />
              <Num value={el.config.pivot.y} onChange={(v) => update((e) => e.type === 'needle' && (e.config.pivot.y = v))} />
            </div>
          </Prop>
          <div className="row gap4 mb8 wrap">
            <button className="small outline" onClick={() => update((e) => e.type === 'needle' && ((e.config.pivot.x = e.width / 2), (e.config.pivot.y = e.height / 2)))}>
              Eje al centro
            </button>
            <button className="small outline" onClick={() => update((e) => e.type === 'needle' && ((e.config.pivot.x = e.width / 2), (e.config.pivot.y = e.height)))}>
              Eje abajo
            </button>
          </div>
          <Prop label="Textura" title="Imagen de la aguja apuntando hacia arriba; se gira alrededor del eje">
            <ImageField value={el.config.image} onChange={(v) => update((e) => e.type === 'needle' && (e.config.image = v))} onSize={(w, h) => update((e) => ((e.width = w), (e.height = h)))} />
          </Prop>
          <Prop label={el.config.image ? 'Tinte' : 'Color'}>
            <ColorField value={el.config.color} onChange={(v) => update((e) => e.type === 'needle' && (e.config.color = v))} />
          </Prop>
          {!el.config.image && (
            <>
              <Prop label="Grosor">
                <Num value={el.config.thickness} onChange={(v) => update((e) => e.type === 'needle' && (e.config.thickness = v))} min={1} />
              </Prop>
              <Prop label="Centro (radio)">
                <div className="pair">
                  <Num value={el.config.hubRadius} onChange={(v) => update((e) => e.type === 'needle' && (e.config.hubRadius = v))} min={0} />
                  <ColorField value={el.config.hubColor} onChange={(v) => update((e) => e.type === 'needle' && (e.config.hubColor = v))} />
                </div>
              </Prop>
            </>
          )}
          <Prop label="Suavizado (ms)">
            <Num value={el.config.smoothingMs} onChange={(v) => update((e) => e.type === 'needle' && (e.config.smoothingMs = v))} min={0} step={20} />
          </Prop>
          <Prop label="Opciones">
            <Chk value={el.config.clamp} label="No pasar de los extremos" onChange={(v) => update((e) => e.type === 'needle' && (e.config.clamp = v))} />
          </Prop>
          <div className="muted small">Para el fondo del reloj añade un elemento Imagen debajo de la aguja.</div>
        </div>
      )}
      {el.type === 'shift_light' && (
        <div className="prop-group">
          <h3>Shift light</h3>
          <Prop label="Enciende a">
            <RpmField value={el.config.rpmOn} limiter={limiter} onChange={(v) => update((e) => e.type === 'shift_light' && (e.config.rpmOn = v))} />
          </Prop>
          <Prop label="Apaga por debajo">
            <RpmField value={el.config.rpmOff} limiter={limiter} onChange={(v) => update((e) => e.type === 'shift_light' && (e.config.rpmOff = v))} />
          </Prop>
          <Prop label="Forma">
            <Sel value={el.config.shape} onChange={(v) => update((e) => e.type === 'shift_light' && (e.config.shape = v))} options={[{ value: 'circle', label: 'Círculo' }, { value: 'rect', label: 'Rectángulo' }]} />
          </Prop>
          <Prop label="Color encendido">
            <ColorField value={el.config.colorOn} onChange={(v) => update((e) => e.type === 'shift_light' && (e.config.colorOn = v))} />
          </Prop>
          <Prop label="Color apagado">
            <ColorField value={el.config.colorOff} onChange={(v) => update((e) => e.type === 'shift_light' && (e.config.colorOff = v))} />
          </Prop>
          <Prop label="Parpadeo (Hz)">
            <Num value={el.config.blinkHz} onChange={(v) => update((e) => e.type === 'shift_light' && (e.config.blinkHz = v))} min={0} max={30} step={0.5} />
          </Prop>
          <GlowProps
            glow={el.config.glow}
            blinkDuty={el.config.blinkDuty}
            hasBlink={el.config.blinkHz > 0}
            onGlow={(g) => update((e) => e.type === 'shift_light' && (e.config.glow = g))}
            onDuty={(d) => update((e) => e.type === 'shift_light' && (e.config.blinkDuty = d))}
          />
        </div>
      )}
      {el.type === 'bar' && (
        <div className="prop-group">
          <h3>Barra</h3>
          <Prop label="Variable">
            <VarSelect value={el.config.variable} onlyNumeric onChange={(v) => update((e) => e.type === 'bar' && v && ((e.config.variable = v), applyRange(e, v)))} />
          </Prop>
          <Prop label="Mín. / Máx.">
            <div className="pair">
              <Num value={el.config.min} onChange={(v) => update((e) => e.type === 'bar' && (e.config.min = v))} />
              <Num value={el.config.max} onChange={(v) => update((e) => e.type === 'bar' && (e.config.max = v))} />
            </div>
          </Prop>
          <Prop label="Orientación">
            <Sel value={el.config.orientation} onChange={(v) => update((e) => e.type === 'bar' && (e.config.orientation = v))} options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]} />
          </Prop>
          <Prop label="Estilo">
            <Sel value={el.config.style} onChange={(v) => update((e) => e.type === 'bar' && (e.config.style = v))} options={[{ value: 'continuous', label: 'Continua' }, { value: 'segments', label: 'Segmentos' }]} />
          </Prop>
          {el.config.style === 'segments' && (
            <Prop label="Segmentos / Sep.">
              <div className="pair">
                <Num value={el.config.segments} onChange={(v) => update((e) => e.type === 'bar' && (e.config.segments = v))} min={1} />
                <Num value={el.config.gap} onChange={(v) => update((e) => e.type === 'bar' && (e.config.gap = v))} min={0} />
              </div>
            </Prop>
          )}
          <Prop label="Esquinas">
            <Num value={el.config.radius} onChange={(v) => update((e) => e.type === 'bar' && (e.config.radius = v))} min={0} />
          </Prop>
          <Prop label="Color relleno">
            <ColorField value={el.config.colorFill} onChange={(v) => update((e) => e.type === 'bar' && (e.config.colorFill = v))} />
          </Prop>
          <Prop label="Color fondo">
            <ColorField value={el.config.colorBg} onChange={(v) => update((e) => e.type === 'bar' && (e.config.colorBg = v))} />
          </Prop>
          <Prop label="Suavizado (ms)">
            <Num value={el.config.smoothingMs} onChange={(v) => update((e) => e.type === 'bar' && (e.config.smoothingMs = v))} min={0} step={50} />
          </Prop>
          <Prop label="Opciones">
            <div className="col gap4">
              <Chk value={el.config.bipolar} label="Bipolar (centro en cero)" onChange={(v) => update((e) => e.type === 'bar' && (e.config.bipolar = v))} />
              <Chk value={el.config.reverse} label="Invertir sentido" onChange={(v) => update((e) => e.type === 'bar' && (e.config.reverse = v))} />
            </div>
          </Prop>
          <ThresholdsEditor thresholds={el.config.thresholds} onChange={(t) => update((e) => e.type === 'bar' && (e.config.thresholds = t))} />
          {el.config.style === 'continuous' && !el.config.bipolar && (
            <>
              <h3>Textura personalizada</h3>
              <Prop label="Llenado">
                <ImageField value={el.config.fillImage} onChange={(v) => update((e) => e.type === 'bar' && (e.config.fillImage = v))} onSize={(w, h) => update((e) => ((e.width = w), (e.height = h)))} />
              </Prop>
              <Prop label="Fondo">
                <ImageField value={el.config.bgImage} onChange={(v) => update((e) => e.type === 'bar' && (e.config.bgImage = v))} />
              </Prop>
              {el.config.fillImage && (
                <Prop label="Opciones">
                  <Chk value={!!el.config.tintImage} label="Teñir la textura con el color de la barra" onChange={(v) => update((e) => e.type === 'bar' && (e.config.tintImage = v))} />
                </Prop>
              )}
            </>
          )}
        </div>
      )}
      {el.type === 'gauge' && (
        <div className="prop-group">
          <h3>Indicador circular</h3>
          <Prop label="Variable">
            <VarSelect value={el.config.variable} onlyNumeric onChange={(v) => update((e) => e.type === 'gauge' && v && ((e.config.variable = v), applyRange(e, v)))} />
          </Prop>
          <Prop label="Mín. / Máx.">
            <div className="pair">
              <Num value={el.config.min} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.min = v))} />
              <Num value={el.config.max} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.max = v))} />
            </div>
          </Prop>
          <Prop label="Ángulo ini. / fin">
            <div className="pair">
              <Num value={el.config.startAngle} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.startAngle = v))} />
              <Num value={el.config.endAngle} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.endAngle = v))} />
            </div>
          </Prop>
          <Prop label="Grosor">
            <Num value={el.config.thickness} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.thickness = v))} min={1} />
          </Prop>
          <Prop label="Estilo">
            <Sel value={el.config.style} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.style = v))} options={[{ value: 'arc', label: 'Arco continuo' }, { value: 'segments', label: 'Segmentos' }]} />
          </Prop>
          {el.config.style === 'segments' && (
            <Prop label="Segmentos / Sep.(°)">
              <div className="pair">
                <Num value={el.config.segments} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.segments = v))} min={1} />
                <Num value={el.config.gap} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.gap = v))} min={0} step={0.5} />
              </div>
            </Prop>
          )}
          <Prop label="Color">
            <ColorField value={el.config.color} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.color = v))} />
          </Prop>
          <Prop label="Color fondo">
            <ColorField value={el.config.bgColor} onChange={(v) => update((e) => e.type === 'gauge' && (e.config.bgColor = v))} />
          </Prop>
          <Prop label="Sentido">
            <Chk value={el.config.clockwise} label="Horario" onChange={(v) => update((e) => e.type === 'gauge' && (e.config.clockwise = v))} />
          </Prop>
          <ThresholdsEditor thresholds={el.config.thresholds} onChange={(t) => update((e) => e.type === 'gauge' && (e.config.thresholds = t))} />
        </div>
      )}
      {el.type === 'icon' && <IconProps el={el} update={update} />}
      {el.type === 'image' && (
        <div className="prop-group">
          <h3>Imagen</h3>
          <Prop label="Archivo">
            <div className="row gap4">
              <span className="small mono grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {el.config.file || '—'}
              </span>
              <button
                className="small outline"
                onClick={async () => {
                  const a = await api.pickAsset('image');
                  if (!a) return;
                  if (a.error) toast(a.error, 'err');
                  useStore.getState().addAssetUrl(a.path, a.dataUrl);
                  update((e) => {
                    if (e.type !== 'image') return;
                    e.config.file = a.path;
                    if (a.width && a.height) {
                      e.width = a.width;
                      e.height = a.height;
                    }
                  });
                }}
              >
                Importar…
              </button>
            </div>
          </Prop>
          <Prop label="Tinte">
            <ColorField value={el.config.tint} onChange={(v) => update((e) => e.type === 'image' && (e.config.tint = v))} />
          </Prop>
          <Prop label="Ajuste">
            <Sel value={el.config.fit} onChange={(v) => update((e) => e.type === 'image' && (e.config.fit = v))} options={[{ value: 'stretch', label: 'Estirar' }, { value: 'fit', label: 'Ajustar (mantener proporción)' }, { value: 'fill', label: 'Rellenar' }]} />
          </Prop>
        </div>
      )}
      {el.type === 'rect' && (
        <div className="prop-group">
          <h3>Rectángulo</h3>
          <Prop label="Relleno">
            <ColorField value={el.config.fill} onChange={(v) => update((e) => e.type === 'rect' && (e.config.fill = v))} />
          </Prop>
          <Prop label="Borde">
            <ColorField value={el.config.stroke} onChange={(v) => update((e) => e.type === 'rect' && (e.config.stroke = v))} />
          </Prop>
          <Prop label="Grosor / Esquinas">
            <div className="pair">
              <Num value={el.config.strokeWidth} onChange={(v) => update((e) => e.type === 'rect' && (e.config.strokeWidth = v))} min={0} />
              <Num value={el.config.radius} onChange={(v) => update((e) => e.type === 'rect' && (e.config.radius = v))} min={0} />
            </div>
          </Prop>
        </div>
      )}
      {el.type === 'circle' && (
        <div className="prop-group">
          <h3>Círculo</h3>
          <Prop label="Relleno">
            <ColorField value={el.config.fill} onChange={(v) => update((e) => e.type === 'circle' && (e.config.fill = v))} />
          </Prop>
          <Prop label="Borde">
            <ColorField value={el.config.stroke} onChange={(v) => update((e) => e.type === 'circle' && (e.config.stroke = v))} />
          </Prop>
          <Prop label="Grosor borde">
            <Num value={el.config.strokeWidth} onChange={(v) => update((e) => e.type === 'circle' && (e.config.strokeWidth = v))} min={0} />
          </Prop>
        </div>
      )}
      {el.type === 'line' && (
        <div className="prop-group">
          <h3>Línea</h3>
          <Prop label="Color">
            <ColorField value={el.config.color} onChange={(v) => update((e) => e.type === 'line' && (e.config.color = v))} />
          </Prop>
          <Prop label="Grosor">
            <Num value={el.config.thickness} onChange={(v) => update((e) => e.type === 'line' && (e.config.thickness = v))} min={1} />
          </Prop>
        </div>
      )}

      <AnimProps el={el} update={update} />
      <RulesEditor el={el} update={update} limiter={limiter} />
    </div>
  );
}

/** Destello y ciclo de parpadeo de una luz. */
function GlowProps({ glow, blinkDuty, hasBlink, onGlow, onDuty }: { glow: Glow | undefined; blinkDuty: number | undefined; hasBlink: boolean; onGlow: (g: Glow) => void; onDuty: (d: number) => void }) {
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
function ImageField({ value, onChange, onSize }: { value: string | undefined; onChange: (v: string | undefined) => void; onSize?: (w: number, h: number) => void }) {
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

function applyRange(e: DisplayElement, variable: string): void {
  const def = VARIABLE_MAP[variable];
  if (!def) return;
  if (e.type === 'bar' || e.type === 'gauge' || e.type === 'needle') {
    e.config.min = def.range[0];
    e.config.max = def.range[1];
  }
}

function centerEl(w: number | undefined, h: number | undefined, id: string, d: { pages: { elements: DisplayElement[] }[] }): void {
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
  }[t];
}

function StyleProps({ style, onChange }: { style: TextStyle; onChange: (s: TextStyle) => void }) {
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

function TextProps({ el, update }: { el: Extract<DisplayElement, { type: 'text' }>; update: (fn: (e: DisplayElement) => void) => void }) {
  const b = el.binding;
  const def = b.variable ? VARIABLE_MAP[b.variable] : undefined;
  const setB = (patch: Partial<typeof b>) => update((e) => e.type === 'text' && Object.assign(e.binding, patch));
  const unitOptions = def ? unitChoices(def.unit) : [];
  return (
    <>
      <div className="prop-group">
        <h3>Contenido</h3>
        <Prop label="Variable">
          <VarSelect value={b.variable} allowNone onChange={(v) => setB({ variable: v })} />
        </Prop>
        {def?.physics_only && <div className="warn small mb8">* No disponible en replays ni coches remotos: se mostrará el valor por defecto.</div>}
        {!b.variable && (
          <Prop label="Texto">
            <Txt value={b.staticText ?? ''} onChange={(v) => setB({ staticText: v })} />
          </Prop>
        )}
        {def && (
          <Prop label="Actualizar" title="Frecuencia propia de este texto: entre actualizaciones el valor se congela (útil para que las milésimas sean legibles)">
            <Sel
              value={String(b.updateHz ?? 0)}
              onChange={(v) => setB({ updateHz: Number(v) || undefined })}
              options={[
                { value: '0', label: 'Como el display' },
                ...[30, 20, 10, 5, 4, 2, 1].map((hz) => ({ value: String(hz), label: `${hz} Hz` })),
              ]}
            />
          </Prop>
        )}
        {def && def.type === 'time_ms' && (
          <Prop label="Formato de tiempo">
            <Sel<TimeFormat>
              value={b.timeFormat ?? 'm:ss.mmm'}
              onChange={(v) => setB({ timeFormat: v })}
              options={[
                { value: 'm:ss.mmm', label: '1:23.456' },
                { value: "m'ss\"mm", label: '1\'23"45' },
                { value: 'm:ss.m', label: '1:23.4' },
                { value: 'ss.mmm', label: '83.456' },
                { value: 'h:mm:ss', label: '0:01:23' },
              ]}
            />
          </Prop>
        )}
        {def && def.type !== 'time_ms' && def.type !== 'boolean' && (
          <>
            <Prop label="Decimales / Ceros">
              <div className="pair">
                <Num value={b.decimals} onChange={(v) => setB({ decimals: v })} min={0} max={6} />
                <Num value={b.padZeros} onChange={(v) => setB({ padZeros: v })} min={0} max={6} />
              </div>
            </Prop>
            {unitOptions.length > 1 && (
              <Prop label="Unidad">
                <select value={b.unit ?? ''} onChange={(e) => setB({ unit: e.target.value || undefined })}>
                  {unitOptions.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </Prop>
            )}
            <Prop label="Mostrar signo">
              <Chk value={b.showSign} onChange={(v) => setB({ showSign: v })} />
            </Prop>
          </>
        )}
        {def?.type === 'boolean' && (
          <Prop label="Texto ON / OFF">
            <div className="pair">
              <Txt value={b.map?.true ?? 'ON'} onChange={(v) => setB({ map: { ...b.map, true: v } })} />
              <Txt value={b.map?.false ?? 'OFF'} onChange={(v) => setB({ map: { ...b.map, false: v } })} />
            </div>
          </Prop>
        )}
        {b.variable && (
          <Prop label="Prefijo / Sufijo">
            <div className="pair">
              <Txt value={b.prefix} onChange={(v) => setB({ prefix: v })} />
              <Txt value={b.suffix} onChange={(v) => setB({ suffix: v })} />
            </div>
          </Prop>
        )}
      </div>
      <div className="prop-group">
        <h3>Estilo</h3>
        <StyleProps style={el.style} onChange={(s) => update((e) => e.type === 'text' && (e.style = s))} />
      </div>
    </>
  );
}

function unitChoices(base: string): { value: string; label: string }[] {
  const map: Record<string, string[]> = { 'km/h': ['mph'], '°C': ['°F'], bar: ['psi'], psi: ['bar'], L: ['gal'] };
  const alts = map[base];
  if (!alts) return [];
  return [{ value: '', label: `${base} (automático)` }, { value: base, label: base }, ...alts.map((a) => ({ value: a, label: a }))];
}

function IconProps({ el, update }: { el: Extract<DisplayElement, { type: 'icon' }>; update: (fn: (e: DisplayElement) => void) => void }) {
  const icons = useStore((s) => s.icons);
  const assets = useStore((s) => s.assets);
  const c = el.config;
  const set = (patch: Partial<typeof c>) => update((e) => e.type === 'icon' && Object.assign(e.config, patch));
  const customIcons = Object.keys(assets).filter((k) => k.startsWith('assets/icons/'));
  return (
    <div className="prop-group">
      <h3>Icono</h3>
      <Prop label="Icono">
        <div className="row gap4">
          <select value={c.icon} onChange={(e) => set({ icon: e.target.value })}>
            <optgroup label="Integrados">
              {icons.map((i) => (
                <option key={i.id} value={`builtin:${i.id}`}>
                  {i.id}
                </option>
              ))}
            </optgroup>
            {customIcons.length > 0 && (
              <optgroup label="Del proyecto">
                {customIcons.map((k) => (
                  <option key={k} value={k}>
                    {k.replace('assets/icons/', '')}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            className="icon"
            title="Importar icono PNG (blanco sobre transparente para poder colorearlo)"
            onClick={async () => {
              const a = await api.pickAsset('icon');
              if (!a) return;
              useStore.getState().addAssetUrl(a.path, a.dataUrl);
              set({ icon: a.path });
            }}
          >
            <Icon name="plus" size={12} />
          </button>
        </div>
      </Prop>
      <Prop label="Variable">
        <VarSelect value={c.variable} allowNone onlyBoolean onChange={(v) => set({ variable: v })} />
      </Prop>
      {c.variable && (
        <Prop label="Mostrar">
          <Sel value={c.showWhen} onChange={(v) => set({ showWhen: v })} options={[{ value: 'when_true', label: 'Cuando está activo' }, { value: 'when_false', label: 'Cuando NO está activo' }, { value: 'always', label: 'Siempre' }]} />
        </Prop>
      )}
      <Prop label="Color activo">
        <ColorField value={c.colorOn} onChange={(v) => set({ colorOn: v })} />
      </Prop>
      <Prop label="Inactivo">
        <div className="col gap4">
          <Chk value={c.dimWhenOff} label="Mostrar atenuado (si no, se oculta)" onChange={(v) => set({ dimWhenOff: v })} />
          {c.dimWhenOff && <ColorField value={c.colorOff} onChange={(v) => set({ colorOff: v })} />}
        </div>
      </Prop>
    </div>
  );
}

function ThresholdsEditor({ thresholds, onChange }: { thresholds: Threshold[]; onChange: (t: Threshold[]) => void }) {
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
function AnimProps({ el, update }: { el: DisplayElement; update: (fn: (e: DisplayElement) => void) => void }) {
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
function CondList({ list, onChange, limiter, emptyLabel }: { list: PageCondition[]; onChange: (l: PageCondition[]) => void; limiter: number; emptyLabel: string }) {
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

const BUTTON_OPTIONS = [
  { value: 'kers_button', label: 'Botón KERS' },
  ...(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const).map((l) => ({ value: `extra_${l}`, label: `Extra ${l.toUpperCase()}` })),
  { value: 'drs_active', label: 'DRS' },
  { value: 'handbrake_on', label: 'Freno de mano' },
  { value: 'clutch_full', label: 'Embrague a fondo' },
  { value: 'pit_limiter', label: 'Limitador de boxes' },
  { value: 'headlights', label: 'Luces' },
  { value: 'high_beams', label: 'Luces largas' },
];

/** Activador de una pantalla de funcionalidad. */
function TriggerProps({ tr, onChange, limiter }: { tr: PageTrigger; onChange: (t: PageTrigger) => void; limiter: number }) {
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

function RulesEditor({ el, update, limiter }: { el: DisplayElement; update: (fn: (e: DisplayElement) => void) => void; limiter: number }) {
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

function MultiProps({ els }: { els: DisplayElement[] }) {
  const patchPage = useStore((s) => s.patchPage);
  const ids = els.map((e) => e.id);
  const align = (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') =>
    patchPage((pg) => {
      const sel = pg.elements.filter((e) => ids.includes(e.id) && !e.locked);
      const x0 = Math.min(...sel.map((e) => e.x));
      const x1 = Math.max(...sel.map((e) => e.x + e.width));
      const y0 = Math.min(...sel.map((e) => e.y));
      const y1 = Math.max(...sel.map((e) => e.y + e.height));
      for (const e of sel) {
        if (mode === 'left') e.x = x0;
        if (mode === 'right') e.x = x1 - e.width;
        if (mode === 'hcenter') e.x = Math.round((x0 + x1) / 2 - e.width / 2);
        if (mode === 'top') e.y = y0;
        if (mode === 'bottom') e.y = y1 - e.height;
        if (mode === 'vcenter') e.y = Math.round((y0 + y1) / 2 - e.height / 2);
      }
    });
  const distribute = (axis: 'x' | 'y') =>
    patchPage((pg) => {
      const sel = pg.elements.filter((e) => ids.includes(e.id) && !e.locked).sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
      if (sel.length < 3) return;
      const first = sel[0];
      const last = sel[sel.length - 1];
      const total = axis === 'x' ? last.x + last.width - first.x : last.y + last.height - first.y;
      const sizes = sel.reduce((s, e) => s + (axis === 'x' ? e.width : e.height), 0);
      const gap = (total - sizes) / (sel.length - 1);
      let cur = axis === 'x' ? first.x : first.y;
      for (const e of sel) {
        if (axis === 'x') e.x = Math.round(cur);
        else e.y = Math.round(cur);
        cur += (axis === 'x' ? e.width : e.height) + gap;
      }
    });
  return (
    <div>
      <h3>{els.length} elementos seleccionados</h3>
      <div className="prop-group">
        <h3>Alinear</h3>
        <div className="row gap4 wrap">
          <button className="small outline" onClick={() => align('left')}>
            Izquierda
          </button>
          <button className="small outline" onClick={() => align('hcenter')}>
            Centro
          </button>
          <button className="small outline" onClick={() => align('right')}>
            Derecha
          </button>
        </div>
        <div className="row gap4 wrap mt8">
          <button className="small outline" onClick={() => align('top')}>
            Arriba
          </button>
          <button className="small outline" onClick={() => align('vcenter')}>
            Medio
          </button>
          <button className="small outline" onClick={() => align('bottom')}>
            Abajo
          </button>
        </div>
      </div>
      <div className="prop-group">
        <h3>Distribuir</h3>
        <div className="row gap4">
          <button className="small outline" onClick={() => distribute('x')} disabled={els.length < 3}>
            Horizontal
          </button>
          <button className="small outline" onClick={() => distribute('y')} disabled={els.length < 3}>
            Vertical
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Área visible: parte de la textura que la malla muestra realmente (rectángulo UV). Se guarda en el
 * perfil del display (extension/display_profile.json) y el editor la marca sobre el lienzo.
 */
function VisibleAreaProps({ display }: { display: DisplayDef }) {
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

/** Guarda un cambio en la definición del display del perfil (y en extension/display_profile.json). */
async function saveDisplayDef(displayId: string, patch: Partial<DisplayDef>): Promise<void> {
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

/**
 * Emisión de la pantalla en el juego: cuánta luz emite el material del display. Es lo que decide si
 * las luces con luminancia alta "florecen" (bloom) en CSP. Se guarda en el perfil del vehículo.
 */
function ScreenEmissionProps({ display }: { display: DisplayDef }) {
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

function ProjectProps() {
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
