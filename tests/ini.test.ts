import { describe, it, expect } from 'vitest';
import { disableSection, enableAllSections, enableSectionsMatching, listDisabledSections, parseIni } from '../src/shared/ini';

/** Lectura y desactivación reversible de secciones de ext_config.ini (lo que toca el instalador). */

const INI = `[HEADER]
VERSION=1

[SCRIPTABLE_DISPLAY_0]
MESHES = DISPLAY

SCRIPT = original.lua  ; comentario al final

[ANALOG_INDICATOR_0]
INPUT = RPM
OBJECT_NAME = RPM_NEEDLE
`;

describe('ini', () => {
  it('lee secciones, claves en mayúsculas y comentarios', () => {
    const secs = parseIni(INI);
    expect(secs.map((s) => s.name)).toEqual(['HEADER', 'SCRIPTABLE_DISPLAY_0', 'ANALOG_INDICATOR_0']);
    expect(secs[1].values.SCRIPT).toBe('original.lua');
    expect(secs[1].values.MESHES).toBe('DISPLAY');
  });

  it('desactivar y reactivar deja el archivo igual, aunque la sección tenga líneas en blanco', () => {
    const off = disableSection(INI, 'SCRIPTABLE_DISPLAY_0');
    expect(listDisabledSections(off)).toEqual(['SCRIPTABLE_DISPLAY_0']);
    expect(off).toContain(';ACDG-OFF; SCRIPT = original.lua');
    // la sección siguiente no se toca
    expect(off).toContain('\n[ANALOG_INDICATOR_0]');
    expect(enableAllSections(off)).toBe(INI);
  });

  it('reactivar por patrón solo toca las secciones que lo cumplen (y no se corta en las líneas en blanco)', () => {
    let txt = disableSection(INI, 'SCRIPTABLE_DISPLAY_0');
    txt = disableSection(txt, 'ANALOG_INDICATOR_0');
    expect(listDisabledSections(txt).sort()).toEqual(['ANALOG_INDICATOR_0', 'SCRIPTABLE_DISPLAY_0']);

    const onlyDisplays = enableSectionsMatching(txt, /^(?!ANALOG_INDICATOR)/i);
    expect(listDisabledSections(onlyDisplays)).toEqual(['ANALOG_INDICATOR_0']);
    // el display vuelve entero: también lo que había tras la línea en blanco
    expect(onlyDisplays).toContain('MESHES = DISPLAY');
    expect(onlyDisplays).toContain('SCRIPT = original.lua');
    expect(onlyDisplays).not.toContain(';ACDG-OFF; SCRIPT');

    expect(enableSectionsMatching(onlyDisplays, /^ANALOG_INDICATOR/i)).toBe(INI);
  });
});
