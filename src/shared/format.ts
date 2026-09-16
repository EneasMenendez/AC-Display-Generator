import type { TextBinding, TimeFormat } from './model';
import { VARIABLE_MAP, convertUnit } from './variables';

/**
 * Formateo de valores para el preview. El runtime Lua (ACDG.format) implementa exactamente las mismas reglas.
 */

export function formatTime(ms: number, fmt: TimeFormat = 'm:ss.mmm'): string {
  if (!Number.isFinite(ms) || ms < 0) return fmt === 'h:mm:ss' ? '-:--:--' : '-:--.---';
  const total = Math.floor(ms);
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mil = total % 1000;
  const p2 = (n: number) => n.toString().padStart(2, '0');
  const p3 = (n: number) => n.toString().padStart(3, '0');
  switch (fmt) {
    case 'm:ss.mmm':
      return `${h * 60 + m}:${p2(s)}.${p3(mil)}`;
    case "m'ss\"mm":
      return `${h * 60 + m}'${p2(s)}"${p2(Math.floor(mil / 10))}`;
    case 'm:ss.m':
      return `${h * 60 + m}:${p2(s)}.${Math.floor(mil / 100)}`;
    case 'ss.mmm':
      return `${(h * 60 + m) * 60 + s}.${p3(mil)}`;
    case 'h:mm:ss':
      return `${h}:${p2(m)}:${p2(s)}`;
  }
}

export function formatNumber(value: number, decimals: number, padZeros: number, showSign: boolean): string {
  if (!Number.isFinite(value)) return '-';
  let s = Math.abs(value).toFixed(Math.max(0, Math.min(6, decimals)));
  if (padZeros > 0) {
    const [int, frac] = s.split('.');
    s = int.padStart(padZeros, '0') + (frac !== undefined ? '.' + frac : '');
  }
  if (value < 0) s = '-' + s;
  else if (showSign && value > 0) s = '+' + s;
  return s;
}

export type VarValue = number | boolean | string;

export function formatBinding(b: TextBinding, raw: VarValue | undefined): string {
  if (!b.variable) return b.staticText ?? '';
  const def = VARIABLE_MAP[b.variable];
  let body: string;
  if (raw === undefined || raw === null) body = '-';
  else if (b.map && b.map[String(typeof raw === 'number' ? Math.round(raw) : raw)] !== undefined) {
    body = b.map[String(typeof raw === 'number' ? Math.round(raw) : raw)];
  } else if (typeof raw === 'boolean') body = raw ? 'ON' : 'OFF';
  else if (typeof raw === 'string') body = raw;
  else if (def?.type === 'time_ms') body = formatTime(raw, b.timeFormat);
  else {
    const v = def ? convertUnit(raw, def.unit, b.unit) : raw;
    body = formatNumber(v, b.decimals, b.padZeros, b.showSign);
  }
  return `${b.prefix}${body}${b.suffix}`;
}
