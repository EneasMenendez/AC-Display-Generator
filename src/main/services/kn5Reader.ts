import { readFileSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
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

/**
 * Recorre los vértices de una malla (stride en bytes; posición en 0, UV en 24) y devuelve el
 * rectángulo UV que ocupa y las dimensiones del volumen que envuelve la malla (en metros).
 */
function meshBounds(r: Reader, buf: Buffer, vcount: number, stride: number): Pick<Kn5Mesh, 'uv' | 'size'> {
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  let p = r.pos;
  for (let i = 0; i < vcount; i++, p += stride) {
    const x = buf.readFloatLE(p), y = buf.readFloatLE(p + 4), z = buf.readFloatLE(p + 8);
    const u = buf.readFloatLE(p + 24), v = buf.readFloatLE(p + 28);
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  r.skip(vcount * stride);
  if (vcount === 0) return { uv: null, size: null };
  return {
    uv: { u0, v0, u1, v1 },
    size: { x: x1 - x0, y: y1 - y0, z: z1 - z0 },
  };
}

/**
 * Ancho y alto a partir de la cabecera de una imagen, sin decodificarla: DDS (clásico y DX10),
 * PNG y JPEG, que son los formatos que puede llevar embebidos un kn5. null si no se reconoce.
 */
export function imageHeaderSize(d: Buffer): { width: number; height: number } | null {
  if (d.length >= 128 && d.toString('ascii', 0, 4) === 'DDS ') {
    // dwHeight en 12 y dwWidth en 16; DX10 solo añade un bloque extra detrás de la cabecera
    const height = d.readUInt32LE(12), width = d.readUInt32LE(16);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (d.length >= 24 && d.readUInt32BE(0) === 0x89504e47 && d.toString('ascii', 12, 16) === 'IHDR') {
    return { width: d.readUInt32BE(16), height: d.readUInt32BE(20) };
  }
  if (d.length >= 4 && d[0] === 0xff && d[1] === 0xd8) {
    // JPEG: recorrer los segmentos hasta el SOF, que es el que lleva las dimensiones
    for (let p = 2; p + 9 < d.length; ) {
      if (d[p] !== 0xff) { p++; continue; } // relleno entre segmentos
      const marker = d[p + 1];
      if (marker === 0xff) { p++; continue; }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { p += 2; continue; }
      if (marker === 0xda) break; // empiezan los datos comprimidos
      const len = d.readUInt16BE(p + 2);
      if (len < 2) break;
      // SOF0..SOF15 llevan alto y ancho; DHT (c4), JPG (c8) y DAC (cc) no son SOF
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: d.readUInt16BE(p + 7), height: d.readUInt16BE(p + 5) };
      }
      p += 2 + len;
    }
  }
  return null;
}

/**
 * Al reexportar un coche las texturas embebidas pueden quedar como sellos de 1x1 (PNG transparente)
 * y la textura de verdad pasa a vivir suelta en la carpeta del coche. Por debajo de este tamaño no
 * nos creemos la resolución embebida y la buscamos en disco.
 */
const PLACEHOLDER_MAX = 2;
const IMAGE_EXTS = ['.dds', '.png', '.jpg', '.jpeg'];

/**
 * Índice <nombre en minúsculas> → ruta de las texturas sueltas de un coche, por orden de
 * preferencia: assets y textures de la extensión, carpeta texture, raíz del coche y skins.
 */
function looseTextureIndex(kn5File: string): Map<string, string> {
  const dir = dirname(kn5File);
  // un kn5 secundario (copiloto, farada) vive dentro de extension/
  const carDir = basename(dir).toLowerCase() === 'extension' ? dirname(dir) : dir;
  const dirs = [join(carDir, 'extension', 'assets'), join(carDir, 'extension', 'textures'), join(carDir, 'texture'), carDir];
  try {
    const skins = join(carDir, 'skins');
    for (const e of readdirSync(skins, { withFileTypes: true })) if (e.isDirectory()) dirs.push(join(skins, e.name));
  } catch {
    /* sin skins */
  }
  const index = new Map<string, string>();
  for (const d of dirs) {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      continue; // la carpeta no existe
    }
    for (const e of entries) {
      const key = e.toLowerCase();
      // gana la primera carpeta de la lista que tenga el nombre
      if (IMAGE_EXTS.includes(extname(key)) && !index.has(key)) index.set(key, join(d, e));
    }
  }
  return index;
}

