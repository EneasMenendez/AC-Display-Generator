import { readFileSync } from 'node:fs';
import type { Kn5Info, Kn5Material, Kn5Mesh } from '@shared/types';
export type { Kn5Info, Kn5Material, Kn5Mesh };

/**
 * Lector de .kn5 (modelo 3D de AC). Solo extrae lo que necesita el modo creador:
 * nombres de mallas, material de cada malla, materiales con sus texturas y lista de texturas.
 * No modifica nunca el archivo.
 */

class Reader {
  pos = 0;
  constructor(private buf: Buffer) {}
  u8(): number {
    return this.buf[this.pos++];
  }
  i32(): number {
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  u32(): number {
    const v = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  f32(): number {
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  str(): string {
    const len = this.u32();
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }
  skip(n: number): void {
    this.pos += n;
  }
  get eof(): boolean {
    return this.pos >= this.buf.length;
  }
}

export function readKn5(file: string): Kn5Info {
  const buf = readFileSync(file);
  const r = new Reader(buf);
  const magic = buf.toString('ascii', 0, 6);
  if (magic !== 'sc6969') throw new Error('No es un archivo kn5 válido (cabecera incorrecta).');
  r.skip(6);
  const version = r.u32();
  if (version > 5) r.u32(); // campo extra en versiones nuevas

  const textures: string[] = [];
  const textureSizes: Record<string, { width: number; height: number }> = {};
  const texCount = r.i32();
  for (let i = 0; i < texCount; i++) {
    r.i32(); // tipo
    const name = r.str();
    const size = r.u32();
    // las texturas van embebidas: si es DDS se lee la resolución de la cabecera
    if (size >= 128 && buf.toString('ascii', r.pos, r.pos + 4) === 'DDS ') {
      textureSizes[name] = { width: buf.readUInt32LE(r.pos + 16), height: buf.readUInt32LE(r.pos + 12) };
    }
    r.skip(size);
    textures.push(name);
  }

  const materials: Kn5Material[] = [];
  const matCount = r.i32();
  for (let i = 0; i < matCount; i++) {
    const name = r.str();
    const shader = r.str();
    r.u8(); // blend mode
    r.u8(); // alpha tested
    if (version > 4) r.i32(); // depth mode
    const propCount = r.i32();
    for (let p = 0; p < propCount; p++) {
      r.str(); // nombre de propiedad
      r.f32(); // valor A
      r.skip(36); // vec2, vec3, vec4
    }
    const texSlots = r.i32();
    const texs: Kn5Material['textures'] = [];
    for (let t = 0; t < texSlots; t++) {
      const slot = r.str();
      r.i32(); // índice de slot
      const texture = r.str();
      texs.push({ slot, texture });
    }
    materials.push({ name, shader, textures: texs });
  }

  const meshes: Kn5Mesh[] = [];
  const readNode = (path: string): void => {
    const type = r.i32();
    const name = r.str();
    const children = r.i32();
    r.u8(); // activo
    const here = path ? `${path}/${name}` : name;
    if (type === 1) {
      r.skip(64); // matriz 4x4
    } else if (type === 2) {
      r.u8(); // castShadows
      r.u8(); // isVisible
      r.u8(); // isTransparent
      const vcount = r.u32();
      r.skip(vcount * 44);
      const icount = r.u32();
      r.skip(icount * 2);
      const matId = r.i32();
      r.i32(); // layer
      r.f32(); // lodIn
      r.f32(); // lodOut
      r.skip(16); // bounding sphere
      r.u8(); // isRenderable
      meshes.push({ name, material: materials[matId]?.name ?? `#${matId}`, vertices: vcount, path: here });
    } else if (type === 3) {
      r.u8();
      r.u8();
      r.u8();
      const boneCount = r.i32();
      for (let b = 0; b < boneCount; b++) {
        r.str();
        r.skip(64);
      }
      const vcount = r.u32();
      r.skip(vcount * 76);
      const icount = r.u32();
      r.skip(icount * 2);
      const matId = r.i32();
      r.i32(); // layer
      r.f32();
      r.f32();
      meshes.push({ name, material: materials[matId]?.name ?? `#${matId}`, vertices: vcount, path: here });
    } else {
      throw new Error(`Tipo de nodo desconocido (${type}) en ${here}`);
    }
    for (let c = 0; c < children; c++) readNode(here);
  };
  readNode('');
  return { version, textures, textureSizes, materials, meshes };
}
