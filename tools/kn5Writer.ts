import { deflateSync } from 'node:zlib';

/**
 * Escritor de .kn5 (versión 5), el formato de modelo de Assetto Corsa. Es el espejo del lector de
 * src/main/services/kn5Reader.ts: cabecera, texturas embebidas, materiales y árbol de nodos.
 *
 * Solo genera geometría sencilla (planos y cajas) con vértices de 44 bytes
 * (posición 12 + normal 12 + UV 8 + tangente 12), que es lo que hace falta para montar un banco de
 * pruebas: pantallas, botones y agujas sueltas.
 *
 * Ejes de Assetto Corsa: Y arriba, Z hacia delante y **+X hacia el lado izquierdo del coche**. Es
 * decir, mirando al frente desde el asiento, +X queda a la izquierda de la pantalla: por eso los
 * planos mapean la U al revés que las coordenadas (el vértice de mayor X recibe u0), que es lo que
 * hace que una textura con texto se lea del derecho desde el puesto de conducción.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Kn5Texture {
  name: string;
  data: Buffer;
}

export interface Kn5MaterialDef {
  name: string;
  shader?: string;
  /** propiedades del shader (ksDiffuse, ksEmissive…) */
  props?: { name: string; value?: number; vec3?: [number, number, number] }[];
  /** textura del slot txDiffuse */
  texture?: string;
}

export interface Kn5Vertex {
  pos: Vec3;
  normal: Vec3;
  uv: [number, number];
}

export type Kn5Node =
  | { kind: 'dummy'; name: string; position?: Vec3; children?: Kn5Node[] }
  | { kind: 'mesh'; name: string; material: string; vertices: Kn5Vertex[]; indices: number[] };

/* ---------- utilidades binarias ---------- */

class Writer {
  private parts: Buffer[] = [];
  push(b: Buffer): void {
    this.parts.push(b);
  }
  u8(v: number): void {
    const b = Buffer.alloc(1);
    b.writeUInt8(v);
    this.push(b);
  }
  i32(v: number): void {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v);
    this.push(b);
  }
  u32(v: number): void {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v);
    this.push(b);
  }
  f32(v: number): void {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v);
    this.push(b);
  }
  str(s: string): void {
    const bytes = Buffer.from(s, 'utf8');
    this.u32(bytes.length);
    this.push(bytes);
  }
  zeros(n: number): void {
    this.push(Buffer.alloc(n));
  }
  done(): Buffer {
    return Buffer.concat(this.parts);
  }
}

/* ---------- geometría ---------- */

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/**
 * Plano rectangular mirando hacia el conductor (-Z), con el centro en `center`. `uv` permite mapear
 * solo una parte de la textura, que es como se comportan muchas pantallas reales.
 */
export function plane(
  center: Vec3,
  width: number,
  height: number,
  uv: { u0: number; v0: number; u1: number; v1: number } = { u0: 0, v0: 0, u1: 1, v1: 1 },
): { vertices: Kn5Vertex[]; indices: number[] } {
  const hw = width / 2;
  const hh = height / 2;
  const n = v3(0, 0, -1);
  // El orden de los vértices no se toca (marca hacia dónde mira la cara); lo que se invierte es la
  // U: la esquina de mayor X es la que el conductor ve a su izquierda, así que ahí va u0.
  const vertices: Kn5Vertex[] = [
    { pos: v3(center.x - hw, center.y + hh, center.z), normal: n, uv: [uv.u1, uv.v0] },
    { pos: v3(center.x + hw, center.y + hh, center.z), normal: n, uv: [uv.u0, uv.v0] },
    { pos: v3(center.x + hw, center.y - hh, center.z), normal: n, uv: [uv.u0, uv.v1] },
    { pos: v3(center.x - hw, center.y - hh, center.z), normal: n, uv: [uv.u1, uv.v1] },
  ];
  return { vertices, indices: [0, 1, 2, 0, 2, 3] };
}

