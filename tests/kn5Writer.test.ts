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

describe('orientación de las caras', () => {
  /**
   * Normal que implica el orden de los vértices. El criterio es el que ya se vio funcionar en el
   * juego: el producto vectorial del orden coincide con la normal declarada de la cara.
   */
  function windingNormal(v: { pos: { x: number; y: number; z: number } }[], i: number[]) {
    const a = v[i[0]].pos;
    const b = v[i[1]].pos;
    const c = v[i[2]].pos;
    const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const w = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    return { x: u.y * w.z - u.z * w.y, y: u.z * w.x - u.x * w.z, z: u.x * w.y - u.y * w.x };
  }

  it('un plano mira al conductor y su textura se lee del derecho', () => {
    const p = plane({ x: 0, y: 1, z: 0.7 }, 0.2, 0.1);
    // el orden de los vértices tiene que corresponder a la cara que mira hacia -Z (al conductor)
    expect(windingNormal(p.vertices, p.indices).z).toBeLessThan(0);
    expect(p.vertices.every((v) => v.normal.z === -1)).toBe(true);
    // en Assetto Corsa +X es el lado izquierdo del coche: ahí va el borde izquierdo de la textura
    const derechaDelConductor = p.vertices.filter((v) => v.pos.x < 0);
    const izquierdaDelConductor = p.vertices.filter((v) => v.pos.x > 0);
    expect(izquierdaDelConductor.every((v) => v.uv[0] === 0)).toBe(true);
    expect(derechaDelConductor.every((v) => v.uv[0] === 1)).toBe(true);
    // arriba es v = 0
    expect(p.vertices.filter((v) => v.pos.y > 1).every((v) => v.uv[1] === 0)).toBe(true);
  });

  it('las seis caras de una caja miran hacia fuera', () => {
    const b = box({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0.1, z: 0.1 });
    for (let f = 0; f < 6; f++) {
      const tri = b.indices.slice(f * 6, f * 6 + 3);
      const n = windingNormal(b.vertices, tri);
      const declared = b.vertices[tri[0]].normal;
      // el orden de los vértices y la normal declarada tienen que apuntar al mismo lado
      const dot = n.x * declared.x + n.y * declared.y + n.z * declared.z;
      expect(dot, `cara ${f}`).toBeGreaterThan(0);
    }
  });
});
