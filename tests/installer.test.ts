import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Instalación sobre una copia de prueba: lo que escribe en ext_config.ini, cómo deja el coche al
 * desinstalar y qué secciones ajenas desactiva. Es el código que toca los vehículos del usuario, así
 * que se prueba contra un árbol de archivos temporal (nunca un coche real).
 */

const TMP = mkdtempSync(join(tmpdir(), 'acdg-test-'));
const USERDATA = join(TMP, 'userdata');

vi.mock('electron', () => ({
  app: { getPath: () => USERDATA, getAppPath: () => process.cwd() },
  nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) },
}));

const { install, uninstall, cleanDisplays, removeNeedles } = await import('../src/main/services/installer');
import type { ButtonElement, Project } from '../src/shared/model';
const { createElement, createEmptyProject, createPhysicalNeedle } = await import('../src/shared/model');
const { parseProfile } = await import('../src/shared/profile');

const PROFILE = parseProfile({
  profile_version: 2,
  id: 'test_car.dash',
  name: 'Coche de prueba',
  car_ids: ['test_car'],
  displays: [{ id: 'dash', name: 'Dash', meshes: ['DISPLAY'], texture_size: { width: 1024, height: 512 } }],
}).profile!;

/** ext_config.ini de un coche cualquiera: un display propio, una aguja y el material de la pantalla */
const CAR_INI = `[HEADER]
VERSION=1

[SCRIPTABLE_DISPLAY_0]
MESHES = DISPLAY
SCRIPT = original.lua

[ANALOG_INDICATOR_0]
INPUT = RPM
OBJECT_NAME = RPM_NEEDLE
LUT = (| 0=0 | 8000=240 |)

[Material_DigitalScreen]
Emissive = 0.5
`;

let carPath = '';
let extDir = '';
let extConfig = '';

function newCar(): void {
  carPath = mkdtempSync(join(TMP, 'car-'));
  extDir = join(carPath, 'extension');
  mkdirSync(extDir, { recursive: true });
  extConfig = join(extDir, 'ext_config.ini');
  writeFileSync(extConfig, CAR_INI, 'utf8');
}

function project(): Project {
  const p = createEmptyProject({
    name: 'test',
    profileId: PROFILE.id,
    profileVersion: 2,
    carId: 'test_car',
    appVersion: '0.0.0',
    displays: [{ displayId: 'dash', name: 'Dash', width: 1024, height: 512 }],
  });
  p.displays[0].pages[0].elements.push(createElement('text'), createElement('rpm_bar'));
  return p;
}

function doInstall(p: Project, extra: Partial<Parameters<typeof install>[0]> = {}) {
  return install({ carPath, target: { kind: 'car' }, project: p, profile: PROFILE, extraFiles: {}, convertToDds: false, install: true, ...extra });
}

const ini = (): string => readFileSync(extConfig, 'utf8');

beforeEach(() => newCar());
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