/** Caja con las seis caras; cada cara usa toda la UV salvo que se indique otra cosa. */
export function box(
  center: Vec3,
  size: Vec3,
  uv: { u0: number; v0: number; u1: number; v1: number } = { u0: 0, v0: 0, u1: 1, v1: 1 },
): { vertices: Kn5Vertex[]; indices: number[] } {
  const { x: cx, y: cy, z: cz } = center;
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  const faces: { n: Vec3; corners: Vec3[] }[] = [
    { n: v3(0, 0, -1), corners: [v3(-hx, hy, -hz), v3(hx, hy, -hz), v3(hx, -hy, -hz), v3(-hx, -hy, -hz)] },
    { n: v3(0, 0, 1), corners: [v3(hx, hy, hz), v3(-hx, hy, hz), v3(-hx, -hy, hz), v3(hx, -hy, hz)] },
    { n: v3(0, 1, 0), corners: [v3(-hx, hy, hz), v3(hx, hy, hz), v3(hx, hy, -hz), v3(-hx, hy, -hz)] },
    { n: v3(0, -1, 0), corners: [v3(-hx, -hy, -hz), v3(hx, -hy, -hz), v3(hx, -hy, hz), v3(-hx, -hy, hz)] },
    { n: v3(-1, 0, 0), corners: [v3(-hx, hy, hz), v3(-hx, hy, -hz), v3(-hx, -hy, -hz), v3(-hx, -hy, hz)] },
    { n: v3(1, 0, 0), corners: [v3(hx, hy, -hz), v3(hx, hy, hz), v3(hx, -hy, hz), v3(hx, -hy, -hz)] },
  ];
  const vertices: Kn5Vertex[] = [];
  const indices: number[] = [];
  for (const f of faces) {
    const base = vertices.length;
    // igual que en el plano: la U va de +X a -X para que las texturas se lean del derecho
    const uvs: [number, number][] = [
      [uv.u1, uv.v0],
      [uv.u0, uv.v0],
      [uv.u0, uv.v1],
      [uv.u1, uv.v1],
    ];
    f.corners.forEach((c, i) => vertices.push({ pos: v3(cx + c.x, cy + c.y, cz + c.z), normal: f.n, uv: uvs[i] }));
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { vertices, indices };
}

/* ---------- PNG mínimo (para las texturas embebidas) ---------- */

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** PNG RGB sin transparencia; `pixel(x, y)` devuelve el color de cada píxel. */
export function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filtro "none"
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // color RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- escritura del kn5 ---------- */

function writeMaterial(w: Writer, m: Kn5MaterialDef): void {
  w.str(m.name);
  w.str(m.shader ?? 'ksPerPixel');
  w.u8(0); // blend: opaco
  w.u8(0); // alpha testing
  w.i32(0); // depth mode: normal
  const props = m.props ?? [];
  w.i32(props.length);
  for (const p of props) {
    w.str(p.name);
    w.f32(p.value ?? 0);
    // vec2 (8) + vec3 (12) + vec4 (16): solo se usa vec3 para propiedades de color
    w.zeros(8);
    if (p.vec3) {
      w.f32(p.vec3[0]);
      w.f32(p.vec3[1]);
      w.f32(p.vec3[2]);
    } else {
      w.zeros(12);
    }
    w.zeros(16);
  }
  const slots = m.texture ? [{ slot: 'txDiffuse', texture: m.texture }] : [];
  w.i32(slots.length);
  slots.forEach((s, i) => {
    w.str(s.slot);
    w.i32(i);
    w.str(s.texture);
  });
}

function writeNode(w: Writer, node: Kn5Node, materialIndex: Map<string, number>): void {
  if (node.kind === 'dummy') {
    const children = node.children ?? [];
    w.i32(1);
    w.str(node.name);
    w.i32(children.length);
    w.u8(1); // activo
    // matriz 4x4 (fila a fila) con la traslación en la última fila, como en Direct3D
    const p = node.position ?? v3(0, 0, 0);
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p.x, p.y, p.z, 1];
    for (const v of m) w.f32(v);
    for (const c of children) writeNode(w, c, materialIndex);
    return;
  }

  w.i32(2);
  w.str(node.name);
  w.i32(0); // una malla no lleva hijos
  w.u8(1); // activo
  w.u8(1); // proyecta sombras
  w.u8(1); // visible
  w.u8(0); // transparente
  w.u32(node.vertices.length);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const v of node.vertices) {
    w.f32(v.pos.x);
    w.f32(v.pos.y);
    w.f32(v.pos.z);
    w.f32(v.normal.x);
    w.f32(v.normal.y);
    w.f32(v.normal.z);
    w.f32(v.uv[0]);
    w.f32(v.uv[1]);
    // tangente: suficiente para shaders sin normal map
    w.f32(1);
    w.f32(0);
    w.f32(0);
    cx += v.pos.x;
    cy += v.pos.y;
    cz += v.pos.z;
  }
  const n = Math.max(1, node.vertices.length);
  cx /= n;
  cy /= n;
  cz /= n;
  let radius = 0;
  for (const v of node.vertices) {
    radius = Math.max(radius, Math.hypot(v.pos.x - cx, v.pos.y - cy, v.pos.z - cz));
  }
  w.u32(node.indices.length);
  for (const i of node.indices) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(i);
    w.push(b);
  }
  w.i32(materialIndex.get(node.material) ?? 0);
  w.i32(0); // layer
  w.f32(0); // lodIn
  w.f32(1e9); // lodOut
  w.f32(cx);
  w.f32(cy);
  w.f32(cz);
  w.f32(radius);
  w.u8(1); // se dibuja
}

export interface Kn5Scene {
  root: string;
  textures: Kn5Texture[];
  materials: Kn5MaterialDef[];
  nodes: Kn5Node[];
}

/** Genera el contenido binario de un .kn5 a partir de la escena. */
export function writeKn5(scene: Kn5Scene): Buffer {
  const w = new Writer();
  w.push(Buffer.from('sc6969', 'ascii'));
  w.u32(5);

  w.i32(scene.textures.length);
  for (const t of scene.textures) {
    w.i32(1); // tipo: textura embebida
    w.str(t.name);
    w.u32(t.data.length);
    w.push(t.data);
  }

  const materialIndex = new Map<string, number>();
  w.i32(scene.materials.length);
  scene.materials.forEach((m, i) => {
    materialIndex.set(m.name, i);
    writeMaterial(w, m);
  });

  // nodo raíz: un dummy con todo lo demás colgando
  writeNode(w, { kind: 'dummy', name: scene.root, children: scene.nodes }, materialIndex);
  return w.done();
}
