import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageHeaderSize, readKn5 } from '../src/main/services/kn5Reader';

const STARLET = 'C:/Program Files (x86)/Steam/steamapps/common/assettocorsa/content/cars/av_toyota_starlet_millington/toyota_starlet_millington.kn5';

// ---------- cabeceras de imagen de juguete ----------

/** DDS mínimo (solo cabecera); fourCC 'DX10' añade el bloque extra que lleva ese formato. */
function dds(width: number, height: number, fourCC = 'DXT5'): Buffer {
  const b = Buffer.alloc(fourCC === 'DX10' ? 148 : 128);
  b.write('DDS ', 0, 'ascii');
  b.writeUInt32LE(124, 4);
  b.writeUInt32LE(height, 12);
  b.writeUInt32LE(width, 16);
  b.write(fourCC, 84, 'ascii');
  if (fourCC === 'DX10') b.writeUInt32LE(77, 128); // DXGI_FORMAT_BC3_UNORM
  return b;
}

/** PNG mínimo: firma + IHDR (el CRC da igual, solo se lee la cabecera). */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  b[24] = 8;
  b[25] = 6;
  return b;
}

/** JPEG mínimo: SOI + APP0 + SOF0, para comprobar que se recorren los segmentos. */
function jpg(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  app0.write('JFIF\0', 4, 'ascii');
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(9, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

/** El sello de 1x1 transparente con el que quedan las texturas al reexportar el coche sin ellas. */
const STUB_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da636460f85f0f0002870180eb47ba920000000049454e44ae426082',
  'hex',
);

// ---------- kn5 de juguete ----------

function str(s: string): Buffer {
  const body = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([len, body]);
}
function i32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
}

/** kn5 v5 con las texturas dadas, sin materiales y con un único nodo dummy de raíz. */
function kn5(textures: { name: string; data: Buffer }[]): Buffer {
  const parts = [Buffer.from('sc6969', 'ascii'), i32(5), i32(textures.length)];
  for (const t of textures) parts.push(i32(1), str(t.name), i32(t.data.length), t.data);
  parts.push(i32(0)); // materiales
  parts.push(i32(1), str('root'), i32(0), Buffer.from([1]), Buffer.alloc(64)); // nodo dummy
  return Buffer.concat(parts);
}

describe('imageHeaderSize', () => {
  it('lee DDS clásico, DDS DX10, PNG y JPEG', () => {
    expect(imageHeaderSize(dds(1593, 987))).toEqual({ width: 1593, height: 987 });
    expect(imageHeaderSize(dds(512, 256, 'DX10'))).toEqual({ width: 512, height: 256 });
    expect(imageHeaderSize(png(800, 480))).toEqual({ width: 800, height: 480 });
    expect(imageHeaderSize(jpg(640, 360))).toEqual({ width: 640, height: 360 });
    expect(imageHeaderSize(STUB_1X1)).toEqual({ width: 1, height: 1 });
  });

  it('devuelve null si el formato no se reconoce o está truncado', () => {
    expect(imageHeaderSize(Buffer.alloc(0))).toBeNull();
    expect(imageHeaderSize(Buffer.from('no soy una imagen'))).toBeNull();
    expect(imageHeaderSize(dds(1593, 987).subarray(0, 64))).toBeNull();
  });
});

describe('readKn5: resolución de texturas', () => {
  let car: string;
  beforeAll(() => {
    car = mkdtempSync(join(tmpdir(), 'kn5-'));
    mkdirSync(join(car, 'extension', 'assets'), { recursive: true });
    mkdirSync(join(car, 'skins', 'Base'), { recursive: true });
  });
  afterAll(() => rmSync(car, { recursive: true, force: true }));

  it('lee el tamaño de las texturas embebidas, sean DDS, PNG o JPEG', () => {
    const f = join(car, 'embebidas.kn5');
    writeFileSync(f, kn5([
      { name: 'A.dds', data: dds(1593, 987) },
      { name: 'B.dds', data: dds(256, 128, 'DX10') },
      { name: 'C.png', data: png(800, 480) },
      { name: 'D.jpg', data: jpg(640, 360) },
    ]));
    const info = readKn5(f);
    expect(info.textures).toEqual(['A.dds', 'B.dds', 'C.png', 'D.jpg']);
    expect(info.textureSizes).toEqual({
      'A.dds': { width: 1593, height: 987 },
      'B.dds': { width: 256, height: 128 },
      'C.png': { width: 800, height: 480 },
      'D.jpg': { width: 640, height: 360 },
    });
  });

  it('resuelve desde la carpeta del coche las texturas que quedaron como sello de 1x1', () => {
    writeFileSync(join(car, 'extension', 'assets', 'DriverDisplay.dds'), dds(1593, 987));
    writeFileSync(join(car, 'skins', 'Base', 'EXT_Body.dds'), dds(2048, 2048));
    writeFileSync(join(car, 'Logo.png'), png(512, 128)); // la textura se llama .dds pero en disco es .png
    const f = join(car, 'vaciadas.kn5');
    writeFileSync(f, kn5([
      { name: 'DriverDisplay.dds', data: STUB_1X1 },
      { name: 'EXT_Body.dds', data: STUB_1X1 },
      { name: 'logo.dds', data: STUB_1X1 },
      { name: 'Perdida.dds', data: STUB_1X1 },
    ]));
    const info = readKn5(f);
    expect(info.textureSizes['DriverDisplay.dds']).toEqual({ width: 1593, height: 987 });
    expect(info.textureSizes['EXT_Body.dds']).toEqual({ width: 2048, height: 2048 });
    expect(info.textureSizes['logo.dds']).toEqual({ width: 512, height: 128 });
    expect(info.textureSizes['Perdida.dds']).toBeUndefined(); // no está en ningún sitio
  });

  it('la textura embebida manda sobre la suelta cuando el kn5 sí la trae', () => {
    writeFileSync(join(car, 'extension', 'assets', 'Panel.dds'), dds(64, 64));
    const f = join(car, 'completas.kn5');
    writeFileSync(f, kn5([{ name: 'Panel.dds', data: dds(1024, 512) }]));
    expect(readKn5(f).textureSizes['Panel.dds']).toEqual({ width: 1024, height: 512 });
  });
});

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
