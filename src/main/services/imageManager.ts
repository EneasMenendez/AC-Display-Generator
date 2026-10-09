import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { nativeImage } from 'electron';
import type { ImageInfo } from '@shared/types';
export type { ImageInfo };

/**
 * Image Manager (sección 6) + DDS Encoder (sección 20).
 * PNG/JPG se decodifican con nativeImage (Chromium). DDS: lector de cabecera + decodificador BC1/BC3
 * para previsualizar, y codificador BC3 con mipmaps para exportar.
 */

export function readImageInfo(file: string): ImageInfo {
  const ext = extname(file).toLowerCase();
  const buf = readFileSync(file);
  if (ext === '.dds' || buf.toString('ascii', 0, 4) === 'DDS ') {
    try {
      const dds = decodeDds(buf);
      const png = ddsToPng(buf);
      return { file, format: 'dds', width: dds.width, height: dds.height, hasAlpha: dds.hasAlpha, ddsFormat: dds.format, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
    } catch (e) {
      const h = readDdsHeader(buf);
      return { file, format: 'dds', width: h?.width ?? 0, height: h?.height ?? 0, hasAlpha: true, ddsFormat: h?.fourCC, dataUrl: null, error: (e as Error).message };
    }
  }
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return { file, format: 'unknown', width: 0, height: 0, hasAlpha: false, dataUrl: null, error: 'Formato de imagen no reconocido.' };
  const { width, height } = img.getSize();
  const format = ext === '.png' ? 'png' : ext === '.jpg' || ext === '.jpeg' ? 'jpg' : 'unknown';
  return { file, format, width, height, hasAlpha: format === 'png' ? pngHasAlpha(buf) : false, dataUrl: img.toDataURL() };
}

/** DDS (BC1/BC3/RGBA8) → PNG para mostrarlo en el editor. */
export function ddsToPng(buf: Buffer): Buffer {
  const dds = decodeDds(buf);
  return nativeImage.createFromBitmap(rgbaToBgra(dds.rgba), { width: dds.width, height: dds.height }).toPNG();
}

function pngHasAlpha(buf: Buffer): boolean {
  // IHDR: color type en el byte 25 (4 = gris+alfa, 6 = RGBA); también tRNS
  if (buf.length < 26) return false;
  const colorType = buf[25];
  if (colorType === 4 || colorType === 6) return true;
  return buf.includes('tRNS', 8, 'ascii');
}

function rgbaToBgra(rgba: Uint8Array): Buffer {
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 2];
    out[i + 1] = rgba[i + 1];
    out[i + 2] = rgba[i];
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

/* ---------- DDS ---------- */

interface DdsHeader {
  width: number;
  height: number;
  mipCount: number;
  fourCC: string;
  rgbBitCount: number;
  flags: number;
  pfFlags: number;
  dataOffset: number;
}

function readDdsHeader(buf: Buffer): DdsHeader | null {
  if (buf.length < 128 || buf.toString('ascii', 0, 4) !== 'DDS ') return null;
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const mipCount = Math.max(1, buf.readUInt32LE(28));
  const pfFlags = buf.readUInt32LE(80);
  const fourCC = buf.toString('ascii', 84, 88);
  const rgbBitCount = buf.readUInt32LE(88);
  let dataOffset = 128;
  if (fourCC === 'DX10') dataOffset += 20;
  return { width, height, mipCount, fourCC, rgbBitCount, flags: buf.readUInt32LE(8), pfFlags, dataOffset };
}

export function decodeDds(buf: Buffer): { width: number; height: number; rgba: Uint8Array; hasAlpha: boolean; format: string } {
  const h = readDdsHeader(buf);
  if (!h) throw new Error('Cabecera DDS inválida.');
  const { width, height } = h;
  const rgba = new Uint8Array(width * height * 4);
  const isDX10 = h.fourCC === 'DX10';
  const dxgi = isDX10 ? buf.readUInt32LE(128) : 0;
  const fmt = isDX10 ? (dxgi === 71 || dxgi === 72 ? 'DXT1' : dxgi === 77 || dxgi === 78 ? 'DXT5' : `DXGI_${dxgi}`) : h.fourCC;
  if (fmt === 'DXT1' || fmt === 'DXT5') {
    decodeBC(buf, h.dataOffset, width, height, rgba, fmt === 'DXT5');
    return { width, height, rgba, hasAlpha: fmt === 'DXT5', format: fmt };
  }
  if ((h.pfFlags & 0x40) && h.rgbBitCount === 32) {
    // RGBA/BGRA sin comprimir
    const rMask = buf.readUInt32LE(92);
    const bgra = rMask === 0x00ff0000;
    for (let i = 0; i < width * height; i++) {
      const o = h.dataOffset + i * 4;
      rgba[i * 4] = bgra ? buf[o + 2] : buf[o];
      rgba[i * 4 + 1] = buf[o + 1];
      rgba[i * 4 + 2] = bgra ? buf[o] : buf[o + 2];
      rgba[i * 4 + 3] = buf[o + 3];
    }
    return { width, height, rgba, hasAlpha: (h.pfFlags & 0x1) !== 0, format: 'RGBA8' };
  }
  throw new Error(`Formato DDS no soportado para previsualizar (${fmt}). Usa PNG o DDS DXT1/DXT5.`);
}

function decodeBC(buf: Buffer, offset: number, width: number, height: number, out: Uint8Array, bc3: boolean): void {
  const bw = Math.max(1, Math.ceil(width / 4));
  const bh = Math.max(1, Math.ceil(height / 4));
  const blockSize = bc3 ? 16 : 8;
  const c = [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)];
  const alphas = new Uint8Array(8);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let o = offset + (by * bw + bx) * blockSize;
      if (o + blockSize > buf.length) return;
      let alphaBits = 0n;
      if (bc3) {
        const a0 = buf[o];
        const a1 = buf[o + 1];
        alphas[0] = a0;
        alphas[1] = a1;
        if (a0 > a1) for (let i = 1; i < 7; i++) alphas[i + 1] = ((7 - i) * a0 + i * a1) / 7;
        else {
          for (let i = 1; i < 5; i++) alphas[i + 1] = ((5 - i) * a0 + i * a1) / 5;
          alphas[6] = 0;
          alphas[7] = 255;
        }
        alphaBits = 0n;
        for (let i = 0; i < 6; i++) alphaBits |= BigInt(buf[o + 2 + i]) << BigInt(8 * i);
        o += 8;
      }
      const c0 = buf.readUInt16LE(o);
      const c1 = buf.readUInt16LE(o + 2);
      unpack565(c0, c[0]);
      unpack565(c1, c[1]);
      if (c0 > c1 || bc3) {
        for (let k = 0; k < 3; k++) {
          c[2][k] = (2 * c[0][k] + c[1][k]) / 3;
          c[3][k] = (c[0][k] + 2 * c[1][k]) / 3;
        }
        c[2][3] = 255;
        c[3][3] = 255;
      } else {
        for (let k = 0; k < 3; k++) {
          c[2][k] = (c[0][k] + c[1][k]) / 2;
          c[3][k] = 0;
        }
        c[2][3] = 255;
        c[3][3] = 0;
      }
      const idx = buf.readUInt32LE(o + 4);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          const i = py * 4 + px;
          const ci = (idx >> (2 * i)) & 3;
          const p = (y * width + x) * 4;
          out[p] = c[ci][0];
          out[p + 1] = c[ci][1];
          out[p + 2] = c[ci][2];
          out[p + 3] = bc3 ? alphas[Number((alphaBits >> BigInt(3 * i)) & 7n)] : c[ci][3];
        }
      }
    }
  }
}

