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
