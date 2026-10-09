import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCmAccent } from '../src/main/services/contentManager';

/**
 * Lectura del acento de Content Manager: su Values.data es un formato interno (LZF), así que lo que
 * se comprueba es que se entiende cuando está bien y que nunca revienta cuando no.
 */

const tmps: string[] = [];
const originalLocal = process.env.LOCALAPPDATA;

/** Values.data de mentira: byte de formato + LZF con solo tiradas de literales. */
function fakeValues(lines: string[]): Buffer {
  const text = Buffer.from(`version: 2\n${lines.join('\n')}\n`, 'utf8');
  const out: number[] = [0x0b];
  for (let i = 0; i < text.length; i += 32) {
    const chunk = text.subarray(i, i + 32);
    out.push(chunk.length - 1, ...chunk);
  }
  return Buffer.from(out);
}

function withValues(data: Buffer | null): void {
  const dir = mkdtempSync(join(tmpdir(), 'acdg-cm-'));
  tmps.push(dir);
  process.env.LOCALAPPDATA = dir;
  process.env.APPDATA = dir;
  if (data) {
    mkdirSync(join(dir, 'AcTools Content Manager'), { recursive: true });
    writeFileSync(join(dir, 'AcTools Content Manager', 'Values.data'), data);
  }
}

afterEach(() => {
  process.env.LOCALAPPDATA = originalLocal;
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('acento de Content Manager', () => {
  it('lee el color cuando está personalizado (formato WPF #AARRGGBB)', () => {
    withValues(fakeValues(['Settings.DriveSettings.PlayerName\tAlguien', 'AppAppearanceManager.AccentColor\t#FFE10600', 'otra\tcosa']));
    expect(readCmAccent()).toBe('#E10600');
  });

  it('acepta también #RRGGBB y la clave abreviada', () => {
    withValues(fakeValues(['appearance_accentColor\t#1ba1e2']));
    expect(readCmAccent()).toBe('#1BA1E2');
  });

  it('sin acento guardado devuelve null (Content Manager usa el suyo por defecto)', () => {
    withValues(fakeValues(['appearance_theme\t/AcManager.Controls;component/Assets/ModernUI.AcTheme.xaml']));
    expect(readCmAccent()).toBeNull();
  });

  it('no revienta si el archivo no existe, está vacío o tiene otro formato', () => {
    withValues(null);
    expect(readCmAccent()).toBeNull();
    withValues(Buffer.alloc(0));
    expect(readCmAccent()).toBeNull();
    withValues(Buffer.from([0x0b, 0xff, 0xff, 0xff, 0xff, 0xff]));
    expect(readCmAccent()).toBeNull();
    withValues(Buffer.from('texto plano cualquiera', 'utf8'));
    expect(readCmAccent()).toBeNull();
  });

  it('entiende el Values.data real de este equipo, si hay Content Manager instalado', () => {
    const real = process.env.LOCALAPPDATA && join(originalLocal ?? '', 'AcTools Content Manager', 'Values.data');
    process.env.LOCALAPPDATA = originalLocal;
    if (!real || !existsSync(real)) return;
    const accent = readCmAccent();
    // o un color válido, o null si el usuario no lo ha cambiado: lo que no vale es lanzar
    expect(accent === null || /^#[0-9A-F]{6}$/.test(accent)).toBe(true);
  });
});
