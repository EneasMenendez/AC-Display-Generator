import { useEffect, useRef, useState } from 'react';
import type { Color, RpmValue } from '@shared/model';
import { VarPicker } from './VarPicker';
import { useStore, activeDisplayOf } from '../store';

/** Campos reutilizables del panel de propiedades. */

export function Prop({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="prop" title={title}>
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

/** píxeles de arrastre por cada paso del valor */
const SCRUB_PX = 4;

/**
 * Campo numérico con arrastre: pulsar sobre el valor y mover el ratón a la izquierda baja y a la
 * derecha sube (paso a paso; Mayús ×10, Ctrl ×0,1). Un clic sin mover deja escribir el valor.
 */
export function Num({ value, onChange, step = 1, min, max, disabled }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; disabled?: boolean }) {
  const [txt, setTxt] = useState(String(value));
  const [scrubbing, setScrubbing] = useState(false);
  const drag = useRef<{ startX: number; startValue: number; moved: boolean; pointerId: number } | null>(null);
  useEffect(() => setTxt(String(Math.round(value * 1000) / 1000)), [value]);
  // si el campo desaparece a mitad de un arrastre (cambia la selección, se cierra el panel…) hay que
  // cerrar el grupo de deshacer: si no, el proyecto se queda sin registrar cambios en el historial
  useEffect(
    () => () => {
      if (drag.current?.moved) useStore.getState().endBatch();
      drag.current = null;
    },
    [],
  );
  const clamp = (v: number) => {
    let c = v;
    if (min !== undefined) c = Math.max(min, c);
    if (max !== undefined) c = Math.min(max, c);
    return Math.round(c * 1000) / 1000;
  };
  const decimals = Math.max(0, Math.min(3, -Math.floor(Math.log10(step)) ));
  function onPointerDown(e: React.PointerEvent<HTMLInputElement>) {
    if (disabled || e.button !== 0) return;
    const input = e.currentTarget;
    if (document.activeElement === input) return; // ya se está escribiendo: comportamiento normal del ratón
    e.preventDefault();
    try {
      input.setPointerCapture(e.pointerId);
    } catch {
      /* sin captura: el arrastre sigue funcionando mientras el puntero esté sobre el campo */
    }
    drag.current = { startX: e.clientX, startValue: value, moved: false, pointerId: e.pointerId };
  }
  function onPointerMove(e: React.PointerEvent<HTMLInputElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.moved) {
      if (Math.abs(dx) < 3) return;
      d.moved = true;
      setScrubbing(true);
      useStore.getState().beginBatch();
    }
    const mult = e.shiftKey ? 10 : e.ctrlKey || e.altKey ? 0.1 : 1;
    const steps = Math.trunc(dx / SCRUB_PX);
    const next = clamp(d.startValue + steps * step * mult);
    if (next !== value) onChange(Number(next.toFixed(decimals + (mult < 1 ? 1 : 0))));
  }
  function onPointerUp(e: React.PointerEvent<HTMLInputElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const input = e.currentTarget;
    try {
      input.releasePointerCapture(d.pointerId);
    } catch {
      /* ya liberado */
    }
    if (d.moved) {
      setScrubbing(false);
      useStore.getState().endBatch();
    } else {
      // clic sin arrastrar: editar el valor a mano
      input.focus();
      input.select();
    }
  }
  const commit = () => {
    const v = parseFloat(txt.replace(',', '.'));
    if (Number.isFinite(v)) {
      let c = v;
      if (min !== undefined) c = Math.max(min, c);
      if (max !== undefined) c = Math.min(max, c);
      if (c !== value) onChange(c);
      else setTxt(String(c));
    } else setTxt(String(value));
  };
  return (
    <input
      type="number"
      value={txt}
      step={step}
      min={min}
      max={max}
      disabled={disabled}
      className={scrubbing ? 'scrubbing' : 'scrub'}
      title="Arrastra a izquierda/derecha para cambiar el valor (Mayús ×10, Ctrl ×0,1); clic para escribir"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? step * 10 : step);
          let c = value + d;
          if (min !== undefined) c = Math.max(min, c);
          if (max !== undefined) c = Math.min(max, c);
          onChange(Math.round(c * 1000) / 1000);
        }
      }}
    />
  );
}

export function Txt({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  return (
    <input
      type="text"
      value={txt}
      placeholder={placeholder}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => txt !== value && onChange(txt)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function Sel<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Chk({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="row" style={{ gap: 6 }}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label && <span className="small">{label}</span>}
    </label>
  );
}

export function ColorField({ value, onChange }: { value: Color; onChange: (v: Color) => void }) {
  const rgb = value.slice(0, 7);
  const alpha = value.length === 9 ? parseInt(value.slice(7, 9), 16) / 255 : 1;
  const [txt, setTxt] = useState(value);
  useEffect(() => setTxt(value), [value]);
  const set = (r: string, a: number) => onChange(a >= 1 ? r.toUpperCase() : (r + Math.round(a * 255).toString(16).padStart(2, '0')).toUpperCase());
  return (
    <div className="color-field">
      <input type="color" value={rgb} onChange={(e) => set(e.target.value, alpha)} />
      <input
        type="text"
        value={txt}
        onChange={(e) => setTxt(e.target.value)}
        onBlur={() => {
          const v = txt.trim().toUpperCase();
          if (/^#[0-9A-F]{6}([0-9A-F]{2})?$/.test(v)) onChange(v);
          else setTxt(value);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        style={{ width: 84 }}
      />
      <input type="range" min={0} max={1} step={0.01} value={alpha} title={`Opacidad ${Math.round(alpha * 100)}%`} onChange={(e) => set(rgb, parseFloat(e.target.value))} style={{ width: 50 }} />
    </div>
  );
}

/** Valor de RPM absoluto o porcentaje del limitador. */
export function RpmField({ value, onChange, limiter }: { value: RpmValue; onChange: (v: RpmValue) => void; limiter: number }) {
  const isPct = typeof value === 'string';
  const num = isPct ? parseFloat(value) : value;
  return (
    <div className="rpm-field">
      <Num value={num} onChange={(v) => onChange(isPct ? (`${v}%` as RpmValue) : v)} step={isPct ? 1 : 100} min={0} />
      <select
        value={isPct ? 'pct' : 'abs'}
        title={isPct ? `≈ ${Math.round((num / 100) * limiter)} rpm con el limitador actual` : 'Valor absoluto'}
        onChange={(e) => onChange(e.target.value === 'pct' ? (`${Math.round((num / limiter) * 100)}%` as RpmValue) : Math.round((num / 100) * limiter))}
      >
        <option value="abs">rpm</option>
        <option value="pct">% lim.</option>
      </select>
      {isPct && <span className="muted mono hint">= {Math.round((num / 100) * limiter)} rpm</span>}
    </div>
  );
}

export function VarSelect(props: { value: string | undefined; onChange: (v: string | undefined) => void; allowNone?: boolean; onlyBoolean?: boolean; onlyNumeric?: boolean }) {
  return <VarPicker {...props} />;
}

export function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fonts = useStore((s) => s.fonts);
  const dp = useStore(activeDisplayOf);
  const custom = Object.keys(dp?.fonts ?? {});
  const all = [...new Set([...custom, ...fonts, value])].sort((a, b) => a.localeCompare(b));
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: value }}>
      {custom.length > 0 && (
        <optgroup label="Fuentes del proyecto">
          {custom.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Fuentes del sistema">
        {all
          .filter((f) => !custom.includes(f))
          .map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
      </optgroup>
    </select>
  );
}
