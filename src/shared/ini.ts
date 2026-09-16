/**
 * Parser mínimo de INI al estilo CSP: secciones [NOMBRE] (con variantes [INCLUDE: x] y [SECCION_...]),
 * claves KEY = valor, comentarios con ';' o '//'.
 */

export interface IniSection {
  name: string;
  values: Record<string, string>;
  /** índices de línea (0-based) de la cabecera y de la última línea de la sección */
  start: number;
  end: number;
}

export function parseIni(text: string): IniSection[] {
  const lines = text.split(/\r?\n/);
  const sections: IniSection[] = [];
  let cur: IniSection | null = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = stripComment(raw).trim();
    if (!line) continue;
    const m = /^\[(.+?)\]\s*$/.exec(line);
    if (m) {
      if (cur) cur.end = lastContentLine(lines, cur.start, i - 1);
      cur = { name: m[1].trim(), values: {}, start: i, end: i };
      sections.push(cur);
      continue;
    }
    if (!cur) continue;
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim().toUpperCase();
      cur.values[key] = line.slice(eq + 1).trim();
    }
  }
  if (cur) cur.end = lastContentLine(lines, cur.start, lines.length - 1);
  return sections;
}

function lastContentLine(lines: string[], from: number, to: number): number {
  for (let i = to; i > from; i--) if (stripComment(lines[i]).trim()) return i;
  return from;
}

function stripComment(line: string): string {
  // CSP acepta ';' y '//' como comentario; las expresiones $" ... " pueden contener ';' pero no en configs de display
  const dollar = line.indexOf('$"');
  const semi = line.indexOf(';');
  const slash = line.indexOf('//');
  let cut = -1;
  if (semi >= 0 && (dollar < 0 || semi < dollar)) cut = semi;
  if (slash >= 0 && (cut < 0 || slash < cut) && (dollar < 0 || slash < dollar)) cut = slash;
  return cut >= 0 ? line.slice(0, cut) : line;
}

export const DISABLED_PREFIX = ';ACDG-OFF; ';

/** Comenta (desactiva) una sección completa; reversible con enableSection. */
export function disableSection(text: string, sectionName: string): string {
  const lines = text.split(/\r?\n/);
  const sec = parseIni(text).find((s) => s.name.toUpperCase() === sectionName.toUpperCase());
  if (!sec) return text;
  for (let i = sec.start; i <= sec.end; i++) if (lines[i].trim() && !lines[i].startsWith(DISABLED_PREFIX)) lines[i] = DISABLED_PREFIX + lines[i];
  return lines.join('\n');
}

/** Reactiva todas las secciones desactivadas por ACDG. */
export function enableAllSections(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => (l.startsWith(DISABLED_PREFIX) ? l.slice(DISABLED_PREFIX.length) : l))
    .join('\n');
}

export function listDisabledSections(text: string): string[] {
  const out: string[] = [];
  for (const l of text.split(/\r?\n/)) {
    if (!l.startsWith(DISABLED_PREFIX)) continue;
    const m = /^\[(.+?)\]/.exec(l.slice(DISABLED_PREFIX.length).trim());
    if (m) out.push(m[1]);
  }
  return out;
}
