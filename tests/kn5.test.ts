import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readKn5 } from '../src/main/services/kn5Reader';

const STARLET = 'C:/Program Files (x86)/Steam/steamapps/common/assettocorsa/content/cars/av_toyota_starlet_millington/toyota_starlet_millington.kn5';

describe.skipIf(!existsSync(STARLET))('kn5Reader', () => {
  it('lee mallas y materiales del Starlet', () => {
    const info = readKn5(STARLET);
    expect(info.version).toBe(5);
    const display = info.meshes.find((m) => m.name === 'Plano_014_001');
    expect(display?.material).toBe('DigitalScreen');
    expect(info.textures).toContain('DriverDisplay.dds');
    expect(info.textureSizes['DriverDisplay.dds']).toEqual({ width: 1593, height: 987 });
  });
});
