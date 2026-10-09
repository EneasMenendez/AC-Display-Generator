import type { DisplayElement } from '@shared/model';
import { useStore, activeDisplayOf, activePageOf } from '../store';
import { Num, Prop, Txt } from './fields';
import { Icon } from './icons';
import { ElementTypeProps } from './properties/elementProps';
import { MultiProps } from './properties/multiProps';
import { ProjectProps } from './properties/projectProps';
import { AnimProps, RulesEditor, centerEl, typeLabel } from './properties/shared';

/**
 * Panel de propiedades: cabecera común del elemento (nombre, posición, tamaño), las propiedades de
 * su tipo y, sin selección, las del proyecto. Cada parte vive en ./properties.
 */

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

      <ElementTypeProps el={el} update={update} limiter={limiter} />
      <AnimProps el={el} update={update} />
      <RulesEditor el={el} update={update} limiter={limiter} />
    </div>
  );
}
