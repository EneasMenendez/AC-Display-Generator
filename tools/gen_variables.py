"""
Genera src/shared/variables.generated.ts a partir de las definiciones del SDK de CSP
(extension/internal/lua-sdk/ac_car_scriptable_display/lib.lua): todos los campos numéricos,
enteros y booleanos de ac.StateCar, ac.StateWheel (x4 ruedas) y ac.StateSim.

Uso:  python tools/gen_variables.py [ruta_a_lib.lua]
"""
import io, re, sys, os

DEFAULT = r"C:\Program Files (x86)\Steam\steamapps\common\assettocorsa\extension\internal\lua-sdk\ac_car_scriptable_display\lib.lua"
src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
lines = io.open(src, encoding='utf-8').read().split('\n')

def block(cls):
    out = []
    inside = False
    for l in lines:
        if l.startswith('---@class '):
            if inside:
                break
            inside = l.startswith(f'---@class {cls}') and (l.strip() == f'---@class {cls}' or l.startswith(f'---@class {cls} '))
            continue
        if inside and l.startswith('---@field '):
            m = re.match(r'---@field (\w+) (\S+)(?: @(.*))?', l)
            if m:
                out.append((m.group(1), m.group(2), (m.group(3) or '').strip()))
    return out

SKIP_CAR = {'index', 'timestamp', 'nodeIndex', 'visibleIndex', 'activeLOD', 'extraIconsCount', 'sessionID', 'graphicsPitchRotation',
            'exposureOutside', 'exposureInside', 'shakeMultiplier', 'bsRadius', 'groundDistance', 'collisionDepth', 'collidedWith',
            'resetCounter', 'extrapolatedMovement', 'isHidingLabels', 'useInternalAudio', 'ffbSteerAssist', 'ffbBase', 'ffbFinal',
            'ffbPure', 'ffbMultiplier', 'steerTorque', 'ambientOcclusion', 'rawAmbientOcclusion', 'carCamerasCount', 'neutralSunTrajectoryTimestamp'}
SKIP_SIM = {'timestamp', 'cpuTime', 'timePostOffset', 'timePhotoModeOffset', 'systemTime', 'gameTime', 'resultScreenTime', 'raceOverTime',
            'timeMultiplier', 'isTimeOffsetIgnored', 'isTimedRace', 'currentSessionIndex', 'sessionsCount'}
SKIP_WHEEL = {'surfaceSectorID', 'surfaceSectionIndex', 'surfaceOriginIndex', 'temperatureMultiplier', 'dx', 'dy', 'mz', 'fx', 'fy',
              'surfaceVibrationGain', 'surfaceVibrationLength', 'surfaceGranularity', 'surfaceDamping', 'loadK'}

def humanize(name):
    s = re.sub(r'([a-z0-9])([A-Z])', r'\1 \2', name)
    s = s.replace('_', ' ')
    return s[0].upper() + s[1:]

def guess(desc, typ, name):
    d = desc.lower()
    unit = ''
    rng = None
    if 'km/h' in d or name.lower().endswith('kmh'): unit = 'km/h'; rng = [0, 400]
    elif 'in m/s' in d or name.lower().endswith('ms') and 'speed' in d: unit = 'm/s'; rng = [0, 120]
    elif 'millisecond' in d or name.endswith('Ms') or name.endswith('TimeMs'): unit = 'ms'; rng = [0, 600000]
    elif 'in degrees' in d or 'angle' in d and 'degrees' in d: unit = '°'; rng = [-180, 180]
    elif 'radians' in d: unit = 'rad'; rng = [-3.14, 3.14]
    elif 'in meters' in d or 'in m' in d.split(): unit = 'm'; rng = [0, 100]
    elif 'liters' in d or 'litres' in d: unit = 'L'; rng = [0, 150]
    elif ' kg' in d: unit = 'kg'; rng = [0, 2000]
    elif '°c' in d or 'temperature' in d: unit = '°C'; rng = [0, 150]
    elif 'pressure' in d and 'tyre' in d: unit = 'psi'; rng = [0, 50]
    elif 'from 0 to 1' in d or 'from 0 and upwards' in d and False: unit = '%'; rng = [0, 1]
    elif 'percent' in d: unit = '%'; rng = [0, 1]
    elif 'voltage' in d or name.lower().endswith('voltage'): unit = 'V'; rng = [0, 16]
    elif 'rpm' in d or name.lower().startswith('rpm'): unit = 'rpm'; rng = [0, 12000]
    elif 'ping' in d: unit = 'ms'; rng = [0, 500]
    elif 'kj' in d or name.lower().endswith('kj'): unit = 'kJ'; rng = [0, 5000]
    if rng is None:
        if 'from 0 to 1' in d: rng = [0, 1]; unit = unit or '%'
        elif typ == 'boolean': rng = [0, 1]
        elif 'index' in d or 'count' in d or 'number of' in d: rng = [0, 50]
        else: rng = [0, 100]
    return unit, rng

