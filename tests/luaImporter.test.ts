import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { importLuaDisplay } from '../src/main/services/luaImporter';

const STARLET = 'C:/Program Files (x86)/Steam/steamapps/common/assettocorsa/content/cars/av_toyota_starlet_millington/extension/starletDisplay.lua';
const CLIO = 'C:/Program Files (x86)/Steam/steamapps/common/assettocorsa/content/cars/av_renault_clio_rally5_ph2/extension/display.lua';

describe.skipIf(!existsSync(STARLET))('luaImporter', () => {
  it('importa el display del Starlet con sus textos, barras, marcha y fondo', async () => {
    const r = await importLuaDisplay(STARLET, 1593, 987);
    expect(r.background?.toLowerCase().endsWith('driverdisplay.dds')).toBe(true);
    const types = r.elements.map((e) => e.type);
    expect(types.filter((t) => t === 'bar').length).toBe(1);
    expect(types).toContain('gear');
    const speed = r.elements.find((e) => e.type === 'text' && e.binding.variable === 'speed');
    expect(speed).toBeTruthy();
    const oil = r.elements.find((e) => e.type === 'text' && e.binding.variable === 'oil_pressure');
    expect(oil?.type === 'text' && oil.binding.decimals).toBe(1);
    const throttle = r.elements.find((e) => e.type === 'bar' && e.config.variable === 'throttle');
    expect(throttle?.type === 'bar' && throttle.config.max).toBe(1);
    expect(throttle?.width).toBe(340);
    const rpm = r.elements.find((e) => e.type === 'rpm_bar');
    expect(rpm?.width).toBe(1350);
    expect(rpm?.type === 'rpm_bar' && rpm.config.redline).toBe('95%');
  }, 30000);
  it.skipIf(!existsSync(CLIO))('importa el display del Clio (display.text + iconos condicionales)', async () => {
    const r = await importLuaDisplay(CLIO, 1024, 1024);
    expect(r.calls).toBeGreaterThan(5);
    expect(r.elements.length).toBeGreaterThan(5);
  }, 30000);
});
