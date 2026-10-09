import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { box, plane, png, writeKn5, type Kn5Node } from './kn5Writer';

/**
 * Banco de pruebas: genera un "vehículo" de Assetto Corsa que no es un coche, sino los objetos
 * sueltos que hacen falta para probar de punta a punta todo lo que hace la aplicación:
 *
 *   DISPLAY_MAIN     pantalla grande, textura 1024×512 con la UV completa
 *   DISPLAY_SIDE     pantalla pequeña que solo usa un cuarto de su textura (prueba "Área visible")
 *   BUTTON_PAGE/MODE/UP/DOWN   cuatro botones sueltos (botones físicos, uno por malla)
 *   BUTTON_BAR       una sola malla con dos mitades por UV (botones físicos delimitados por UV)
 *   NEEDLE_RPM/SPEED colgando de su eje (agujas físicas con [ANALOG_INDICATOR_...])
 *   GAUGE_FACE_*     esferas detrás de las agujas
 *   DASH_PANEL/BODY  soporte y carrocería mínima para verlo en el juego
 *   WHEEL_*          ruedas, que Assetto Corsa coloca por física
 *
 * La física se copia de un coche con la carpeta `data` sin empaquetar (el .acd va cifrado con el
 * nombre de la carpeta, así que no se puede renombrar). Es solo para probar en local.
 *
 * Uso:  npx vite-node tools/makeTestRig.ts -- [--ac <carpeta de AC>] [--physics <id de coche>]
 */

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const AC = arg('ac', 'C:/Program Files (x86)/Steam/steamapps/common/assettocorsa');
const PHYSICS = arg('physics', 'aa_peugeot_106_autocross');
const ID = arg('id', 'acdg_test_rig');

const CARS = join(AC, 'content', 'cars');
const SRC = join(CARS, PHYSICS);
const DST = join(CARS, ID);

/* ---------- medidas del banco (metros, X derecha, Y arriba, Z adelante) ---------- */

const EYES = { x: 0, y: 0.95, z: 0.1 };
const DASH_Z = 0.72; // cara de los objetos, mirando al conductor
const DASH_Y = 1.0;

const MAIN = { w: 0.28, h: 0.14, center: { x: 0.18, y: DASH_Y, z: DASH_Z } };
const SIDE = { w: 0.16, h: 0.08, center: { x: -0.2, y: DASH_Y, z: DASH_Z } };
const BUTTONS = ['BUTTON_PAGE', 'BUTTON_MODE', 'BUTTON_UP', 'BUTTON_DOWN'];