def entry(id_, label, cat, typ, lua, desc, unit, rng, physics):
    fallback = 'false' if typ == 'boolean' else '0'
    preview = 'false' if typ == 'boolean' else (str(round((rng[0] + rng[1]) / 2, 2)))
    desc_js = desc.replace('\\', '\\\\').replace("'", "\\'")
    return f"  {{ id: '{id_}', label: '{label}', category: '{cat}', type: '{typ}', lua: '{lua}', unit: '{unit}', range: [{rng[0]}, {rng[1]}], physics_only: {'true' if physics else 'false'}, fallback: {fallback}, preview: {preview}, advanced: true, description: '{desc_js}' }},"

def map_type(t):
    if t in ('number',): return 'number'
    if t in ('integer',): return 'integer'
    if t in ('boolean',): return 'boolean'
    if t.startswith('ac.') and t[3:4].isupper() and t not in ('ac.StateCar', 'ac.StateWheel'): return 'integer'  # enums
    return None

out = []
seen = set()

def add(id_, label, cat, typ, lua, desc, physics):
    if lua in seen: return
    seen.add(lua)
    unit, rng = guess(desc, typ, lua.split('.')[-1])
    if typ == 'integer' and unit == 'ms': typ = 'time_ms'
    out.append(entry(id_, label, cat, typ, lua, desc, unit, rng, physics))

# ---- coche ----
for name, typ, desc in block('ac.StateCar'):
    if name in SKIP_CAR: continue
    physics = 'physics-only' in desc.lower()
    t = map_type(typ)
    if t:
        add(f'car_{name}', humanize(name), 'Coche (todos)', t, f'car.{name}', desc, physics)
    elif typ.startswith('{[0|1|2|3|4]:') or typ.startswith('{[0|1|2|3]:') or typ.startswith('{[0|1]:') or typ.startswith('{[0|1|2|3|4|5|6|7]:'):
        n = typ.count('|') + 1
        for i in range(n):
            add(f'car_{name}_{i}', f'{humanize(name)} [{i}]', 'Coche (todos)', 'number', f'car.{name}[{i}]', desc, physics)
    elif typ == 'vec3' and name in ('velocity', 'acceleration', 'localVelocity', 'localAngularVelocity', 'angularVelocity', 'position'):
        for ax in 'xyz':
            add(f'car_{name}_{ax}', f'{humanize(name)} {ax.upper()}', 'Coche (todos)', 'number', f'car.{name}.{ax}', desc, physics)

# ---- ruedas ----
W = ['fl', 'fr', 'rl', 'rr']
WL = {'fl': 'DI', 'fr': 'DD', 'rl': 'TI', 'rr': 'TD'}
for name, typ, desc in block('ac.StateWheel'):
    if name in SKIP_WHEEL: continue
    t = map_type(typ)
    if not t: continue
    for i, w in enumerate(W):
        add(f'wheel_{name}_{w}', f'{humanize(name)} {WL[w]}', 'Neumáticos (todos)', t, f'car.wheels[{i}].{name}', desc, False)

# ---- simulación ----
for name, typ, desc in block('ac.StateSim'):
    if name in SKIP_SIM: continue
    t = map_type(typ)
    if not t: continue
    add(f'sim_{name}', humanize(name), 'Simulación (todos)', t, f'sim.{name}', desc, False)

# ---- sesión actual ----
for name, typ, desc in block('ac.StateSession'):
    t = map_type(typ)
    if not t: continue
    add(f'session_{name}', humanize(name), 'Sesión (todos)', t, f'ac.getSession(sim.currentSessionIndex).{name}', desc, False)

header = """/* eslint-disable */
// GENERADO por tools/gen_variables.py a partir del SDK de CSP (lib.lua). No editar a mano.
// Catálogo completo de datos de AC/CSP: campos numéricos, enteros y booleanos de car, car.wheels[i], sim y la sesión actual.
import type { VariableDef } from './variables';

export const GENERATED_VARIABLES: VariableDef[] = [
"""
dst = os.path.join(os.path.dirname(__file__), '..', 'src', 'shared', 'variables.generated.ts')
io.open(dst, 'w', encoding='utf-8', newline='\n').write(header + '\n'.join(out) + '\n];\n')
print(f'{len(out)} variables -> {dst}')
