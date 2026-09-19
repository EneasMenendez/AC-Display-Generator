import { readFileSync, writeFileSync } from 'node:fs';
import { decodeDds } from '../src/main/services/imageManager';
// PPM sin dependencias (P6)
const d = decodeDds(readFileSync(process.argv[2]));
const out = Buffer.alloc(d.width * d.height * 3);
for (let i = 0, j = 0; i < d.rgba.length; i += 4, j += 3) { out[j] = d.rgba[i]; out[j + 1] = d.rgba[i + 1]; out[j + 2] = d.rgba[i + 2]; }
writeFileSync(process.argv[3], Buffer.concat([Buffer.from(`P6\n${d.width} ${d.height}\n255\n`), out]));
console.log(d.width, d.height, d.format);