/** Busca la textura suelta por nombre exacto y, si no está, con cualquier otra extensión de imagen. */
function findLoose(index: Map<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  const hit = index.get(lower);
  if (hit) return hit;
  const base = lower.slice(0, lower.length - extname(lower).length);
  for (const ext of IMAGE_EXTS) {
    const f = index.get(base + ext);
    if (f) return f;
  }
  return undefined;
}

/** Primeros bytes de un archivo: basta para la cabecera y evita cargar un DDS de varios MB. */
function readHead(file: string, bytes = 65536): Buffer | null {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const b = Buffer.alloc(bytes);
    return b.subarray(0, readSync(fd, b, 0, bytes, 0));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
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
  const pending: string[] = []; // texturas sin resolución utilizable dentro del kn5
  const texCount = r.i32();
  for (let i = 0; i < texCount; i++) {
    r.i32(); // tipo
    const name = r.str();
    const size = r.u32();
    // las texturas van embebidas (DDS, PNG o JPEG): la resolución sale de la cabecera
    const dim = imageHeaderSize(buf.subarray(r.pos, r.pos + size));
    if (dim && dim.width > PLACEHOLDER_MAX && dim.height > PLACEHOLDER_MAX) textureSizes[name] = dim;
    else pending.push(name);
    r.skip(size);
    textures.push(name);
  }
  // kn5 reexportado sin texturas: las que quedaron como sello de 1x1 se resuelven desde la carpeta
  if (pending.length > 0) {
    const index = looseTextureIndex(file);
    for (const name of pending) {
      const loose = findLoose(index, name);
      const head = loose ? readHead(loose) : null;
      const dim = head ? imageHeaderSize(head) : null;
      if (dim) textureSizes[name] = dim;
    }
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
  const nodes: Kn5Info['nodes'] = [];
  const readNode = (path: string): void => {
    const type = r.i32();
    const name = r.str();
    const children = r.i32();
    r.u8(); // activo
    const here = path ? `${path}/${name}` : name;
    nodes.push({ name, path: here, kind: type === 1 ? 'dummy' : 'mesh', children });
    if (type === 1) {
      r.skip(64); // matriz 4x4
    } else if (type === 2) {
      r.u8(); // castShadows
      r.u8(); // isVisible
      r.u8(); // isTransparent
      const vcount = r.u32();
      const b = meshBounds(r, buf, vcount, 44); // posición(12) normal(12) uv(8) tangente(12)
      const icount = r.u32();
      r.skip(icount * 2);
      const matId = r.i32();
      r.i32(); // layer
      r.f32(); // lodIn
      r.f32(); // lodOut
      r.skip(16); // bounding sphere
      r.u8(); // isRenderable
      meshes.push({ name, material: materials[matId]?.name ?? `#${matId}`, vertices: vcount, path: here, ...b });
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
      const b = meshBounds(r, buf, vcount, 76); // + pesos(16) e índices(16) de huesos
      const icount = r.u32();
      r.skip(icount * 2);
      const matId = r.i32();
      r.i32(); // layer
      r.f32();
      r.f32();
      meshes.push({ name, material: materials[matId]?.name ?? `#${matId}`, vertices: vcount, path: here, ...b });
    } else {
      throw new Error(`Tipo de nodo desconocido (${type}) en ${here}`);
    }
    for (let c = 0; c < children; c++) readNode(here);
  };
  readNode('');
  return { version, textures, textureSizes, materials, meshes, nodes };
}
