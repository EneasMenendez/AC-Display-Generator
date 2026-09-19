import { readKn5 } from '../src/main/services/kn5Reader';
const [file, ...names] = process.argv.slice(2);
const k = readKn5(file);
for (const m of k.meshes) if (names.length === 0 || names.some((n) => m.name.toLowerCase() === n.toLowerCase())) {
  const mat = k.materials.find((x) => x.name === m.material);
  const tex = mat?.textures.find((t) => t.slot === 'txDiffuse') ?? mat?.textures[0];
  console.log(m.name, m.material, m.vertices, JSON.stringify(m.uv), JSON.stringify(m.size), tex?.texture, tex && JSON.stringify(k.textureSizes[tex.texture]));
}