function buildModel(): Buffer {
  const nodes: Kn5Node[] = [];

  // carrocería mínima: una plataforma para no tener un coche invisible
  nodes.push({ kind: 'mesh', name: 'BODY', material: 'RigBody', ...box({ x: 0, y: 0.45, z: 0 }, { x: 1.5, y: 0.1, z: 3.4 }) });
  nodes.push({ kind: 'mesh', name: 'DASH_PANEL', material: 'RigDark', ...box({ x: 0, y: 0.96, z: DASH_Z + 0.03 }, { x: 1.1, y: 0.34, z: 0.06 }) });

  // pantallas
  nodes.push({ kind: 'mesh', name: 'DISPLAY_MAIN', material: 'DisplayMain', ...plane(MAIN.center, MAIN.w, MAIN.h) });
  // la lateral solo usa el cuarto superior izquierdo de su textura
  nodes.push({ kind: 'mesh', name: 'DISPLAY_SIDE', material: 'DisplaySide', ...plane(SIDE.center, SIDE.w, SIDE.h, { u0: 0, v0: 0, u1: 0.5, v1: 0.5 }) });

  // botonera: cuatro mallas sueltas
  BUTTONS.forEach((name, i) => {
    nodes.push({
      kind: 'mesh',
      name,
      material: 'RigButton',
      ...box({ x: 0.06 + i * 0.07, y: 0.86, z: DASH_Z - 0.005 }, { x: 0.05, y: 0.05, z: 0.015 }),
    });
  });

  // barra de dos botones en una sola malla: mitad izquierda u 0–0,5 y mitad derecha u 0,5–1
  const left = box({ x: -0.13, y: 0.86, z: DASH_Z - 0.005 }, { x: 0.06, y: 0.05, z: 0.015 }, { u0: 0, v0: 0, u1: 0.5, v1: 1 });
  const right = box({ x: -0.06, y: 0.86, z: DASH_Z - 0.005 }, { x: 0.06, y: 0.05, z: 0.015 }, { u0: 0.5, v0: 0, u1: 1, v1: 1 });
  nodes.push({
    kind: 'mesh',
    name: 'BUTTON_BAR',
    material: 'RigButton',
    vertices: [...left.vertices, ...right.vertices],
    indices: [...left.indices, ...right.indices.map((i) => i + left.vertices.length)],
  });

  // agujas: cada una cuelga de su eje, con su esfera detrás
  const needles: { name: string; x: number }[] = [
    { name: 'RPM', x: 0.42 },
    { name: 'SPEED', x: 0.6 },
  ];
  for (const n of needles) {
    nodes.push({
      kind: 'mesh',
      name: `GAUGE_FACE_${n.name}`,
      material: 'RigDark',
      ...plane({ x: n.x, y: DASH_Y, z: DASH_Z + 0.004 }, 0.11, 0.11),
    });
    nodes.push({
      kind: 'dummy',
      name: `NEEDLE_${n.name}_PIVOT`,
      position: { x: n.x, y: DASH_Y, z: DASH_Z },
      children: [
        // la aguja arranca en el eje y apunta hacia arriba: así el ángulo 0 es la vertical
        { kind: 'mesh', name: `NEEDLE_${n.name}`, material: 'RigNeedle', ...plane({ x: 0, y: 0.022, z: 0 }, 0.006, 0.044) },
      ],
    });
  }

  // ruedas: Assetto Corsa las coloca por física, basta con que existan
  const wheels: [string, number, number][] = [
    ['WHEEL_LF', -0.695, 1.2],
    ['WHEEL_RF', 0.695, 1.2],
    ['WHEEL_LR', -0.685, -1.2],
    ['WHEEL_RR', 0.685, -1.2],
  ];
  for (const [name, x, z] of wheels) {
    nodes.push({ kind: 'mesh', name, material: 'RigDark', ...box({ x, y: 0.3, z }, { x: 0.18, y: 0.56, z: 0.56 }) });
  }

  return writeKn5({
    root: ID,
    textures: [
      { name: 'acdg_display_main.png', data: screenTexture(1024, 512) },
      { name: 'acdg_display_side.png', data: screenTexture(512, 512) },
      { name: 'acdg_rig.png', data: png(8, 8, () => [70, 72, 78]) },
      { name: 'acdg_button.png', data: png(8, 8, (x) => (x < 4 ? [120, 120, 126] : [90, 90, 96])) },
      { name: 'acdg_needle.png', data: png(4, 4, () => [220, 70, 60]) },
      { name: 'acdg_body.png', data: png(8, 8, () => [40, 42, 48]) },
    ],
    materials: [
      // las pantallas llevan emisión: así se ven de noche aunque no se instale nada todavía
      { name: 'DisplayMain', texture: 'acdg_display_main.png', props: [{ name: 'ksEmissive', vec3: [1, 1, 1] }, { name: 'ksAmbient', value: 0.1 }, { name: 'ksDiffuse', value: 0.1 }] },
      { name: 'DisplaySide', texture: 'acdg_display_side.png', props: [{ name: 'ksEmissive', vec3: [1, 1, 1] }, { name: 'ksAmbient', value: 0.1 }, { name: 'ksDiffuse', value: 0.1 }] },
      { name: 'RigDark', texture: 'acdg_rig.png', props: [{ name: 'ksDiffuse', value: 0.4 }, { name: 'ksAmbient', value: 0.4 }] },
      { name: 'RigButton', texture: 'acdg_button.png', props: [{ name: 'ksDiffuse', value: 0.5 }, { name: 'ksAmbient', value: 0.5 }] },
      { name: 'RigNeedle', texture: 'acdg_needle.png', props: [{ name: 'ksEmissive', vec3: [0.6, 0.1, 0.1] }, { name: 'ksDiffuse', value: 0.5 }] },
      { name: 'RigBody', texture: 'acdg_body.png', props: [{ name: 'ksDiffuse', value: 0.5 }, { name: 'ksAmbient', value: 0.4 }] },
    ],
    nodes,
  });
}

/** Textura de pantalla: fondo oscuro con una rejilla y marcas en las esquinas, para ver la UV. */
function screenTexture(width: number, height: number): Buffer {
  return png(width, height, (x, y) => {
    const edge = x < 3 || y < 3 || x > width - 4 || y > height - 4;
    const corner = (x < 40 || x > width - 41) && (y < 40 || y > height - 41);
    if (corner) return [90, 70, 20];
    if (edge) return [60, 60, 70];
    if (x % 64 === 0 || y % 64 === 0) return [26, 28, 32];
    return [12, 13, 15];
  });
}

