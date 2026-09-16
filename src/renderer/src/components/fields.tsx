import { useEffect, useState } from 'react';
import type { Color, RpmValue } from '@shared/model';
import { VarPicker } from './VarPicker';
import { useStore } from '../store';

/** Campos reutilizables del panel de propiedades. */

export function Prop({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="prop" title={title}>
      <label>{label}</label>
      <div>{children}</div>
    </div>
  );
}

export function Num({ value, onChange, step = 1, min, max, disabled }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; disabled?: boolean }) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => setTxt(String(Math.round(value * 1000) / 1000)), [value]);
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
  const project = useStore((s) => s.project);
  const custom = Object.keys(project?.fonts ?? {});
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
