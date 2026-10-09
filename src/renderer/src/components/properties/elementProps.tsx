import type { DisplayElement, TimeFormat } from '@shared/model';
import { DEFAULT_GLOW, DEFAULT_TOUCH } from '@shared/model';
import { api } from '../../api';
import { toast } from '../../store';
import { TOUCH_ACTIONS, TOUCH_ACTION_MAP, TOUCH_GROUPS, TOUCH_SWITCHES, buttonStateVar, displayHasTouch, isSwitchAction, switchVar } from '@shared/touch';
import { VARIABLE_MAP } from '@shared/variables';
import { useStore, activeDisplayOf } from '../../store';
import { Chk, ColorField, Num, Prop, RpmField, Sel, Txt, VarSelect } from '../fields';
import { Icon } from '../icons';
import { GlowProps, ImageField, StyleProps, ThresholdsEditor, applyRange, unitChoices } from './shared';

/** Propiedades propias de cada tipo de elemento (lo que cambia entre un texto, una barra, un botón…). */
export function ElementTypeProps({ el, update, limiter }: { el: DisplayElement; update: (fn: (e: DisplayElement) => void) => void; limiter: number }) {
  return (
    <>
      {el.type === 'text' && <TextProps el={el} update={update} />}
      {el.type === 'button' && <ButtonProps el={el} update={update} />}
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
    </>
  );
}