/* ---------- perfil de displays para la aplicación ---------- */

function profile(): string {
  return JSON.stringify(
    {
      profile_version: 2,
      id: `${ID}.rig`,
      name: 'ACDG Test Rig',
      author: 'AC Display Generator',
      car_ids: [ID],
      displays: [
        {
          id: 'main',
          name: 'Pantalla principal',
          meshes: ['DISPLAY_MAIN'],
          texture_size: { width: 1024, height: 512 },
          physical_size_m: { width: MAIN.w, height: MAIN.h },
          keep_background: false,
          skip_frames: 1,
          emissive: { mode: 'props', ks_emissive: [3, 3, 3], brightness_default: 1 },
          defaults: { rpm_limiter: 7500, max_fuel_l: 60 },
        },
        {
          id: 'side',
          name: 'Pantalla lateral (UV parcial)',
          meshes: ['DISPLAY_SIDE'],
          texture_size: { width: 512, height: 512 },
          physical_size_m: { width: SIDE.w, height: SIDE.h },
          uv_region: { x: 0, y: 0, width: 0.5, height: 0.5 },
          keep_background: false,
          skip_frames: 1,
          emissive: { mode: 'props', ks_emissive: [3, 3, 3], brightness_default: 1 },
          defaults: { rpm_limiter: 7500, max_fuel_l: 60 },
        },
      ],
    },
    null,
    2,
  );
}

function uiCar(): string {
  return JSON.stringify(
    {
      name: 'ACDG Test Rig',
      brand: 'AC Display Generator',
      description:
        'Banco de pruebas: no es un coche, son objetos sueltos para probar displays, botones táctiles, botones físicos y agujas.\n\nMallas: DISPLAY_MAIN, DISPLAY_SIDE (UV parcial), BUTTON_PAGE/MODE/UP/DOWN, BUTTON_BAR (dos mitades por UV) y NEEDLE_RPM / NEEDLE_SPEED con sus ejes.',
      tags: ['acdg', 'test', 'rig'],
      class: 'test',
      specs: { bhp: '—', torque: '—', weight: '—', topspeed: '—', acceleration: '—', pwratio: '—' },
      year: new Date().getFullYear(),
      country: '—',
    },
    null,
    2,
  );
}

/* ---------- generación ---------- */

function patchIni(file: string, edits: { section: string; key: string; value: string }[]): void {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  let current = '';
  const done = new Set<string>();
  const out = lines.map((line) => {
    const sec = /^\s*\[(.+?)\]/.exec(line);
    if (sec) current = sec[1].toUpperCase();
    for (const e of edits) {
      if (current !== e.section.toUpperCase()) continue;
      const re = new RegExp(`^\\s*${e.key}\\s*=`, 'i');
      if (re.test(line)) {
        done.add(`${e.section}.${e.key}`);
        return `${e.key}=${e.value}`;
      }
    }
    return line;
  });
  for (const e of edits) {
    if (done.has(`${e.section}.${e.key}`)) continue;
    const at = out.findIndex((l) => new RegExp(`^\\s*\\[${e.section}\\]`, 'i').test(l));
    if (at >= 0) out.splice(at + 1, 0, `${e.key}=${e.value}`);
    else out.push('', `[${e.section}]`, `${e.key}=${e.value}`);
  }
  writeFileSync(file, out.join('\n'), 'utf8');
}

