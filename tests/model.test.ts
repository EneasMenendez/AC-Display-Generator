import { describe, it, expect } from 'vitest';
import { migrateProject, PROJECT_FORMAT_VERSION } from '../src/shared/model';

describe('migración de proyectos', () => {
  it('convierte un proyecto v1 (un display en la raíz) al formato multi-display', () => {
    const v1 = {
      format_version: 1,
      app_version: '0.1.0',
      name: 'Viejo',
      profile: { id: 'x', version: 2 },
      car_id: 'car',
      display_id: 'driver_display',
      canvas: { width: 100, height: 50 },
      background: { file: null, locked: true, color: '#000000' },
      settings: { units: 'auto', brightness: 1, nightBrightness: 0.6, nightMode: 'off', grid: 8, snap: true, snapToElements: true, showCoordinates: true },
      pages: [{ id: 'main', name: 'Principal', elements: [] }],
      fonts: {},
    };
    const p = migrateProject(v1);
    expect(p.format_version).toBe(PROJECT_FORMAT_VERSION);
    expect(p.displays).toHaveLength(1);
    expect(p.displays[0].display_id).toBe('driver_display');
    expect(p.displays[0].settings.pageSwitch.input).toBe('none');
  });
  it('rechaza formatos futuros', () => {
    expect(() => migrateProject({ format_version: 99 })).toThrow();
  });
});
