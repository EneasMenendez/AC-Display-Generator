import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { scanExtension } from '../src/main/services/displayScanner';
import { parseIni, disableSection, enableAllSections, listDisabledSections } from '../src/shared/ini';

const CARS = 'C:/Program Files (x86)/Steam/steamapps/common/assettocorsa/content/cars';

describe('ini', () => {
  it('parsea secciones, includes y comentarios', () => {
    const s = parseIni('[INCLUDE: common/x.ini]\n[SCRIPTABLE_DISPLAY_...]\nMESHES = a, b ; comentario\nSCRIPT=display.lua\n\n[OTRA]\nX=1\n');
    expect(s.map((x) => x.name)).toEqual(['INCLUDE: common/x.ini', 'SCRIPTABLE_DISPLAY_...', 'OTRA']);
    expect(s[1].values.MESHES).toBe('a, b');
    expect(s[1].end).toBe(3);
  });
  it('desactiva y reactiva secciones', () => {
    const txt = '[A]\nX=1\n\n[SCRIPTABLE_DISPLAY_1]\nMESHES=m\nSCRIPT=d.lua\n\n[B]\nY=2\n';
    const off = disableSection(txt, 'SCRIPTABLE_DISPLAY_1');
    expect(off).toContain(';ACDG-OFF; [SCRIPTABLE_DISPLAY_1]');
    expect(off).toContain(';ACDG-OFF; SCRIPT=d.lua');
    expect(off).toContain('\n[B]\nY=2');
    expect(listDisabledSections(off)).toEqual(['SCRIPTABLE_DISPLAY_1']);
    expect(enableAllSections(off)).toBe(txt);
  });
});

describe.skipIf(!existsSync(CARS))('displayScanner', () => {
  it('detecta el display del Starlet (ini no incluido) con sus pistas', () => {
    const r = scanExtension(`${CARS}/av_toyota_starlet_millington`);
    expect(r.hasExtConfig).toBe(true);
    const d = r.displays.find((x) => x.iniRelative === 'starletDisplay.ini');
    expect(d).toBeTruthy();
    expect(d!.meshes).toEqual(['Plano_014_001']);
    expect(d!.includedInExtConfig).toBe(true);
    expect(d!.scriptExists).toBe(true);
    expect(d!.scriptValid).toBe(true);
    expect(d!.hints.width).toBe(1593);
    expect(d!.hints.height).toBe(987);
    expect(d!.hints.images.some((i) => i.endsWith('DriverDisplay.dds'))).toBe(true);
  });
  it('detecta el display del Clio incluido en ext_config.ini', () => {
    const r = scanExtension(`${CARS}/av_renault_clio_rally5_ph2`);
    const d = r.displays.find((x) => x.meshes.includes('int_display'));
    expect(d?.includedInExtConfig).toBe(true);
    expect(d?.scriptRelative).toBe('display.lua');
  });
});