function main(): void {
  if (!existsSync(SRC)) throw new Error(`No se encontró el coche del que copiar la física: ${SRC}`);
  if (!existsSync(join(SRC, 'data', 'car.ini'))) {
    throw new Error(`${PHYSICS} tiene la física empaquetada (data.acd) y no se puede reutilizar; elige un coche con carpeta data sin empaquetar.`);
  }

  if (existsSync(DST)) rmSync(DST, { recursive: true, force: true });
  mkdirSync(join(DST, 'ui'), { recursive: true });
  mkdirSync(join(DST, 'skins', 'default'), { recursive: true });
  mkdirSync(join(DST, 'extension'), { recursive: true });
  mkdirSync(join(DST, 'sfx'), { recursive: true });

  // física prestada (solo local): se copia la carpeta data tal cual y se adapta lo imprescindible
  cpSync(join(SRC, 'data'), join(DST, 'data'), { recursive: true });
  // sin nodo COCKPIT_HR en el modelo: un único LOD
  writeFileSync(join(DST, 'data', 'lods.ini'), `[LOD_0]\nFILE=${ID}.kn5\nIN=0\nOUT=400\n`, 'utf8');
  patchIni(join(DST, 'data', 'car.ini'), [
    { section: 'INFO', key: 'SCREEN_NAME', value: 'ACDG Test Rig' },
    { section: 'INFO', key: 'SHORT_NAME', value: 'RIG' },
    { section: 'BASIC', key: 'GRAPHICS_OFFSET', value: '0,0,0' },
    { section: 'BASIC', key: 'GRAPHICS_PITCH_ROTATION', value: '0' },
    { section: 'GRAPHICS', key: 'DRIVEREYES', value: `${EYES.x},${EYES.y},${EYES.z}` },
    { section: 'GRAPHICS', key: 'ON_BOARD_PITCH_ANGLE', value: '-4' },
    { section: 'GRAPHICS', key: 'BONNET_CAMERA_POS', value: '0,1.1,1.0' },
    { section: 'GRAPHICS', key: 'BUMPER_CAMERA_POS', value: '0,0.7,1.6' },
    { section: 'GRAPHICS', key: 'VIRTUAL_MIRROR_ENABLED', value: '1' },
  ]);
  // los .ini que describen mallas del coche original no valen aquí: se vacían para no llenar el
  // registro de avisos por objetos que este modelo no tiene
  for (const f of ['blurred_objects.ini', 'wing_animations.ini', 'proview_nodes.ini', 'lights.ini', 'suspension_graphics.ini', 'analog_instruments.ini']) {
    const file = join(DST, 'data', f);
    if (existsSync(file)) writeFileSync(file, '[HEADER]\nVERSION=1\n', 'utf8');
  }
  // animaciones y posición del piloto: si el coche de origen las trae, se copian (pesan poco)
  if (existsSync(join(SRC, 'animations'))) cpSync(join(SRC, 'animations'), join(DST, 'animations'), { recursive: true });
  if (existsSync(join(SRC, 'driver_base_pos.knh'))) copyFileSync(join(SRC, 'driver_base_pos.knh'), join(DST, 'driver_base_pos.knh'));
  // sin bancos de sonido: el banco pesa cientos de MB y el banco de pruebas no los necesita
  if (existsSync(join(SRC, 'sfx', 'GUIDs.txt'))) copyFileSync(join(SRC, 'sfx', 'GUIDs.txt'), join(DST, 'sfx', 'GUIDs.txt'));

  writeFileSync(join(DST, `${ID}.kn5`), buildModel());
  if (existsSync(join(SRC, 'Collider.kn5'))) copyFileSync(join(SRC, 'Collider.kn5'), join(DST, 'Collider.kn5'));
  else if (existsSync(join(SRC, 'collider.kn5'))) copyFileSync(join(SRC, 'collider.kn5'), join(DST, 'collider.kn5'));

  writeFileSync(join(DST, 'ui', 'ui_car.json'), uiCar(), 'utf8');
  writeFileSync(join(DST, 'ui', 'badge.png'), png(64, 64, (x, y) => (Math.abs(x - 32) + Math.abs(y - 32) < 26 ? [240, 167, 58] : [20, 21, 24])));
  writeFileSync(join(DST, 'skins', 'default', 'ui_skin.json'), JSON.stringify({ skinname: 'Default', drivername: '', country: '', team: '', number: 1 }, null, 2), 'utf8');
  writeFileSync(join(DST, 'skins', 'default', 'preview.jpg'), png(240, 160, (_x, y) => (y > 120 ? [18, 19, 22] : [34, 36, 42])));
  writeFileSync(join(DST, 'skins', 'default', 'livery.png'), png(64, 64, () => [240, 167, 58]));
  writeFileSync(join(DST, 'extension', 'display_profile.json'), profile(), 'utf8');

  console.log(`Banco de pruebas creado en ${DST}`);
  console.log(`  modelo:   ${ID}.kn5`);
  console.log(`  física:   copiada de ${PHYSICS} (solo para pruebas locales)`);
  console.log('  displays: DISPLAY_MAIN (1024×512) y DISPLAY_SIDE (512×512, UV al cuarto superior izquierdo)');
  console.log(`  botones:  ${BUTTONS.join(', ')} y BUTTON_BAR (dos mitades por UV)`);
  console.log('  agujas:   NEEDLE_RPM y NEEDLE_SPEED, cada una bajo su eje');
}

main();