describe('instalación', () => {
  it('escribe el script, la copia del proyecto y el bloque de ext_config.ini, y deja el coche limpio al desinstalar', () => {
    const r = doInstall(project());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(existsSync(join(extDir, 'dash.lua'))).toBe(true);
    expect(existsSync(join(extDir, 'acdg_project.acdisplay'))).toBe(true);

    const text = ini();
    // el bloque va al principio (los displays se cargan antes que el resto), tras [HEADER]
    expect(text.indexOf('[HEADER]')).toBeLessThan(text.indexOf('; ACDG BEGIN dash'));
    expect(text.indexOf('; ACDG BEGIN dash')).toBeLessThan(text.indexOf('[SCRIPTABLE_DISPLAY_0]'));
    expect(text).toContain('SCRIPT = dash.lua');
    expect(text).toContain('; ACDG FILES: dash.lua');
    // la emisión va al final, por encima del material del coche
    expect(text.indexOf('[Material_DigitalScreen]')).toBeLessThan(text.indexOf('; ACDG BEGIN _emissive'));
    expect(text).toContain('PROP_0 = ksEmissive, 3, 3, 3');
    // el display original del coche sigue intacto (no se toca sin pedirlo)
    expect(text).toContain('SCRIPT = original.lua');

    const done = uninstall(carPath, { kind: 'car' }, 'dash');
    expect(done.join(' ')).toContain('ext_config.ini');
    expect(existsSync(join(extDir, 'dash.lua'))).toBe(false);
    expect(existsSync(join(extDir, 'acdg_project.acdisplay'))).toBe(false);
    const after = ini();
    expect(after).not.toContain('ACDG BEGIN');
    expect(after).toContain('[SCRIPTABLE_DISPLAY_0]');
    expect(after).toContain('[Material_DigitalScreen]');
  });

  it('avisa del display ajeno sobre la misma malla y lo desactiva solo si se pide', () => {
    const r = doInstall(project());
    expect(r.warnings.join(' ')).toContain('SCRIPTABLE_DISPLAY_0');

    const clean = cleanDisplays(carPath, ['DISPLAY']);
    expect(clean.disabled.map((d) => d.section)).toEqual(['SCRIPTABLE_DISPLAY_0']);
    expect(clean.backup).toBeTruthy();
    expect(ini()).toContain(';ACDG-OFF;');
    // al desinstalar se reactiva lo que se desactivó
    uninstall(carPath, { kind: 'car' }, 'dash');
    expect(ini()).not.toContain(';ACDG-OFF;');
    expect(ini()).toContain('[SCRIPTABLE_DISPLAY_0]');
  });

  it('INTERACTIVE = 1 solo cuando el display tiene botones táctiles', () => {
    const plain = project();
    doInstall(plain);
    expect(ini()).not.toContain('INTERACTIVE');

    newCar();
    const touch = project();
    (touch.displays[0].pages[0].elements as ButtonElement[]).push(createElement('button') as ButtonElement);
    doInstall(touch);
    expect(ini()).toContain('INTERACTIVE = 1');
  });

  it('las agujas propias desactivan las del coche y no vuelven mientras sigan instaladas', () => {
    const p = project();
    p.physicalNeedles = [{ ...createPhysicalNeedle('RPM_NEEDLE'), input: 'RPM' }];
    doInstall(p);
    const withNeedles = ini();
    expect(withNeedles).toContain('; ACDG BEGIN _needles');
    expect(withNeedles).toContain('[ANALOG_INDICATOR_...]');
    // la aguja original del coche queda desactivada
    expect(withNeedles).toMatch(/;ACDG-OFF;\s*\[ANALOG_INDICATOR_0\]/);

    // quitar el display no debe devolver la aguja original (competiría con la nuestra)
    uninstall(carPath, { kind: 'car' }, 'dash');
    const afterUninstall = ini();
    expect(afterUninstall).toContain('; ACDG BEGIN _needles');
    expect(afterUninstall).toMatch(/;ACDG-OFF;\s*\[ANALOG_INDICATOR_0\]/);

    // al quitar las agujas sí vuelve
    removeNeedles(carPath, { kind: 'car' });
    const afterNeedles = ini();
    expect(afterNeedles).not.toContain('ACDG BEGIN _needles');
    expect(afterNeedles).toContain('[ANALOG_INDICATOR_0]');
    expect(afterNeedles).not.toContain(';ACDG-OFF;');
  });

  it('al empezar el proyecto anula los instrumentos de data/, con copia de seguridad y una sola vez', () => {
    // el coche ya tenía su propia sección [DATA] que los dejaba activos: la nuestra va detrás y manda
    writeFileSync(extConfig, CAR_INI + '\n[DATA]\nDISABLE_LIGHTSINI = 1\nDISABLE_ANALOGINSTRUMENTSINI = 0\n', 'utf8');
    const first = cleanDisplays(carPath, ['OTRA_MALLA']);
    expect(first.disabled).toEqual([]);
    expect(first.instruments).toBe(true);
    expect(first.backup).toBeTruthy();
    expect(readFileSync(join(first.backup!, 'ext_config.ini'), 'utf8')).not.toContain('ACDG BEGIN');
    const text = ini();
    const block = text.slice(text.indexOf('; ACDG BEGIN _instruments'));
    expect(block).toContain('[DATA]');
    expect(block).toContain('DISABLE_ANALOGINSTRUMENTSINI = 1');
    expect(block).toContain('DISABLE_DIGITALINSTRUMENTSINI = 1');
    // la que de verdad quita los textos de digital_instruments.ini
    expect(block).toContain('DISABLE_DI_TEXT_NODES = 1');
    expect(text.indexOf('DISABLE_ANALOGINSTRUMENTSINI = 0')).toBeLessThan(text.indexOf('; ACDG BEGIN _instruments'));
    // la sección original del coche no se toca
    expect(text).toContain('DISABLE_LIGHTSINI = 1');

    const again = cleanDisplays(carPath, ['OTRA_MALLA']);
    expect(again.instruments).toBe(false);
    expect(again.backup).toBeNull();
    expect(ini().match(/; ACDG BEGIN _instruments/g)).toHaveLength(1);
  });

  it('actualiza el bloque de una versión anterior (sin DISABLE_DI_TEXT_NODES) sin duplicarlo', () => {
    const old = '; ACDG BEGIN _instruments\n[DATA]\nDISABLE_ANALOGINSTRUMENTSINI = 1\nDISABLE_DIGITALINSTRUMENTSINI = 1\n; ACDG END _instruments\n';
    writeFileSync(extConfig, CAR_INI + '\n' + old, 'utf8');
    const r = cleanDisplays(carPath, ['OTRA_MALLA']);
    expect(r.instruments).toBe(true);
    expect(ini()).toContain('DISABLE_DI_TEXT_NODES = 1');
    expect(ini().match(/; ACDG BEGIN _instruments/g)).toHaveLength(1);
    // instalar con el bloque ya al día no lo toca
    expect(doInstall(project()).steps.find((st) => st.name === 'Anular instrumentos de data/')?.detail).toBe('ya anulados');
  });

  it('crea ext_config.ini si el coche no lo tenía', () => {
    rmSync(extConfig);
    const r = cleanDisplays(carPath, ['DISPLAY']);
    expect(r.instruments).toBe(true);
    expect(ini()).toContain('DISABLE_DIGITALINSTRUMENTSINI = 1');
  });

  it('instalar también los anula, y vuelven al quitar lo último que los sustituye', () => {
    const p = project();
    p.physicalNeedles = [{ ...createPhysicalNeedle('RPM_NEEDLE'), input: 'RPM' }];
    const r = doInstall(p);
    expect(r.steps.find((s) => s.name === 'Anular instrumentos de data/')?.ok).toBe(true);
    const text = ini();
    expect(text.match(/; ACDG BEGIN _instruments/g)).toHaveLength(1);
    // reinstalar no lo duplica
    doInstall(p);
    expect(ini().match(/; ACDG BEGIN _instruments/g)).toHaveLength(1);
    // sin display pero con nuestras agujas: siguen anulados (las de analog_instruments.ini competirían)
    uninstall(carPath, { kind: 'car' }, 'dash');
    expect(ini()).toContain('; ACDG BEGIN _instruments');
    // sin nada nuestro: vuelven
    expect(removeNeedles(carPath, { kind: 'car' }).join(' ')).toContain('instrumentos de data/');
    expect(ini()).not.toContain('ACDG BEGIN');
  });

  it('reinstalar actualiza el bloque en su sitio y limpia los archivos de la instalación anterior', () => {
    doInstall(project());
    const p2 = project();
    p2.displays[0].pages[0].elements.push(createElement('gear'));
    const r = doInstall(p2);
    expect(r.errors).toEqual([]);
    const text = ini();
    expect(text.match(/; ACDG BEGIN dash/g)).toHaveLength(1);
    expect(text.match(/; ACDG BEGIN _emissive/g)).toHaveLength(1);
    expect(text.match(/\[Material_DigitalScreen\]/g)).toHaveLength(1);
  });
});