function unpack565(v: number, out: Uint8Array): void {
  const r = (v >> 11) & 31;
  const g = (v >> 5) & 63;
  const b = v & 31;
  out[0] = (r << 3) | (r >> 2);
  out[1] = (g << 2) | (g >> 4);
  out[2] = (b << 3) | (b >> 2);
  out[3] = 255;
}

/* ---------- Codificador BC3 (DXT5) con mipmaps ---------- */

function pack565(r: number, g: number, b: number): number {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

function encodeBlockBC3(rgba: Uint8Array, width: number, height: number, bx: number, by: number, out: Buffer, o: number): void {
  const px: number[][] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const sx = Math.min(width - 1, bx * 4 + x);
      const sy = Math.min(height - 1, by * 4 + y);
      const p = (sy * width + sx) * 4;
      px.push([rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]]);
    }
  }
  // alfa: extremos + 8 niveles
  let aMin = 255;
  let aMax = 0;
  for (const p of px) {
    aMin = Math.min(aMin, p[3]);
    aMax = Math.max(aMax, p[3]);
  }
  out[o] = aMax;
  out[o + 1] = aMin;
  const alphas = [aMax, aMin];
  for (let i = 1; i < 7; i++) alphas.push(Math.round(((7 - i) * aMax + i * aMin) / 7));
  let bits = 0n;
  for (let i = 0; i < 16; i++) {
    let best = 0;
    let bd = 1e9;
    for (let k = 0; k < 8; k++) {
      const d = Math.abs(px[i][3] - alphas[k]);
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    bits |= BigInt(best) << BigInt(3 * i);
  }
  for (let i = 0; i < 6; i++) out[o + 2 + i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  // color: extremos a lo largo del eje de mayor varianza (aproximación rápida)
  let lo = px[0];
  let hi = px[0];
  let loL = 1e9;
  let hiL = -1;
  for (const p of px) {
    const l = p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114;
    if (l < loL) {
      loL = l;
      lo = p;
    }
    if (l > hiL) {
      hiL = l;
      hi = p;
    }
  }
  let c0 = pack565(hi[0], hi[1], hi[2]);
  let c1 = pack565(lo[0], lo[1], lo[2]);
  if (c0 < c1) [c0, c1] = [c1, c0];
  out.writeUInt16LE(c0, o + 8);
  out.writeUInt16LE(c1, o + 10);
  const pal = [new Uint8Array(4), new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)];
  unpack565(c0, pal[0]);
  unpack565(c1, pal[1]);
  for (let k = 0; k < 3; k++) {
    pal[2][k] = (2 * pal[0][k] + pal[1][k]) / 3;
    pal[3][k] = (pal[0][k] + 2 * pal[1][k]) / 3;
  }
  let idx = 0;
  for (let i = 0; i < 16; i++) {
    let best = 0;
    let bd = 1e12;
    for (let k = 0; k < 4; k++) {
      const d = (px[i][0] - pal[k][0]) ** 2 + (px[i][1] - pal[k][1]) ** 2 + (px[i][2] - pal[k][2]) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    idx |= best << (2 * i);
  }
  out.writeUInt32LE(idx >>> 0, o + 12);
}

function downsample(rgba: Uint8Array, w: number, h: number): { rgba: Uint8Array; w: number; h: number } {
  const nw = Math.max(1, w >> 1);
  const nh = Math.max(1, h >> 1);
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      for (let k = 0; k < 4; k++) {
        let s = 0;
        let n = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(w - 1, x * 2 + dx);
            const sy = Math.min(h - 1, y * 2 + dy);
            s += rgba[(sy * w + sx) * 4 + k];
            n++;
          }
        }
        out[(y * nw + x) * 4 + k] = Math.round(s / n);
      }
    }
  }
  return { rgba: out, w: nw, h: nh };
}

