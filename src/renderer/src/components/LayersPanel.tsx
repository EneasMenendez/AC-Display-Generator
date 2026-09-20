import { useState } from 'react';
import type { ElementType } from '@shared/model';
import { useStore, activePageOf } from '../store';
import { typeLabel } from './PropertiesPanel';
import { Icon } from './icons';

const ADD: { type: ElementType; label: string; icon: string }[] = [
  { type: 'text', label: 'Texto / dato', icon: 'text' },
  { type: 'gear', label: 'Marcha', icon: 'gear' },
  { type: 'rpm_bar', label: 'Barra RPM', icon: 'segments' },
  { type: 'shift_light', label: 'Shift light', icon: 'light' },
  { type: 'shift_lights', label: 'Luces de cambio', icon: 'leds' },
  { type: 'needle', label: 'Aguja', icon: 'needle' },
  { type: 'bar', label: 'Barra', icon: 'bar' },
  { type: 'gauge', label: 'Indicador', icon: 'gauge' },
  { type: 'icon', label: 'Icono', icon: 'icon' },
  { type: 'image', label: 'Imagen', icon: 'image' },
  { type: 'video', label: 'Vídeo', icon: 'play' },
  { type: 'rect', label: 'Rectángulo', icon: 'rect' },
  { type: 'circle', label: 'Círculo', icon: 'circle' },
  { type: 'line', label: 'Línea', icon: 'line' },
];

export function LayersPanel() {
  const page = useStore(activePageOf);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const addElement = useStore((s) => s.addElement);
  const updateElement = useStore((s) => s.updateElement);
  const reorder = useStore((s) => s.reorder);
  const patchPage = useStore((s) => s.patchPage);
  const [filter, setFilter] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!page) return null;
  const els = [...page.elements].reverse();
  const f = filter.toLowerCase();
  const shown = f ? els.filter((e) => e.name.toLowerCase().includes(f) || typeLabel(e.type).toLowerCase().includes(f)) : els;

  return (
    <>
      <div className="panel-section">
        <h3>Añadir elemento</h3>
        <div className="add-grid">
          {ADD.map((a) => (
            <button key={a.type} onClick={() => addElement(a.type)} title={`Añadir ${typeLabel(a.type)}`}>
              <Icon name={a.icon} size={14} />
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-section row">
        <h3 style={{ margin: 0 }} className="grow">
          Capas ({els.length})
        </h3>
        <input type="text" placeholder="Filtrar" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 96, height: 22 }} />
      </div>
      <div className="layers">
        {shown.map((el) => (
          <div
            key={el.id}
            className={`layer ${selection.includes(el.id) ? 'selected' : ''} ${el.visible ? '' : 'hidden'}`}
            onClick={(e) => select([el.id], e.shiftKey || e.ctrlKey)}
            onDoubleClick={() => setRenaming(el.id)}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/acdg-layer', el.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const from = e.dataTransfer.getData('text/acdg-layer');
              if (!from || from === el.id) return;
              patchPage((pg) => {
                const arr = pg.elements;
                const i = arr.findIndex((x) => x.id === from);
                const [moved] = arr.splice(i, 1);
                const j = arr.findIndex((x) => x.id === el.id);
                arr.splice(j + 1, 0, moved);
              });
            }}
          >
            {renaming === el.id ? (
              <input
                type="text"
                autoFocus
                defaultValue={el.name}
                onBlur={(e) => {
                  updateElement(el.id, { name: e.target.value || el.name });
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="lname" title={el.name}>
                  {el.name}
                </span>
                <span className="ltype">{typeLabel(el.type)}</span>
              </>
            )}
            <button className={el.visible ? '' : 'on'} title="Mostrar/ocultar" onClick={(e) => (e.stopPropagation(), updateElement(el.id, { visible: !el.visible }))}>
              <Icon name={el.visible ? 'eye' : 'eyeOff'} size={14} />
            </button>
            <button className={el.locked ? 'on' : ''} title="Bloquear/desbloquear" onClick={(e) => (e.stopPropagation(), updateElement(el.id, { locked: !el.locked }))}>
              <Icon name={el.locked ? 'lock' : 'unlock'} size={14} />
            </button>
          </div>
        ))}
        {els.length === 0 && <div className="muted small" style={{ padding: 10 }}>Añade elementos con los botones de arriba. Arrastra en la lista para reordenar.</div>}
      </div>
      {selection.length === 1 && (
        <div className="panel-section row" style={{ gap: 2, padding: '6px 8px' }}>
          <span className="muted small grow" style={{ paddingLeft: 4 }}>
            Orden
          </span>
          <button className="icon" title="Al frente" onClick={() => reorder(selection[0], 'top')}>
            <Icon name="top" size={14} />
          </button>
          <button className="icon" title="Subir" onClick={() => reorder(selection[0], 'up')}>
            <Icon name="up" size={14} />
          </button>
          <button className="icon" title="Bajar" onClick={() => reorder(selection[0], 'down')}>
            <Icon name="down" size={14} />
          </button>
          <button className="icon" title="Al fondo" onClick={() => reorder(selection[0], 'bottom')}>
            <Icon name="bottom" size={14} />
          </button>
        </div>
      )}
    </>
  );
}