export function TextProps({ el, update }: { el: Extract<DisplayElement, { type: 'text' }>; update: (fn: (e: DisplayElement) => void) => void }) {
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

export function ButtonProps({ el, update }: { el: Extract<DisplayElement, { type: 'button' }>; update: (fn: (e: DisplayElement) => void) => void }) {
  const dp = useStore(activeDisplayOf)!;
  const patchDisplay = useStore((st) => st.patchDisplay);
  const c = el.config;
  const def = TOUCH_ACTION_MAP[c.action];
  const set = (fn: (cfg: typeof c) => void) => update((e) => e.type === 'button' && fn(e.config));
  const normalPages = dp.pages.filter((pg) => !pg.kind || pg.kind === 'normal');
  const stateVar = buttonStateVar(el);
  const key = c.switch || 'a';
  const swDef = dp.settings.touch?.switches?.find((x) => x.key === key);
  const setSwitchDef = (patch: Partial<{ label: string; initial: boolean; remember: boolean }>) =>
    patchDisplay((d) => {
      d.settings.touch = { ...DEFAULT_TOUCH, ...(d.settings.touch ?? {}), switches: [...(d.settings.touch?.switches ?? [])] };
      const list = d.settings.touch.switches;
      const i = list.findIndex((x) => x.key === key);
      const base = i >= 0 ? list[i] : { key, label: `Interruptor ${key.toUpperCase()}`, initial: false, remember: false };
      const next = { ...base, ...patch };
      if (i >= 0) list[i] = next;
      else list.push(next);
    });

  return (
    <>
      <div className="prop-group">
        <h3>Acción</h3>
        <Prop label="Acción" title="Lo que hace al pulsarlo en el coche. Las acciones del coche usan la API de control de CSP (ac.setKERS, ac.setHeadlights…).">
          <Sel
            value={c.action}
            onChange={(v) => set((cfg) => (cfg.action = v as typeof cfg.action))}
            options={TOUCH_GROUPS.flatMap((grp) =>
              TOUCH_ACTIONS.filter((a) => a.group === grp).map((a) => ({ value: a.id, label: `${grp} · ${a.label}` })),
            )}
          />
        </Prop>
        {def?.note && <div className="muted small mb8">{def.note}</div>}
        {c.action === 'page_go' && (
          <Prop label="Página destino">
            <Sel
              value={c.pageId ?? normalPages[0]?.id ?? ''}
              onChange={(v) => set((cfg) => (cfg.pageId = v))}
              options={normalPages.map((pg) => ({ value: pg.id, label: pg.name }))}
            />
          </Prop>
        )}
        {isSwitchAction(c.action) && (
          <>
            <Prop label="Interruptor" title="Variable interna del display: úsala en reglas, iconos o condiciones de página (Interruptor táctil A…F)">
              <Sel value={key} onChange={(v) => set((cfg) => (cfg.switch = v))} options={TOUCH_SWITCHES.map((k) => ({ value: k, label: `Interruptor ${k.toUpperCase()} (${switchVar(k)})` }))} />
            </Prop>
            <Prop label="Nombre">
              <Txt value={swDef?.label ?? `Interruptor ${key.toUpperCase()}`} onChange={(v) => setSwitchDef({ label: v })} />
            </Prop>
            <Prop label="Al cargar">
              <div className="col gap4">
                <Chk value={swDef?.initial ?? false} label="Empezar activado" onChange={(v) => setSwitchDef({ initial: v })} />
                <Chk value={swDef?.remember ?? false} label="Recordar entre sesiones" onChange={(v) => setSwitchDef({ remember: v })} />
              </div>
            </Prop>
          </>
        )}
        <Prop label="Pulsación" title="tap: actúa al tocar · mientras se mantiene: actúa sin parar hasta soltar (KERS) · repetir: repite mientras se mantiene (subir valores)">
          <Sel
            value={c.behavior}
            onChange={(v) => set((cfg) => (cfg.behavior = v))}
            options={[
              { value: 'tap', label: 'Al tocar' },
              { value: 'hold', label: 'Mientras se mantiene' },
              { value: 'repeat', label: 'Repetir al mantener' },
            ]}
          />
        </Prop>
        {c.behavior === 'repeat' && (
          <Prop label="Repetir cada (ms)">
            <Num value={c.repeatMs} onChange={(v) => set((cfg) => (cfg.repeatMs = Math.max(50, v)))} min={50} max={2000} step={10} />
          </Prop>
        )}
        {def?.usesStep && (
          <Prop label="Paso" title="Cuánto cambia el valor en cada pulsación (0 = el paso normal de la acción)">
            <Num value={c.step} onChange={(v) => set((cfg) => (cfg.step = Math.max(0, v)))} min={0} step={0.005} />
          </Prop>
        )}
        <Prop label="Zona táctil extra (px)" title="Amplía el área sensible alrededor del botón: ayuda a acertar con el coche en movimiento">
          <Num value={c.padding} onChange={(v) => set((cfg) => (cfg.padding = Math.max(0, v)))} min={0} max={200} />
        </Prop>
        {def?.holdOnly && c.behavior !== 'hold' && (
          <div className="muted small">Esta acción está pensada para "mientras se mantiene".</div>
        )}
      </div>
      <div className="prop-group">
        <h3>Aspecto</h3>
        <Prop label="Forma">
          <Sel
            value={c.shape}
            onChange={(v) => set((cfg) => (cfg.shape = v))}
            options={[
              { value: 'rect', label: 'Rectángulo' },
              { value: 'circle', label: 'Círculo' },
              { value: 'none', label: 'Sin fondo (solo texto/imagen)' },
            ]}
          />
        </Prop>
        <Prop label="Relleno / Puntero">
          <div className="pair">
            <ColorField value={c.fill} onChange={(v) => set((cfg) => (cfg.fill = v))} />
            <ColorField value={c.fillHover} onChange={(v) => set((cfg) => (cfg.fillHover = v))} />
          </div>
        </Prop>
        <Prop label="Pulsado / Activo">
          <div className="pair">
            <ColorField value={c.fillActive} onChange={(v) => set((cfg) => (cfg.fillActive = v))} />
            <ColorField value={c.fillOn} onChange={(v) => set((cfg) => (cfg.fillOn = v))} />
          </div>
        </Prop>
        <Prop label="Borde / Grosor">
          <div className="pair">
            <ColorField value={c.stroke} onChange={(v) => set((cfg) => (cfg.stroke = v))} />
            <Num value={c.strokeWidth} onChange={(v) => set((cfg) => (cfg.strokeWidth = Math.max(0, v)))} min={0} max={40} />
          </div>
        </Prop>
        {c.shape === 'rect' && (
          <Prop label="Esquinas">
            <Num value={c.radius} onChange={(v) => set((cfg) => (cfg.radius = Math.max(0, v)))} min={0} />
          </Prop>
        )}
        <Prop label="Imagen">
          <ImageField value={c.image} onChange={(v) => set((cfg) => (cfg.image = v))} />
        </Prop>
        <Prop label="Imagen activo">
          <ImageField value={c.imageOn} onChange={(v) => set((cfg) => (cfg.imageOn = v))} />
        </Prop>
        <Prop label="Texto">
          <Txt value={c.label} onChange={(v) => set((cfg) => (cfg.label = v))} />
        </Prop>
        <Prop label="Texto activo">
          <Txt value={c.labelOn ?? ''} placeholder="(el mismo)" onChange={(v) => set((cfg) => (cfg.labelOn = v || undefined))} />
        </Prop>
        <StyleProps style={c.style} onChange={(st) => set((cfg) => (cfg.style = st))} />
        <Prop label="Color activo">
          <ColorField value={c.colorOn} onChange={(v) => set((cfg) => (cfg.colorOn = v))} />
        </Prop>
        <Prop label="Encendido">
          <Chk value={c.litWhenOn} label="Iluminar cuando la acción está activa" onChange={(v) => set((cfg) => (cfg.litWhenOn = v))} />
        </Prop>
        {c.litWhenOn && (
          <div className="muted small mb8">
            {stateVar ? `Se ilumina con: ${VARIABLE_MAP[stateVar]?.label ?? stateVar}` : 'Esta acción no informa de su estado: el botón no se puede iluminar.'}
          </div>
        )}
        <GlowProps
          glow={c.glow ?? DEFAULT_GLOW}
          blinkDuty={undefined}
          hasBlink={false}
          onGlow={(g) => set((cfg) => (cfg.glow = g))}
          onDuty={() => undefined}
        />
      </div>
      {!displayHasTouch(dp) && (
        <div className="prop-group">
          <div className="muted small">El táctil está desactivado en los ajustes del display: el botón se verá pero no responderá.</div>
        </div>
      )}
    </>
  );
}

export function IconProps({ el, update }: { el: Extract<DisplayElement, { type: 'icon' }>; update: (fn: (e: DisplayElement) => void) => void }) {
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
