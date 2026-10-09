import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readKn5 } from '../src/main/services/kn5Reader';
import { box, plane, png, writeKn5 } from '../tools/kn5Writer';

/**
 * El escritor de kn5 (banco de pruebas) tiene que producir archivos que entienda nuestro propio
 * lector: si el formato cuadra aquí, el modelo se puede abrir en el asistente y en Assetto Corsa.
 */

const TMP = mkdtempSync(join(tmpdir(), 'acdg-kn5-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function build(): string {
  const screen = plane({ x: 0.3, y: 1, z: 0.75 }, 0.26, 0.13);
  // pantalla pequeña que solo usa el cuarto superior izquierdo de su textura
  const side = plane({ x: -0.05, y: 1, z: 0.75 }, 0.16, 0.08, { u0: 0, v0: 0, u1: 0.5, v1: 0.5 });
  const button = box({ x: 0.2, y: 0.9, z: 0.74 }, { x: 0.03, y: 0.03, z: 0.012 });
  const needle = plane({ x: 0, y: 0.025, z: 0 }, 0.006, 0.05);
  const file = join(TMP, 'rig.kn5');
  writeFileSync(
    file,
    writeKn5({
      root: 'rig',
      textures: [
        { name: 'main.png', data: png(64, 32, () => [10, 10, 12]) },
        { name: 'side.png', data: png(32, 32, (x, y) => [x * 8, y * 8, 40]) },
      ],
      materials: [
        { name: 'DisplayMain', texture: 'main.png', props: [{ name: 'ksEmissive', vec3: [3, 3, 3] }] },
        { name: 'DisplaySide', texture: 'side.png' },
        { name: 'RigPlastic', props: [{ name: 'ksDiffuse', value: 0.4 }] },
      ],
      nodes: [
        { kind: 'mesh', name: 'DISPLAY_MAIN', material: 'DisplayMain', ...screen },
        { kind: 'mesh', name: 'DISPLAY_SIDE', material: 'DisplaySide', ...side },
        { kind: 'mesh', name: 'BUTTON_A', material: 'RigPlastic', ...button },
        {
          kind: 'dummy',
          name: 'NEEDLE_RPM_PIVOT',
          position: { x: 0.62, y: 1.02, z: 0.76 },
          children: [{ kind: 'mesh', name: 'NEEDLE_RPM', material: 'RigPlastic', ...needle }],
        },
      ],
    }),
  );
  return file;
}

describe('escritura de kn5', () => {
  it('nuestro lector entiende lo que escribimos: mallas, materiales, texturas y jerarquía', () => {
    const info = readKn5(build());
    expect(info.version).toBe(5);
    expect(info.textures).toEqual(['main.png', 'side.png']);
    expect(info.textureSizes['main.png']).toEqual({ width: 64, height: 32 });
    expect(info.materials.map((m) => m.name)).toEqual(['DisplayMain', 'DisplaySide', 'RigPlastic']);
    expect(info.materials[0].textures).toEqual([{ slot: 'txDiffuse', texture: 'main.png' }]);
    expect(info.meshes.map((m) => m.name)).toEqual(['DISPLAY_MAIN', 'DISPLAY_SIDE', 'BUTTON_A', 'NEEDLE_RPM']);
    expect(info.meshes[0].material).toBe('DisplayMain');
    // la aguja cuelga de su eje, como las de verdad
    expect(info.nodes.find((n) => n.name === 'NEEDLE_RPM')?.path).toBe('rig/NEEDLE_RPM_PIVOT/NEEDLE_RPM');
  });

  it('las medidas y la UV que lee el asistente son las que se escribieron', () => {
    const info = readKn5(build());
    const main = info.meshes.find((m) => m.name === 'DISPLAY_MAIN')!;
    expect(main.size!.x).toBeCloseTo(0.26, 4);
    expect(main.size!.y).toBeCloseTo(0.13, 4);
    expect(main.uv).toEqual({ u0: 0, v0: 0, u1: 1, v1: 1 });
    // la pantalla lateral solo muestra un cuarto de su textura: eso es lo que detecta "Área visible"
    const side = info.meshes.find((m) => m.name === 'DISPLAY_SIDE')!;
    expect(side.uv).toEqual({ u0: 0, v0: 0, u1: 0.5, v1: 0.5 });
    // la caja de un botón tiene volumen en los tres ejes
    const btn = info.meshes.find((m) => m.name === 'BUTTON_A')!;
    expect(btn.size!.z).toBeCloseTo(0.012, 4);
    expect(btn.vertices).toBe(24);
  });
});
