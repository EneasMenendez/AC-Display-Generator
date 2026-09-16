import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES, VARIABLES, VARIABLE_MAP, type VariableDef } from '@shared/variables';
import { Icon } from './icons';

/**
 * Selector de variable con búsqueda. Por defecto muestra el catálogo seleccionado (etiquetas en español);
 * con "Todos los datos de AC/CSP" se amplía a los ~600 campos del SDK (car, wheels, sim, sesión).
 */
export function VarPicker({
  value,
  onChange,
  allowNone,
  onlyBoolean,
  onlyNumeric,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  allowNone?: boolean;
  onlyBoolean?: boolean;
  onlyNumeric?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [all, setAll] = useState<boolean>(() => {
    try {
      return localStorage.getItem('acdg:allVars') === '1';
    } catch {
      return false;
    }
  });
  const wrap = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number }>({ top: 0, right: 0 });
  const cur = value ? VARIABLE_MAP[value] : undefined;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const list = useMemo(() => {
    const f = q.trim().toLowerCase();
    const showAll = all || (cur?.advanced ?? false) || f.length > 0;
    return VARIABLES.filter((v) => {
      if (onlyBoolean && v.type !== 'boolean') return false;
      if (onlyNumeric && (v.type === 'boolean' || v.type === 'text')) return false;
      if (v.advanced && !showAll) return false;
      if (!f) return true;
      return v.label.toLowerCase().includes(f) || v.id.includes(f) || v.lua.toLowerCase().includes(f) || (v.description ?? '').toLowerCase().includes(f);
    });
  }, [q, all, cur, onlyBoolean, onlyNumeric]);

  const grouped = useMemo(() => {
    const g = new Map<string, VariableDef[]>();
    for (const cat of CATEGORIES) {
      const items = list.filter((v) => v.category === cat);
      if (items.length) g.set(cat, items);
    }
    return g;
  }, [list]);

  const pick = (id: string | undefined) => {
    onChange(id);
    setOpen(false);
    setQ('');
  };

  return (
    <div className="varpicker" ref={wrap}>
      <button
        type="button"
        className="varpicker-btn"
        onClick={(e) => {
          // el panel lateral recorta el desbordamiento: el desplegable se posiciona fijo respecto a la ventana
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const below = window.innerHeight - r.bottom;
          setPos(below > 300 ? { top: r.bottom + 4, right: window.innerWidth - r.right } : { bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right });
          setOpen(!open);
        }}
        title={cur ? `${cur.lua}${cur.description ? '\n' + cur.description : ''}` : ''}>
        <span className="grow" style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {cur ? cur.label : allowNone ? 'Texto fijo' : 'Seleccionar…'}
        </span>
        {cur?.physics_only && <span className="badge warn" title="No disponible en replays ni coches remotos">físicas</span>}
        <Icon name="down" size={12} />
      </button>
      {open && (
        <div className="varpicker-pop" style={{ position: 'fixed', ...pos }}>
          <div className="row gap4" style={{ padding: 6 }}>
            <input ref={inputRef} type="text" placeholder="Buscar dato… (nombre, campo Lua)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
          </div>
          <label className="row small muted" style={{ padding: '0 8px 6px', gap: 6 }}>
            <input
              type="checkbox"
              checked={all}
              onChange={(e) => {
                setAll(e.target.checked);
                try {
                  localStorage.setItem('acdg:allVars', e.target.checked ? '1' : '0');
                } catch {
                  /* ignorar */
                }
              }}
            />
            Todos los datos de AC/CSP ({VARIABLES.filter((v) => v.advanced).length} campos del SDK)
          </label>
          <div className="varpicker-list">
            {allowNone && (
              <div className={`varpicker-item ${!value ? 'selected' : ''}`} onClick={() => pick(undefined)}>
                <span>Texto fijo (sin variable)</span>
              </div>
            )}
            {[...grouped.entries()].map(([cat, items]) => (
              <div key={cat}>
                <div className="varpicker-cat">{cat}</div>
                {items.map((v) => (
                  <div key={v.id} className={`varpicker-item ${v.id === value ? 'selected' : ''}`} onClick={() => pick(v.id)} title={v.description || v.lua}>
                    <span className="grow">{v.label}</span>
                    {v.physics_only && <span className="badge warn">físicas</span>}
                    <span className="mono muted">{v.lua.length > 34 ? v.lua.slice(0, 33) + '…' : v.lua}</span>
                  </div>
                ))}
              </div>
            ))}
            {list.length === 0 && <div className="muted small" style={{ padding: 10 }}>Sin resultados. Activa "Todos los datos" para buscar en el SDK completo.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