/** Codifica RGBA a DDS DXT5 con cadena completa de mipmaps. */
export function encodeDdsBc3(rgba: Uint8Array, width: number, height: number, mipmaps = true): Buffer {
  const levels: { rgba: Uint8Array; w: number; h: number }[] = [{ rgba, w: width, h: height }];
  if (mipmaps) {
    let cur = levels[0];
    while (cur.w > 1 || cur.h > 1) {
      cur = downsample(cur.rgba, cur.w, cur.h);
      levels.push(cur);
    }
  }
  const blocksOf = (w: number, h: number) => Math.max(1, Math.ceil(w / 4)) * Math.max(1, Math.ceil(h / 4));
  const total = levels.reduce((s, l) => s + blocksOf(l.w, l.h) * 16, 0);
  const out = Buffer.alloc(128 + total);
  out.write('DDS ', 0, 'ascii');
  out.writeUInt32LE(124, 4);
  out.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000 | (mipmaps ? 0x20000 : 0), 8); // CAPS|HEIGHT|WIDTH|PIXELFORMAT|LINEARSIZE|MIPMAPCOUNT
  out.writeUInt32LE(height, 12);
  out.writeUInt32LE(width, 16);
  out.writeUInt32LE(blocksOf(width, height) * 16, 20);
  out.writeUInt32LE(0, 24);
  out.writeUInt32LE(levels.length, 28);
  out.writeUInt32LE(32, 76); // pixel format size
  out.writeUInt32LE(0x4, 80); // FOURCC
  out.write('DXT5', 84, 'ascii');
  out.writeUInt32LE(0x1000 | (mipmaps ? 0x8 | 0x400000 : 0), 108); // caps: TEXTURE | COMPLEX | MIPMAP
  let o = 128;
  for (const l of levels) {
    const bw = Math.max(1, Math.ceil(l.w / 4));
    const bh = Math.max(1, Math.ceil(l.h / 4));
    for (let by = 0; by < bh; by++) {
      for (let bx = 0; bx < bw; bx++) {
        encodeBlockBC3(l.rgba, l.w, l.h, bx, by, out, o);
        o += 16;
      }
    }
  }
  return out;
}

/** Decodifica cualquier imagen soportada a RGBA (para el codificador DDS). */
export function toRgba(data: Uint8Array): { rgba: Uint8Array; width: number; height: number } {
  const buf = Buffer.from(data);
  if (buf.toString('ascii', 0, 4) === 'DDS ') {
    const d = decodeDds(buf);
    return { rgba: d.rgba, width: d.width, height: d.height };
  }
  const img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) throw new Error('No se pudo decodificar la imagen.');
  const { width, height } = img.getSize();
  const bgra = img.toBitmap();
  const rgba = new Uint8Array(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2];
    rgba[i + 1] = bgra[i + 1];
    rgba[i + 2] = bgra[i];
    rgba[i + 3] = bgra[i + 3];
  }
  return { rgba, width, height };
}
