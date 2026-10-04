-- ============================================================
-- AC Display Generator — runtime Lua
-- Librería estable que dibuja un display a partir de display_config.lua.
-- No editar a mano: se sustituye al regenerar el display.
-- Requiere CSP con scriptable displays (ui.* + car/sim state).
-- ============================================================

ACDG = ACDG or {}
ACDG.version = '0.1.0'

local cfg = nil
local W, H = 0, 0
local scriptDir = nil
local fonts = {}
local state = {}          -- estado por elemento (histéresis, suavizado)
local t = 0               -- tiempo acumulado (parpadeos)
local brightness = 1
local nightTarget = 1
local nightCurrent = 1
local physicsOk = true

-- Táctil (INTERACTIVE = 1 en la sección del display): CSP proyecta el puntero sobre la malla y lo
-- traduce a píxeles de la textura; aquí se consulta con ui.rectHovered / ui.mouseDown / ui.mouseClicked.
local tReal = 0           -- tiempo real: avanza aunque se salten frames de dibujo (temporiza el táctil)
local touch = {
  on = false,             -- la pantalla es táctil
  hover = nil,            -- id del botón bajo el puntero
  active = nil,           -- id del botón que se está pulsando
  nextRepeat = 0,
  pressStrip = -1,        -- franja donde empezó un posible deslizamiento
  prevManual = nil,       -- página anterior (acción "volver")
  wasDown = false,        -- estado del botón del ratón en la consulta anterior (flanco propio)
  daytime = false,
  engineBrake = 0,
  sw = {},                -- interruptores táctiles (a…f)
  storage = nil,
}

-- Interruptor de una pantalla táctil: variables touch_a … touch_f del catálogo.
function ACDG.sw(k)
  return touch.sw[k] == true
end

local VEC0 = vec2(0, 0)
local VEC1 = vec2(1, 1)
local WHITE = rgbm(1, 1, 1, 1)
-- puntos reutilizables para las llamadas de dibujo (evitan crear vec2 en cada frame)
local p1, p2 = vec2(), vec2()

-- ------------------------------------------------------------
-- Utilidades
-- ------------------------------------------------------------

local function num(v)
  if type(v) == 'number' and v == v then return v end
  return 0
end

local function hexToRgbm(s)
  if type(s) ~= 'string' or s:sub(1, 1) ~= '#' then return nil end
  local hex = s:sub(2)
  if #hex == 6 then hex = hex .. 'FF' end
  if #hex ~= 8 then return nil end
  local r = tonumber(hex:sub(1, 2), 16) or 0
  local g = tonumber(hex:sub(3, 4), 16) or 0
  local b = tonumber(hex:sub(5, 6), 16) or 0
  local a = tonumber(hex:sub(7, 8), 16) or 255
  return rgbm(r / 255, g / 255, b / 255, a / 255)
end

-- Convierte recursivamente cadenas "#RRGGBB[AA]" a rgbm.
local function convertColors(tbl)
  for k, v in pairs(tbl) do
    if type(v) == 'table' then
      convertColors(v)
    elseif type(v) == 'string' and v:sub(1, 1) == '#' and (#v == 7 or #v == 9) then
      local c = hexToRgbm(v)
      if c then tbl[k] = c end
    end
  end
end

local tmpColor = rgbm(1, 1, 1, 1)
-- Devuelve un color aplicando brillo global y opacidad (reutiliza un rgbm temporal).
local pageAlpha = 1 -- opacidad global de la página que se está dibujando (transiciones)

local function col(c, opacity)
  if c == nil then return WHITE end
  local b = brightness * nightCurrent
  tmpColor.r = c.r * b
  tmpColor.g = c.g * b
  tmpColor.b = c.b * b
  tmpColor.mult = c.mult * (opacity or 1) * pageAlpha
  return tmpColor
end

local function limiter()
  local l = num(car.rpmLimiter)
  if l <= 0 then l = num(cfg.defaults.rpmLimiter) end
  if l <= 0 then l = 8000 end
  return l
end

-- Resuelve un valor de RPM (número o "85%").
local function rpmValue(v)
  if type(v) == 'number' then return v end
  if type(v) == 'string' then
    local pct = tonumber(v:match('^([%d%.]+)%%$'))
    if pct then return pct / 100 * limiter() end
    return tonumber(v) or 0
  end
  return 0
end

local function blinkOn(hz, duty)
  if not hz or hz <= 0 then return true end
  duty = duty or 0.5
  if duty < 0.05 then duty = 0.05 elseif duty > 0.95 then duty = 0.95 end
  return (t * hz) % 1 < duty
end

local function clamp01(x)
  if x < 0 then return 0 end
  if x > 1 then return 1 end
  return x
end

local function lerp(a, b, k)
  return a + (b - a) * k
end

-- ------------------------------------------------------------
-- Destello (halo): capas concéntricas con alfa decreciente
-- ------------------------------------------------------------

local GLOW_LAYERS = 6
local glowColor = rgbm(1, 1, 1, 1)
local litTmp = rgbm(1, 1, 1, 1)

-- luminancia (1 = color tal cual) y fuerza del núcleo caliente (0–1)
local function lightLevels(glow)
  local lum = glow and glow.luminance or 1
  if lum < 0.2 then lum = 0.2 end
  local core = clamp01(((glow and glow.core) or 0.5)) * clamp01((lum - 0.8) / 1.2)
  return lum, core
end

-- color de una luz encendida: rgb × luminancia (en pantallas HDR sobreexpone; en LDR satura hacia
-- blanco de forma parecida al editor)
local function litCol(color, lum, opacity)
  local base = col(color, opacity)
  if lum <= 1 then return base end
  local k = clamp01((lum - 1) * 0.3)
  local m = math.min(lum, 1.6)
  litTmp.r = base.r * m + (1 - base.r) * k
  litTmp.g = base.g * m + (1 - base.g) * k
  litTmp.b = base.b * m + (1 - base.b) * k
  litTmp.mult = base.mult
  return litTmp
end

local function glowAlpha(glow, k, opacity, lum)
  local f = 1 - (k - 1) / GLOW_LAYERS
  return (glow.intensity or 0.6) * 0.30 * f * f * math.sqrt(f) * math.min(lum, 2) * (opacity or 1)
end

local function glowCircle(cx, cy, r, color, glow, opacity)
  if not glow or (glow.size or 0) <= 0 or (glow.intensity or 0) <= 0 then return end
  local lum = lightLevels(glow)
  local base = litCol(color, lum, 1)
  glowColor.r, glowColor.g, glowColor.b = base.r, base.g, base.b
  p1.x, p1.y = cx, cy
  for k = GLOW_LAYERS, 1, -1 do
    glowColor.mult = glowAlpha(glow, k, opacity, lum)
    ui.drawCircleFilled(p1, r + glow.size * k / GLOW_LAYERS, glowColor, 32)
  end
end

local function glowRect(x, y, w, h, radius, color, glow, opacity)
  if not glow or (glow.size or 0) <= 0 or (glow.intensity or 0) <= 0 then return end
  local lum = lightLevels(glow)
  local base = litCol(color, lum, 1)
  glowColor.r, glowColor.g, glowColor.b = base.r, base.g, base.b
  for k = GLOW_LAYERS, 1, -1 do
    local e = glow.size * k / GLOW_LAYERS
    glowColor.mult = glowAlpha(glow, k, opacity, lum)
    p1.x, p1.y = x - e, y - e
    p2.x, p2.y = x + w + e, y + h + e
    ui.drawRectFilled(p1, p2, glowColor, (radius or 0) + e)
  end
end

-- núcleo caliente: forma reducida blanquecina en el centro de la luz
local function coreCircle(cx, cy, r, glow, opacity)
  local _, core = lightLevels(glow)
  if core <= 0 then return end
  glowColor.r, glowColor.g, glowColor.b = 1, 1, 1
  glowColor.mult = core * (opacity or 1)
  p1.x, p1.y = cx, cy
  ui.drawCircleFilled(p1, r * 0.5, glowColor, 24)
end

local function coreRect(x, y, w, h, radius, glow, opacity)
  local _, core = lightLevels(glow)
  if core <= 0 then return end
  glowColor.r, glowColor.g, glowColor.b = 1, 1, 1
  glowColor.mult = core * (opacity or 1)
  p1.x, p1.y = x + w * 0.25, y + h * 0.25
  p2.x, p2.y = x + w * 0.75, y + h * 0.75
  ui.drawRectFilled(p1, p2, glowColor, radius or 0)
end

-- ------------------------------------------------------------
-- Variables
-- ------------------------------------------------------------

local varCache = {}

function ACDG.rpmPct()
  return clamp01(num(car.rpm) / limiter())
end

function ACDG.fuelPct()
  local m = num(car.maxFuel)
  if m <= 0 then m = num(cfg.defaults.maxFuel) end
  if m <= 0 then return 0 end
  return clamp01(num(car.fuel) / m)
end

function ACDG.fuelLapsLeft()
  local per = num(car.fuelPerLap)
  if per <= 0 then return 0 end
  return num(car.fuel) / per
end

function ACDG.lowFuel()
  return ACDG.fuelPct() < (cfg.defaults.lowFuelPct or 0.1)
end

function ACDG.waterHot()
  return num(car.waterTemperature) >= (cfg.defaults.waterHot or 110)
end

function ACDG.oilLowPressure()
  return num(car.rpm) > 500 and num(car.oilPressure) < (cfg.defaults.oilLowPressure or 1)
end

function ACDG.batteryLow()
  return num(car.batteryVoltage) < (cfg.defaults.batteryLow or 12)
end

local varErrorLogged = {}

-- variables que calcula el propio runtime (máquina de páginas)
local pageEnteredAt, pageEntrySpeed = 0, 0
local BUILTIN_VARS = {
  page_time = function() return t - pageEnteredAt end,
  page_entry_speed = function() return pageEntrySpeed end,
}

local function getVar(id)
  local v = varCache[id]
  if v ~= nil then return v end
  local bi = BUILTIN_VARS[id]
  if bi then
    v = bi()
    varCache[id] = v
    return v
  end
  local fn = cfg.vars[id]
  if not fn then return nil end
  local ok, res = pcall(fn)
  if not ok then
    -- un fallo al leer la variable no debe matar el display, pero sí quedar en el log de CSP (una vez)
    if not varErrorLogged[id] then
      varErrorLogged[id] = true
      ac.error('[ACDG] variable "' .. tostring(id) .. '": ' .. tostring(res))
    end
    res = nil
  end
  if res == nil then
    local meta = cfg.varMeta[id]
    res = meta and meta.fallback or 0
  end
  varCache[id] = res
  return res
end

-- ------------------------------------------------------------
-- Formato (espejo de src/shared/format.ts)
-- ------------------------------------------------------------

local function pad(n, w)
  local s = tostring(n)
  while #s < w do s = '0' .. s end
  return s
end

local function formatTime(ms, fmt)
  fmt = fmt or 'm:ss.mmm'
  if ms == nil or ms ~= ms or ms < 0 then
    return fmt == 'h:mm:ss' and '-:--:--' or '-:--.---'
  end
  local total = math.floor(ms)
  local h = math.floor(total / 3600000)
  local m = math.floor((total % 3600000) / 60000)
  local s = math.floor((total % 60000) / 1000)
  local mil = total % 1000
  if fmt == 'm:ss.mmm' then
    return string.format('%d:%s.%s', h * 60 + m, pad(s, 2), pad(mil, 3))
  elseif fmt == "m'ss\"mm" then
    return string.format('%d\'%s"%s', h * 60 + m, pad(s, 2), pad(math.floor(mil / 10), 2))
  elseif fmt == 'm:ss.m' then
    return string.format('%d:%s.%d', h * 60 + m, pad(s, 2), math.floor(mil / 100))
  elseif fmt == 'ss.mmm' then
    return string.format('%d.%s', (h * 60 + m) * 60 + s, pad(mil, 3))
  elseif fmt == 'h:mm:ss' then
    return string.format('%d:%s:%s', h, pad(m, 2), pad(s, 2))
  end
  return string.format('%d:%s.%s', h * 60 + m, pad(s, 2), pad(mil, 3))
end

local function formatNumber(value, decimals, padZeros, showSign)
  if value == nil or value ~= value then return '-' end
  decimals = math.max(0, math.min(6, decimals or 0))
  local s = string.format('%.' .. decimals .. 'f', math.abs(value))
  if padZeros and padZeros > 0 then
    local int, frac = s:match('^(%d+)%.?(%d*)$')
    if int then
      s = pad(int, padZeros)
      if frac and #frac > 0 then s = s .. '.' .. frac end
    end
  end
  if value < 0 then s = '-' .. s
  elseif showSign and value > 0 then s = '+' .. s end
  return s
end

local CONV = {
  ['km/h'] = { mph = { 0.621371, 0 } },
  ['°C'] = { ['°F'] = { 1.8, 32 } },
  bar = { psi = { 14.5038, 0 } },
  psi = { bar = { 1 / 14.5038, 0 } },
  L = { gal = { 0.264172, 0 } },
}

local function convertUnit(value, from, to)
  if from == '%' then return value * 100 end
  if not to or to == from then return value end
  local c = CONV[from] and CONV[from][to]
  if not c then return value end
  return value * c[1] + c[2]
end

local function autoUnit(base)
  local units = cfg.settings.units or 'auto'
  local imperial = units == 'imperial' or (units == 'auto' and car.prefersImperialUnits)
  if not imperial then return nil end
  if base == 'km/h' then return 'mph' end
  if base == '°C' then return '°F' end
  if base == 'bar' then return 'psi' end
  if base == 'L' then return 'gal' end
  return nil
end

function ACDG.format(binding)
  if not binding.variable then return binding.staticText or '' end
  local raw = getVar(binding.variable)
  local meta = cfg.varMeta[binding.variable] or {}
  local body
  if raw == nil then
    body = '-'
  else
    local key = raw
    if type(raw) == 'number' then key = tostring(math.floor(raw + 0.5)) end
    if type(raw) == 'boolean' then key = raw and 'true' or 'false' end
    if binding.map and binding.map[key] ~= nil then
      body = binding.map[key]
    elseif type(raw) == 'boolean' then
      body = raw and 'ON' or 'OFF'
    elseif type(raw) == 'string' then
      body = raw
    elseif meta.type == 'time_ms' then
      body = formatTime(raw, binding.timeFormat)
    else
      local unit = binding.unit
      if unit == nil or unit == '' then unit = autoUnit(meta.unit) end
      body = formatNumber(convertUnit(raw, meta.unit or '', unit), binding.decimals, binding.padZeros, binding.showSign)
    end
  end
  return (binding.prefix or '') .. body .. (binding.suffix or '')
end

-- ------------------------------------------------------------
-- Reglas de estado
-- ------------------------------------------------------------

local function compare(a, op, b)
  if type(a) == 'boolean' then a = a and 1 or 0 end
  if type(b) == 'boolean' then b = b and 1 or 0 end
  if type(b) == 'string' then b = rpmValue(b) end
  if type(a) ~= 'number' or type(b) ~= 'number' then return false end
  if op == '>' then return a > b end
  if op == '>=' then return a >= b end
  if op == '<' then return a < b end
  if op == '<=' then return a <= b end
  if op == '==' then return a == b end
  if op == '!=' then return a ~= b end
  return false
end

-- Devuelve: visible, opacity, colorOverride, imageOverride
local function applyRules(el)
  local visible = el.visible ~= false
  local opacity = el.opacity or 1
  local color, image = nil, nil
  local rules = el.rules
  if rules then
    for i = 1, #rules do
      local r = rules[i]
      if compare(getVar(r.when.variable), r.when.op, r.when.value) then
        local s = r.set
        if s.visible ~= nil then visible = s.visible end
        if s.opacity ~= nil then opacity = s.opacity end
        if s.color ~= nil then color = s.color end
        if s.image ~= nil then image = s.image end
        if s.blinkHz and s.blinkHz > 0 and not blinkOn(s.blinkHz) then visible = false end
      end
    end
  end
  return visible, opacity, color, image
end

-- ------------------------------------------------------------
-- Fuentes y texto
-- ------------------------------------------------------------

local function getFont(name, bold)
  local key = (name or 'Segoe UI') .. (bold and ':b' or '')
  local f = fonts[key]
  if f then return f end
  local def = cfg.fonts[name or '']
  local dir = nil
  if def and def.dir then dir = scriptDir .. '/' .. def.dir end
  local ok, font = pcall(ui.DWriteFont, name or 'Segoe UI', dir)
  if not ok or not font then font = ui.DWriteFont('Segoe UI') end
  if bold then font = font:weight(ui.DWriteFont.Weight.Bold) end
  fonts[key] = font
  return font
end

local ALIGN_H = { left = ui.Alignment.Start, center = ui.Alignment.Center, right = ui.Alignment.End }

-- métricas por defecto (Segoe UI) si el editor no midió la fuente
local DEFAULT_METRICS = { line = 1.33, shift = -0.139 }

-- La colocación vertical no se delega a DirectWrite: se calcula aquí a partir de la altura medida del
-- texto y de las métricas que midió el editor, para que el texto quede exactamente donde se ve en él.
local function drawText(text, x, y, w, h, style, color, opacity)
  local size = style.size or 32
  ui.pushDWriteFont(getFont(style.font, style.bold))
  local m = (cfg.fontMetrics and cfg.fontMetrics[style.font or '']) or DEFAULT_METRICS
  local lineH = size * (m.line or DEFAULT_METRICS.line)
  local okM, measured = pcall(ui.measureDWriteText, text, size)
  if okM and type(measured) == 'table' and type(measured.y) == 'number' and measured.y > 0 then lineH = measured.y end
  -- línea de referencia del editor (textBaseline = 'middle') según la alineación vertical
  local va = style.valign or 'middle'
  local cy
  if va == 'top' then cy = y + size * 0.55
  elseif va == 'bottom' then cy = y + h - size * 0.55
  else cy = y + h / 2 end
  local top = cy + (m.shift or DEFAULT_METRICS.shift) * size - lineH / 2
  p1.x, p1.y = x, top
  p2.x, p2.y = x + w, top + lineH
  ui.dwriteDrawTextClipped(text, size, p1, p2,
    ALIGN_H[style.align or 'center'] or ui.Alignment.Center,
    ui.Alignment.Start, false, col(color or style.color, opacity))
  ui.popDWriteFont()
end

-- ------------------------------------------------------------
-- Dibujo de elementos
-- ------------------------------------------------------------

local draw = {}

local function segmentedBar(x, y, w, h, orientation, reverse, n, gap, radius, active, colorFn, opacity, glow)
  -- colorFn(i, isActive) -> rgbm
  local horizontal = orientation ~= 'vertical'
  local len = horizontal and w or h
  local segLen = (len - gap * (n - 1)) / n
  if segLen < 1 then segLen = 1 end
  for i = 1, n do
    local idx = reverse and (n - i + 1) or i
    local off = (i - 1) * (segLen + gap)
    if horizontal then
      p1.x, p1.y = x + off, y
      p2.x, p2.y = x + off + segLen, y + h
    else
      -- vertical: el segmento 1 está abajo
      p1.x, p1.y = x, y + h - off - segLen
      p2.x, p2.y = x + w, y + h - off
    end
    local c = colorFn(idx, idx <= active)
    if c then
      if glow and idx <= active then
        local gx, gy, gw, gh = p1.x, p1.y, p2.x - p1.x, p2.y - p1.y
        glowRect(gx, gy, gw, gh, radius, c, glow, opacity)
        p1.x, p1.y, p2.x, p2.y = gx, gy, gx + gw, gy + gh
        local lum = lightLevels(glow)
        ui.drawRectFilled(p1, p2, litCol(c, lum, opacity), radius or 0)
        coreRect(gx, gy, gw, gh, radius, glow, opacity)
      else
        ui.drawRectFilled(p1, p2, col(c, opacity), radius or 0)
      end
    end
  end
end

local U1, U2 = vec2(), vec2()

-- barra con textura: el fondo entero y la textura de llenado descubierta según frac (uv parcial)
local function imageBar(x, y, w, h, orientation, reverse, frac, fillFile, bgFile, tint, opacity)
  p1.x, p1.y = x, y
  p2.x, p2.y = x + w, y + h
  if bgFile then ui.drawImage(scriptDir .. '/' .. bgFile, p1, p2, col(WHITE, opacity)) end
  frac = clamp01(frac)
  if frac <= 0 then return end
  U1.x, U1.y = 0, 0
  U2.x, U2.y = 1, 1
  if orientation == 'vertical' then
    local fh = h * frac
    if reverse then p1.y, p2.y = y, y + fh; U2.y = frac else p1.y, p2.y = y + h - fh, y + h; U1.y = 1 - frac end
  else
    local fw = w * frac
    if reverse then p1.x, p2.x = x + w - fw, x + w; U1.x = 1 - frac else p1.x, p2.x = x, x + fw; U2.x = frac end
  end
  ui.drawImage(scriptDir .. '/' .. fillFile, p1, p2, col(tint or WHITE, opacity), U1, U2)
end

local function continuousBar(x, y, w, h, orientation, reverse, frac, radius, colorBg, colorFill, opacity)
  p1.x, p1.y = x, y
  p2.x, p2.y = x + w, y + h
  if colorBg then ui.drawRectFilled(p1, p2, col(colorBg, opacity), radius or 0) end
  frac = clamp01(frac)
  if frac <= 0 then return end
  if orientation == 'vertical' then
    local fh = h * frac
    if reverse then p1.y, p2.y = y, y + fh else p1.y, p2.y = y + h - fh, y + h end
  else
    local fw = w * frac
    if reverse then p1.x, p2.x = x + w - fw, x + w else p1.x, p2.x = x, x + fw end
  end
  ui.drawRectFilled(p1, p2, col(colorFill, opacity), radius or 0)
end

function draw.text(el, opacity, colorOverride)
  local hz = el.binding.updateHz or 0
  local text
  if hz > 0 then
    -- frecuencia propia: el texto se congela entre actualizaciones (p. ej. milésimas legibles)
    local st = state[el.id]
    if not st then st = { at = -1e9 }; state[el.id] = st end
    if st.text == nil or t - st.at >= 1 / hz then
      st.text = ACDG.format(el.binding)
      st.at = t
    end
    text = st.text
  else
    text = ACDG.format(el.binding)
  end
  drawText(text, el.x, el.y, el.width, el.height, el.style, colorOverride, opacity)
end

function draw.gear(el, opacity, colorOverride)
  local g = getVar('gear')
  local key = tostring(math.floor(num(g) + 0.5))
  local txt = (el.config.map and el.config.map[key]) or key
  local color = colorOverride
  if not color and el.config.limiterColor and car.isEngineLimiterOn then color = el.config.limiterColor end
  drawText(txt, el.x, el.y, el.width, el.height, el.config.style, color, opacity)
end

function draw.rpm_bar(el, opacity)
  local c = el.config
  local rpm = num(car.rpm)
  local minR, maxR = rpmValue(c.min), rpmValue(c.max)
  local warnR, redR = rpmValue(c.warning), rpmValue(c.redline)
  if maxR <= minR then maxR = minR + 1 end
  local frac = clamp01((rpm - minR) / (maxR - minR))
  local onLimiter = car.isEngineLimiterOn or rpm >= maxR - 1
  local limiterVisible = onLimiter and blinkOn(c.limiterBlinkHz, c.blinkDuty)
  local colors = c.colors
  local function zoneColor(r)
    if r >= redR then return colors.redline end
    if r >= warnR then return colors.warning end
    return colors.normal
  end
  if c.style == 'segments' then
    local n = math.max(1, math.floor(c.segments or 10))
    local active = math.floor(frac * n + 0.0001)
    if onLimiter then active = limiterVisible and n or 0 end
    segmentedBar(el.x, el.y, el.width, el.height, c.orientation, c.reverse, n, c.gap or 0, c.radius, active,
      function(i, isActive)
        if onLimiter then
          if limiterVisible then return colors.limiter end
          return colors.off
        end
        if not isActive then return colors.off end
        if c.perSegmentColors then
          return zoneColor(minR + (i - 0.5) / n * (maxR - minR))
        end
        return zoneColor(rpm)
      end, opacity, c.glow)
  else
    local fill = zoneColor(rpm)
    if onLimiter then
      if not limiterVisible then fill = colors.off else fill = colors.limiter end
    end
    if el.fillFile then
      imageBar(el.x, el.y, el.width, el.height, c.orientation, c.reverse, (onLimiter and not limiterVisible) and 0 or frac, el.fillFile, el.bgFile, c.tintImage and fill or nil, opacity)
    else
      continuousBar(el.x, el.y, el.width, el.height, c.orientation, c.reverse, frac, c.radius, colors.off, fill, opacity)
    end
  end
end

-- ------------------------------------------------------------
-- Luces de cambio (tira de LEDs)
-- ------------------------------------------------------------

-- posición (1..n) -> rango de encendido (0 = el primero)
local function ledRanks(n, pattern)
  local rank = {}
  if pattern == 'edges_to_center' then
    local l, r, k = 1, n, 0
    while l <= r do
      rank[l] = k; k = k + 1
      if r ~= l then rank[r] = k; k = k + 1 end
      l = l + 1; r = r - 1
    end
  elseif pattern == 'center_to_edges' then
    local mid = (n + 1) / 2
    local order = {}
    for p = 1, n do order[p] = p end
    table.sort(order, function(a, b)
      local da, db = math.abs(a - mid), math.abs(b - mid)
      if da == db then return a < b end
      return da < db
    end)
    for k, p in ipairs(order) do rank[p] = k - 1 end
  else
    for p = 1, n do rank[p] = p - 1 end
  end
  return rank
end

local function ledZoneColor(rank, zones, fallback)
  local acc = 0
  if zones then
    for i = 1, #zones do
      acc = acc + math.max(0, math.floor(zones[i].count or 0))
      if rank < acc then return zones[i].color end
    end
    if #zones > 0 then return zones[#zones].color end
  end
  return fallback
end

function draw.shift_lights(el, opacity, colorOverride, imageOverride)
  local c = el.config
  local rpm = num(car.rpm)
  local startR, endR = rpmValue(c.rpmStart), rpmValue(c.rpmEnd)
  if endR <= startR then endR = startR + 1 end
  local n = math.max(1, math.floor(c.count or 10))
  local frac = clamp01((rpm - startR) / (endR - startR))
  local active = 0
  if rpm >= startR then
    active = math.floor(frac * n + 0.0001)
    if frac < 1 then active = active + 1 end
    if active > n then active = n end
  end
  local onLimiter = car.isEngineLimiterOn or rpm >= endR
  local blink = onLimiter and (c.limiterBlinkHz or 0) > 0
  local limiterVisible = blink and blinkOn(c.limiterBlinkHz, c.blinkDuty)
  local st = state[el.id]
  if not st or st.n ~= n or st.pattern ~= c.pattern then
    st = { n = n, pattern = c.pattern, ranks = ledRanks(n, c.pattern) }
    state[el.id] = st
  end
  local vertical = c.orientation == 'vertical'
  local len = vertical and el.height or el.width
  local gap = c.gap or 0
  local size = math.max(1, (len - gap * (n - 1)) / n)
  local file = imageOverride or el.file
  for p = 1, n do
    local rank = st.ranks[p]
    local lit = rank < active
    local color
    if blink then
      lit = limiterVisible
      color = c.limiterColor
    else
      color = colorOverride or ledZoneColor(rank, c.zones, c.limiterColor)
    end
    local show = true
    if not lit then
      if c.dimOff == false then show = false end
      color = c.colorOff
    end
    if show then
      local off = (p - 1) * (size + gap)
      local lx = vertical and el.x or el.x + off
      local ly = vertical and (el.y + el.height - off - size) or el.y
      local lw = vertical and el.width or size
      local lh = vertical and size or el.height
      local lum = 1
      if lit and c.glow then
        lum = lightLevels(c.glow)
        if c.shape == 'circle' or file then glowCircle(lx + lw / 2, ly + lh / 2, math.min(lw, lh) / 2, color, c.glow, opacity)
        else glowRect(lx, ly, lw, lh, c.radius, color, c.glow, opacity) end
      end
      local fill = lit and litCol(color, lum, opacity) or col(color, opacity)
      if file then
        p1.x, p1.y = lx, ly
        p2.x, p2.y = lx + lw, ly + lh
        ui.drawImage(scriptDir .. '/' .. file, p1, p2, fill)
      elseif c.shape == 'circle' then
        p1.x, p1.y = lx + lw / 2, ly + lh / 2
        ui.drawCircleFilled(p1, math.min(lw, lh) / 2, fill, 24)
      else
        p1.x, p1.y = lx, ly
        p2.x, p2.y = lx + lw, ly + lh
        ui.drawRectFilled(p1, p2, fill, c.radius or 0)
      end
      if lit and c.glow then
        if c.shape == 'circle' or file then coreCircle(lx + lw / 2, ly + lh / 2, math.min(lw, lh) / 2, c.glow, opacity)
        else coreRect(lx, ly, lw, lh, c.radius, c.glow, opacity) end
      end
    end
  end
end

-- ------------------------------------------------------------
-- Aguja
-- ------------------------------------------------------------

local Q1, Q2, Q3, Q4 = vec2(), vec2(), vec2(), vec2()

-- gira (x, y) alrededor de (px, py) un ángulo horario en pantalla (misma fórmula que el editor)
local function rotPoint(out, px, py, x, y, ca, sa)
  local dx, dy = x - px, y - py
  out.x = px + dx * ca - dy * sa
  out.y = py + dx * sa + dy * ca
  return out
end

-- La aguja no usa ui.beginRotation/endPivotRotation (giran en sentido antihorario y con 90° de
-- desfase): se calcula la geometría girada directamente, igual que en el editor.
function draw.needle(el, opacity, colorOverride, imageOverride)
  local c = el.config
  local raw = num(getVar(c.variable))
  local st = state[el.id]
  if not st then st = { v = raw }; state[el.id] = st end
  if c.smoothingMs and c.smoothingMs > 0 then
    st.v = lerp(st.v, raw, clamp01(ACDG.dt / (c.smoothingMs / 1000)))
  else
    st.v = raw
  end
  local range = c.max - c.min
  if range == 0 then range = 1 end
  local frac = (st.v - c.min) / range
  if c.clamp ~= false then frac = clamp01(frac) end
  local angle = c.angleMin + (c.angleMax - c.angleMin) * frac + (el.rotation or 0)
  local px, py = el.x + (c.pivot and c.pivot.x or el.width / 2), el.y + (c.pivot and c.pivot.y or el.height)
  local color = colorOverride or c.color
  local file = imageOverride or el.file
  local a = math.rad(angle)
  local ca, sa = math.cos(a), math.sin(a)
  if file then
    local x0, y0, x1, y1 = el.x, el.y, el.x + el.width, el.y + el.height
    rotPoint(Q1, px, py, x0, y0, ca, sa)
    rotPoint(Q2, px, py, x1, y0, ca, sa)
    rotPoint(Q3, px, py, x1, y1, ca, sa)
    rotPoint(Q4, px, py, x0, y1, ca, sa)
    ui.drawImageQuad(scriptDir .. '/' .. file, Q1, Q2, Q3, Q4, col(color, opacity))
  else
    p1.x, p1.y = px, py
    rotPoint(p2, px, py, el.x + el.width / 2, el.y, ca, sa)
    ui.drawLine(p1, p2, col(color, opacity), c.thickness or 6)
    if (c.hubRadius or 0) > 0 then
      ui.drawCircleFilled(p1, c.hubRadius, col(c.hubColor or color, opacity), 32)
    end
  end
end

function draw.shift_light(el, opacity, colorOverride)
  local c = el.config
  local st = state[el.id]
  if not st then st = { on = false }; state[el.id] = st end
  local rpm = num(car.rpm)
  local onR, offR = rpmValue(c.rpmOn), rpmValue(c.rpmOff)
  if st.on then
    if rpm < offR then st.on = false end
  else
    if rpm >= onR then st.on = true end
  end
  local lit = st.on and blinkOn(c.blinkHz, c.blinkDuty)
  local color = lit and (colorOverride or c.colorOn) or c.colorOff
  local lum = lit and lightLevels(c.glow) or 1
  local fill = lit and litCol(color, lum, opacity) or col(color, opacity)
  local cx, cy, r = el.x + el.width / 2, el.y + el.height / 2, math.min(el.width, el.height) / 2
  if c.shape == 'circle' then
    if lit then glowCircle(cx, cy, r, color, c.glow, opacity) end
    p1.x, p1.y = cx, cy
    ui.drawCircleFilled(p1, r, fill, 32)
    if lit then coreCircle(cx, cy, r, c.glow, opacity) end
  else
    if lit then glowRect(el.x, el.y, el.width, el.height, c.radius, color, c.glow, opacity) end
    p1.x, p1.y = el.x, el.y
    p2.x, p2.y = el.x + el.width, el.y + el.height
    ui.drawRectFilled(p1, p2, fill, c.radius or 0)
    if lit then coreRect(el.x, el.y, el.width, el.height, c.radius, c.glow, opacity) end
  end
end

local function thresholdColor(value, base, thresholds)
  local color = base
  if thresholds then
    for i = 1, #thresholds do
      if value >= thresholds[i].value then color = thresholds[i].color end
    end
  end
  return color
end

function draw.bar(el, opacity, colorOverride)
  local c = el.config
  local raw = num(getVar(c.variable))
  local st = state[el.id]
  if not st then st = { v = raw }; state[el.id] = st end
  if c.smoothingMs and c.smoothingMs > 0 then
    local k = clamp01(ACDG.dt / (c.smoothingMs / 1000))
    st.v = lerp(st.v, raw, k)
  else
    st.v = raw
  end
  local value = st.v
  local range = c.max - c.min
  if range == 0 then range = 1 end
  local fill = colorOverride or thresholdColor(value, c.colorFill, c.thresholds)
  if c.bipolar then
    -- barra con centro en cero
    local frac = clamp01(math.abs(value) / math.max(math.abs(c.max), math.abs(c.min), 0.0001))
    p1.x, p1.y = el.x, el.y
    p2.x, p2.y = el.x + el.width, el.y + el.height
    ui.drawRectFilled(p1, p2, col(c.colorBg, opacity), c.radius or 0)
    if c.orientation == 'vertical' then
      local cy = el.y + el.height / 2
      local fh = el.height / 2 * frac
      if value >= 0 then p1.y, p2.y = cy - fh, cy else p1.y, p2.y = cy, cy + fh end
    else
      local cx = el.x + el.width / 2
      local fw = el.width / 2 * frac
      if value >= 0 then p1.x, p2.x = cx, cx + fw else p1.x, p2.x = cx - fw, cx end
    end
    if frac > 0 then ui.drawRectFilled(p1, p2, col(fill, opacity), c.radius or 0) end
    return
  end
  local frac = clamp01((value - c.min) / range)
  if c.style == 'segments' then
    local n = math.max(1, math.floor(c.segments or 10))
    local active = math.floor(frac * n + 0.0001)
    segmentedBar(el.x, el.y, el.width, el.height, c.orientation, c.reverse, n, c.gap or 0, c.radius, active,
      function(i, isActive)
        if isActive then return fill end
        return c.colorBg
      end, opacity)
  elseif el.fillFile then
    imageBar(el.x, el.y, el.width, el.height, c.orientation, c.reverse, frac, el.fillFile, el.bgFile, c.tintImage and fill or nil, opacity)
  else
    continuousBar(el.x, el.y, el.width, el.height, c.orientation, c.reverse, frac, c.radius, c.colorBg, fill, opacity)
  end
end

function draw.icon(el, opacity, colorOverride, imageOverride)
  local c = el.config
  local on = true
  if c.variable then
    local v = getVar(c.variable)
    if type(v) == 'number' then v = v ~= 0 end
    if c.showWhen == 'when_true' then on = v == true
    elseif c.showWhen == 'when_false' then on = v ~= true end
  end
  local color
  if on then color = colorOverride or c.colorOn
  elseif c.dimWhenOff then color = c.colorOff
  else return end
  local file = imageOverride or el.file
  if not file then return end
  p1.x, p1.y = el.x, el.y
  p2.x, p2.y = el.x + el.width, el.y + el.height
  ui.drawImage(scriptDir .. '/' .. file, p1, p2, col(color, opacity))
end

local FIT = { stretch = 0, fill = 1, fit = 2 }

-- ------------------------------------------------------------
-- Vídeo y audio (ui.MediaPlayer): un reproductor por archivo, reiniciado al entrar en la página
-- ------------------------------------------------------------

local players = {}
local mediaSupported = nil

local function mediaOk()
  if mediaSupported == nil then
    local ok, sup = pcall(function() return ui.MediaPlayer and ui.MediaPlayer.supported() end)
    mediaSupported = ok and sup == true
    if not mediaSupported then ac.warn('[ACDG] vídeo/audio no disponibles (Media Foundation)') end
  end
  return mediaSupported
end

local function getPlayer(file, cfgv)
  local pl = players[file]
  if pl ~= nil then return pl or nil end
  if not mediaOk() then players[file] = false return nil end
  local ok, p = pcall(function()
    local m = ui.MediaPlayer(scriptDir .. '/' .. file)
    m:setAutoPlay(false)
    if cfgv then
      m:setLooping(cfgv.loop == true)
      m:setMuted(cfgv.muted ~= false)
      m:setVolume(cfgv.volume or 1)
      if cfgv.rate and cfgv.rate > 0 then m:setPlaybackRate(cfgv.rate) end
    end
    return m
  end)
  if not ok or not p then
    ac.error('[ACDG] no se pudo cargar ' .. tostring(file) .. ': ' .. tostring(p))
    players[file] = false
    return nil
  end
  players[file] = p
  return p
end

local function restartVideos(page)
  if not page then return end
  for i = 1, #page.elements do
    local el = page.elements[i]
    if el.type == 'video' and el.file then
      local pl = getPlayer(el.file, el.config)
      if pl then pcall(function() pl:setCurrentTime(0); pl:play() end) end
    end
  end
end

local function pauseVideos(page)
  if not page then return end
  for i = 1, #page.elements do
    local el = page.elements[i]
    if el.type == 'video' and el.file then
      local pl = players[el.file]
      if pl then pcall(function() pl:pause() end) end
    end
  end
end

function draw.video(el, opacity, colorOverride)
  if not el.file then return end
  local pl = getPlayer(el.file, el.config)
  if not pl then return end
  if el.config.onEnd == 'hide' and not el.config.loop then
    local ok, ended = pcall(function() return pl:ended() end)
    if ok and ended then return end
  end
  p1.x, p1.y = el.x, el.y
  p2.x, p2.y = el.x + el.width, el.y + el.height
  ui.drawImage(pl, p1, p2, col(colorOverride or el.config.tint, opacity), VEC0, VEC1, FIT[el.config.fit or 'fit'] or 2)
end

function draw.image(el, opacity, colorOverride, imageOverride)
  local file = imageOverride or el.file
  if not file or file == '' then return end
  p1.x, p1.y = el.x, el.y
  p2.x, p2.y = el.x + el.width, el.y + el.height
  ui.drawImage(scriptDir .. '/' .. file, p1, p2, col(colorOverride or el.config.tint, opacity), VEC0, VEC1, FIT[el.config.fit or 'stretch'] or 0)
end

function draw.rect(el, opacity, colorOverride)
  local c = el.config
  p1.x, p1.y = el.x, el.y
  p2.x, p2.y = el.x + el.width, el.y + el.height
  ui.drawRectFilled(p1, p2, col(colorOverride or c.fill, opacity), c.radius or 0)
  if c.strokeWidth and c.strokeWidth > 0 then
    ui.drawRect(p1, p2, col(c.stroke, opacity), c.radius or 0, nil, c.strokeWidth)
  end
end

function draw.line(el, opacity, colorOverride)
  local c = el.config
  p1.x, p1.y = el.x, el.y + el.height / 2
  p2.x, p2.y = el.x + el.width, el.y + el.height / 2
  ui.drawLine(p1, p2, col(colorOverride or c.color, opacity), c.thickness or 2)
end

function draw.circle(el, opacity, colorOverride)
  local c = el.config
  p1.x, p1.y = el.x + el.width / 2, el.y + el.height / 2
  local r = math.min(el.width, el.height) / 2
  ui.drawCircleFilled(p1, r, col(colorOverride or c.fill, opacity), 48)
  if c.strokeWidth and c.strokeWidth > 0 then
    ui.drawCircle(p1, r, col(c.stroke, opacity), 48, c.strokeWidth)
  end
end

function draw.gauge(el, opacity, colorOverride)
  local c = el.config
  local value = num(getVar(c.variable))
  local range = c.max - c.min
  if range == 0 then range = 1 end
  local frac = clamp01((value - c.min) / range)
  local cx, cy = el.x + el.width / 2, el.y + el.height / 2
  local radius = math.min(el.width, el.height) / 2 - (c.thickness or 10) / 2
  local a0 = math.rad(c.startAngle or 135)
  local a1 = math.rad(c.endAngle or 405)
  if c.clockwise == false then a0, a1 = a1, a0 end
  local fill = colorOverride or thresholdColor(value, c.color, c.thresholds)
  p1.x, p1.y = cx, cy
  local segs = 48
  if c.style == 'segments' then
    local n = math.max(1, math.floor(c.segments or 10))
    local active = math.floor(frac * n + 0.0001)
    local sweep = (a1 - a0) / n
    local gapA = math.rad(c.gap or 2)
    for i = 1, n do
      local s0 = a0 + (i - 1) * sweep + gapA / 2
      local s1 = a0 + i * sweep - gapA / 2
      ui.pathClear()
      ui.pathArcTo(p1, radius, s0, s1, 8)
      ui.pathStroke(col(i <= active and fill or c.bgColor, opacity), false, c.thickness or 10)
    end
  else
    ui.pathClear()
    ui.pathArcTo(p1, radius, a0, a1, segs)
    ui.pathStroke(col(c.bgColor, opacity), false, c.thickness or 10)
    if frac > 0 then
      ui.pathClear()
      ui.pathArcTo(p1, radius, a0, a0 + (a1 - a0) * frac, math.max(2, math.floor(segs * frac)))
      ui.pathStroke(col(fill, opacity), false, c.thickness or 10)
    end
  end
end

local currentPageDuration = nil

-- Botón táctil: fondo según el estado (normal / puntero encima / pulsado / encendido), imagen y texto.
function draw.button(el, opacity, colorOverride, imageOverride)
  local c = el.config
  local lit = c.litWhenOn ~= false and el.stateVar ~= nil and getVar(el.stateVar) == true
  local active = touch.active == el.id
  local hovered = touch.hover == el.id
  local fill = c.fill
  if active then fill = c.fillActive or fill
  elseif lit then fill = c.fillOn or fill
  elseif hovered then fill = c.fillHover or fill end
  if colorOverride then fill = colorOverride end
  local shape = c.shape or 'rect'
  local radius = c.radius or 0
  local cx, cy = el.x + el.width / 2, el.y + el.height / 2
  local rad = math.min(el.width, el.height) / 2
  local lum = 1
  if lit and c.glow then lum = lightLevels(c.glow) end
  if shape ~= 'none' then
    if lit and c.glow then
      if shape == 'circle' then glowCircle(cx, cy, rad, fill, c.glow, opacity)
      else glowRect(el.x, el.y, el.width, el.height, radius, fill, c.glow, opacity) end
    end
    if shape == 'circle' then
      p1.x, p1.y = cx, cy
      ui.drawCircleFilled(p1, rad, litCol(fill, lum, opacity), 48)
      if (c.strokeWidth or 0) > 0 then ui.drawCircle(p1, rad, col(c.stroke, opacity), 48, c.strokeWidth) end
    else
      p1.x, p1.y = el.x, el.y
      p2.x, p2.y = el.x + el.width, el.y + el.height
      ui.drawRectFilled(p1, p2, litCol(fill, lum, opacity), radius)
      if (c.strokeWidth or 0) > 0 then ui.drawRect(p1, p2, col(c.stroke, opacity), radius, nil, c.strokeWidth) end
    end
    if lit and c.glow then
      if shape == 'circle' then coreCircle(cx, cy, rad, c.glow, opacity)
      else coreRect(el.x, el.y, el.width, el.height, radius, c.glow, opacity) end
    end
  end
  local file = imageOverride or (lit and el.fileOn) or el.file
  if file and file ~= '' then
    p1.x, p1.y = el.x, el.y
    p2.x, p2.y = el.x + el.width, el.y + el.height
    ui.drawImage(scriptDir .. '/' .. file, p1, p2, col(WHITE, opacity), VEC0, VEC1, FIT.fit)
  end
  local label = c.label or ''
  if lit and c.labelOn and c.labelOn ~= '' then label = c.labelOn end
  if label ~= '' and c.style then
    drawText(label, el.x, el.y, el.width, el.height, c.style, lit and c.colorOn or c.style.color, opacity)
  end
end

local function drawElement(el)
  local visible, opacity, colorOverride, imageOverride = applyRules(el)
  if not visible or opacity <= 0 then return end
  local fn = draw[el.type]
  if not fn then return end
  -- animación de entrada/salida respecto al tiempo en la página
  local a = el.anim
  local dx, dy = 0, 0
  if a then
    local pt = t - pageEnteredAt
    if pt < (a.delay or 0) then return end
    local k = 1
    if (a.fadeIn or 0) > 0 then k = clamp01((pt - (a.delay or 0)) / a.fadeIn) end
    if (a.fadeOut or 0) > 0 and currentPageDuration then
      local rem = currentPageDuration - pt
      if rem < a.fadeOut then k = math.min(k, clamp01(rem / a.fadeOut)) end
    end
    if k <= 0 then return end
    opacity = opacity * k
    local d = (a.distance or 60) * (1 - k)
    if a.from == 'up' then dy = -d elseif a.from == 'down' then dy = d elseif a.from == 'left' then dx = -d elseif a.from == 'right' then dx = d end
  end
  local ox, oy = el.x, el.y
  el.x, el.y = ox + dx, oy + dy
  local rot = el.rotation or 0
  if el.type == 'needle' then rot = 0 end -- la aguja gira sobre su propio eje
  if rot ~= 0 then ui.beginRotation() end
  fn(el, opacity, colorOverride, imageOverride)
  if rot ~= 0 then
    p1.x, p1.y = el.x + el.width / 2, el.y + el.height / 2
    -- endPivotRotation gira en sentido antihorario y con 90° de desfase ("restar 90 para que actúe normal")
    ui.endPivotRotation(90 - rot, p1)
  end
  el.x, el.y = ox, oy
end

-- ------------------------------------------------------------
-- Páginas: arranque (secuencia) > funcionalidad (activador, prioridad) > condición automática > botón
-- ------------------------------------------------------------

local manualPage = 1
local lastButton = false
local pageStorage = nil
local normalPages = {}   -- índices de páginas normales (botón/condición)
local bootPages = {}     -- índices de pantallas de arranque, en orden
local funcPages = {}     -- índices de pantallas de funcionalidad, por prioridad descendente
local boot = { active = false, idx = 0, startedAt = 0 }
local edges = {}         -- último estado de cada entrada (para detectar pulsaciones)
local toggles = {}       -- estado de las pantallas conmutables/enclavadas por id de página
local lastRpm = 0
local currentPageRef = nil
local previousPageRef = nil
local trans = { from = nil, startedAt = -1e9 }
local bootSound = nil

local function initPages()
  manualPage = 1
  normalPages, bootPages, funcPages = {}, {}, {}
  for i = 1, #cfg.pages do
    local p = cfg.pages[i]
    if p.kind == 'boot' then bootPages[#bootPages + 1] = i
    elseif p.kind == 'function' and p.trigger then funcPages[#funcPages + 1] = i
    else normalPages[#normalPages + 1] = i end
  end
  table.sort(funcPages, function(a, b)
    local pa, pb = cfg.pages[a].trigger.priority or 0, cfg.pages[b].trigger.priority or 0
    if pa == pb then return a < b end
    return pa > pb
  end)
  local ps = cfg.settings.pageSwitch
  if ps and ps.remember and ps.input ~= 'none' and ac.storage then
    local ok, st = pcall(ac.storage, { page = 1 })
    if ok and st then
      pageStorage = st
      manualPage = math.max(1, math.min(math.max(1, #normalPages), tonumber(st.page) or 1))
    end
  end
  toggles = {}
  edges = {}
  boot.active = false
end

-- flanco de subida de una entrada booleana (una consulta por frame y clave)
local function pressed(key, value)
  local was = edges[key] == true
  edges[key] = value == true
  return value == true and not was
end

local function condsAll(list)
  if not list then return true end
  for i = 1, #list do
    local c = list[i]
    if not compare(getVar(c.variable), c.op, c.value) then return false end
  end
  return true
end

local function condsAny(list)
  if not list then return false end
  for i = 1, #list do
    local c = list[i]
    if compare(getVar(c.variable), c.op, c.value) then return true end
  end
  return false
end

local function bootSettings()
  return cfg.settings.boot or {}
end

local function startBoot()
  if #bootPages == 0 then return end
  local bs = bootSettings()
  if bs.skipInReplay ~= false and sim and sim.isReplayActive == true then return end
  boot.active = true
  boot.idx = 1
  boot.startedAt = t
  if bs.sound and mediaOk() then
    if not bootSound then
      local ok, p = pcall(function()
        local m = ui.MediaPlayer(scriptDir .. '/' .. bs.sound)
        m:setAutoPlay(false)
        m:setVolume(bs.soundVolume or 1)
        return m
      end)
      if ok then bootSound = p end
    end
    if bootSound then pcall(function() bootSound:setCurrentTime(0); bootSound:play() end) end
  end
end

function ACDG.startBoot()
  startBoot()
end

local function resolveBoot()
  local bs = bootSettings()
  if boot.active then
    local pg = cfg.pages[bootPages[boot.idx]]
    local skip = false
    if bs.skipButton and bs.skipButton ~= 'none' and pressed('boot:skip', getVar(bs.skipButton)) then skip = true end
    if (bs.skipSpeedKmh or 0) > 0 and num(car.speedKmh) > bs.skipSpeedKmh then skip = true end
    if skip then
      boot.active = false
    elseif t - boot.startedAt >= (pg.duration or 3) then
      boot.idx = boot.idx + 1
      boot.startedAt = t
      if boot.idx > #bootPages then boot.active = false end
    end
    if boot.active then return cfg.pages[bootPages[boot.idx]] end
    return nil
  end
  if bs.replayButton and bs.replayButton ~= 'none' and pressed('boot:replay', getVar(bs.replayButton)) then
    startBoot()
    if boot.active then return cfg.pages[bootPages[1]] end
  end
  if bs.engineStart then
    local rpm = num(car.rpm)
    if lastRpm < 100 and rpm > 300 then
      startBoot()
      lastRpm = rpm
      if boot.active then return cfg.pages[bootPages[1]] end
    end
    lastRpm = rpm
  end
  return nil
end

local function resolveFunction()
  for i = 1, #funcPages do
    local pg = cfg.pages[funcPages[i]]
    local tr = pg.trigger
    local input = getVar(tr.input) == true
    local active
    if tr.mode == 'hold' or tr.mode == nil then
      active = input and condsAll(tr.enter)
    else
      local st = toggles[pg.id]
      if not st then st = { on = false, since = 0 }; toggles[pg.id] = st end
      local edge = pressed('fn:' .. pg.id, input)
      if st.on then
        if condsAny(tr.exit) or ((tr.exitAfterS or 0) > 0 and t - st.since > tr.exitAfterS) or (tr.mode == 'toggle' and edge) then
          st.on = false
        end
      elseif edge and condsAll(tr.enter) then
        st.on = true
        st.since = t
      end
      active = st.on
    end
    if active then return pg end
  end
  return nil
end

local function resolveNormal()
  local n = #normalPages
  if n == 0 then return nil end
  for i = 1, n do
    local pg = cfg.pages[normalPages[i]]
    local w = pg.when
    if w and compare(getVar(w.variable), w.op, w.value) then return pg end
    if pg.whenAny and condsAny(pg.whenAny) then return pg end
  end
  local ps = cfg.settings.pageSwitch
  if ps and ps.input and ps.input ~= 'none' then
    local pr = car[ps.input] == true
    if pr and not lastButton then
      manualPage = manualPage + 1
      if manualPage > n then manualPage = ps.wrap == false and n or 1 end
      if pageStorage then pageStorage.page = manualPage end
    end
    lastButton = pr
  end
  if manualPage > n then manualPage = 1 end
  return cfg.pages[normalPages[manualPage]]
end

local function currentPage()
  if #cfg.pages == 0 then return nil end
  local page = resolveBoot() or resolveFunction() or resolveNormal() or cfg.pages[1]
  if page ~= currentPageRef then
    -- cambio de página: tiempos, velocidad de entrada, vídeos y transición
    pauseVideos(currentPageRef)
    local returnPrev = currentPageRef and currentPageRef.trigger and currentPageRef.trigger.returnTo == 'previous' and previousPageRef
    if returnPrev and page ~= previousPageRef and page.kind ~= 'boot' and not page.trigger then
      -- al salir de una pantalla de funcionalidad se vuelve a la anterior (si sigue disponible)
      if previousPageRef.kind ~= 'function' then page = previousPageRef end
    end
    previousPageRef = currentPageRef
    trans.from = currentPageRef
    trans.startedAt = t
    currentPageRef = page
    pageEnteredAt = t
    pageEntrySpeed = num(car.speedKmh)
    currentPageDuration = page.kind == 'boot' and (page.duration or 3) or nil
    restartVideos(page)
    varCache.page_time = nil
    varCache.page_entry_speed = nil
  end
  return page
end

function ACDG.setPage(i)
  manualPage = math.max(1, math.min(math.max(1, #normalPages), i))
end

-- ------------------------------------------------------------
-- Táctil: puntero sobre la malla y acciones de los botones
-- ------------------------------------------------------------

local STRIPS = 8   -- franjas verticales con las que se detecta un deslizamiento (solo con ui.rectHovered)

-- las funciones de puntero de CSP devuelven booleanos: se comparan con true para no tomar 0 por verdadero
local function uiFlag(fn, a, b, c)
  if type(fn) ~= 'function' then return false end
  local ok, r = pcall(fn, a, b, c)
  return ok and r == true
end

local function rectHovered(x, y, w, h)
  p1.x, p1.y = x, y
  p2.x, p2.y = x + w, y + h
  return uiFlag(ui.rectHovered, p1, p2, false)
end

local function touchStrip()
  local w = W / STRIPS
  for i = 0, STRIPS - 1 do
    if rectHovered(i * w, 0, w, H) then return i end
  end
  return -1
end

local function normalIndexOf(pageId)
  for i = 1, #normalPages do
    if cfg.pages[normalPages[i]].id == pageId then return i end
  end
  return nil
end

local function gotoNormal(i)
  local n = #normalPages
  if n == 0 then return end
  if i < 1 then i = 1 elseif i > n then i = n end
  if i ~= manualPage then touch.prevManual = manualPage end
  manualPage = i
  if pageStorage then pageStorage.page = manualPage end
end

local function stepPage(d)
  local n = #normalPages
  if n <= 1 then return end
  local wrap = not (cfg.settings.pageSwitch and cfg.settings.pageSwitch.wrap == false)
  local i = manualPage + d
  if i > n then i = wrap and 1 or n elseif i < 1 then i = wrap and n or 1 end
  gotoNormal(i)
end

local actionErrors = {}

-- llamada a la API de control de CSP por nombre (ac.setKERS, ac.setHeadlights…): si la función no
-- existe en esta versión de CSP o falla, no se rompe el display, pero queda en el log (una vez)
local function call(name, a, b)
  local fn = ac[name]
  if type(fn) ~= 'function' then
    if not actionErrors[name] then
      actionErrors[name] = true
      ac.error('[ACDG] acción táctil: esta versión de CSP no tiene ac.' .. tostring(name) .. '()')
    end
    return
  end
  local ok, err = pcall(fn, a, b)
  if not ok then
    local key = name .. ': ' .. tostring(err)
    if not actionErrors[key] then
      actionErrors[key] = true
      ac.error('[ACDG] acción táctil ' .. key)
    end
  end
end

local function setSwitch(k, v)
  touch.sw[k] = v == true
  varCache['touch_' .. k] = nil
  if touch.storage then touch.storage['sw_' .. k] = v and 1 or 0 end
end

local function cycle(value, delta, count)
  local n = math.max(1, math.floor(count or 1))
  local v = math.floor(value + delta)
  if v >= n then v = 0 elseif v < 0 then v = n - 1 end
  return v
end

local function step(el, fallback)
  local v = el.config.step or 0
  if v > 0 then return v end
  return fallback
end

-- press = al pulsar (y en cada repetición); hold = cada frame mientras se mantiene; release = al soltar
local ACTIONS = {
  none = {},
  page_next = { press = function() stepPage(1) end },
  page_prev = { press = function() stepPage(-1) end },
  page_first = { press = function() gotoNormal(1) end },
  page_go = { press = function(el) local i = normalIndexOf(el.config.pageId) if i then gotoNormal(i) end end },
  page_back = { press = function() gotoNormal(touch.prevManual or 1) end },
  boot_replay = { press = function() ACDG.startBoot() end },
  switch_toggle = { press = function(el) local k = el.switchKey or 'a' setSwitch(k, not (touch.sw[k] == true)) end },
  switch_on = { press = function(el) setSwitch(el.switchKey or 'a', true) end },
  switch_off = { press = function(el) setSwitch(el.switchKey or 'a', false) end },
  headlights = { press = function() call('setHeadlights', car.headlightsActive ~= true) end },
  high_beams = { press = function() call('setHighBeams', car.highBeams ~= true) end },
  daytime = { press = function() touch.daytime = not touch.daytime call('setDaytimeLights', touch.daytime) end },
  flash = { press = function() call('flashLights') end },
  turn_left = { press = function() call('setTurningLights', car.turningLeftLights == true and 0 or 1) end },
  turn_right = { press = function() call('setTurningLights', car.turningRightLights == true and 0 or 2) end },
  hazards = { press = function() call('setTurningLights', car.hazardLights == true and 0 or 3) end },
  turn_off = { press = function() call('setTurningLights', 0) end },
  wipers_next = { press = function() call('setWiperMode', cycle(num(car.wiperMode), 1, num(car.wiperModes))) end },
  wipers_off = { press = function() call('setWiperMode', 0) end },
  kers = {
    press = function() call('setKERS', true) end,
    hold = function() call('setKERS', true) end,
    release = function() call('setKERS', false) end,
  },
  drs = { press = function() call('setDRS', car.drsActive ~= true) end },
  mguk_delivery_up = { press = function() call('setMGUKDelivery', cycle(num(car.mgukDelivery), 1, num(car.mgukDeliveryCount))) end },
  mguk_delivery_down = { press = function() call('setMGUKDelivery', cycle(num(car.mgukDelivery), -1, num(car.mgukDeliveryCount))) end },
  mguk_recovery_up = { press = function() call('setMGUKRecovery', math.min(10, num(car.mgukRecovery) + 1)) end },
  mguk_recovery_down = { press = function() call('setMGUKRecovery', math.max(0, num(car.mgukRecovery) - 1)) end },
  mguh_toggle = { press = function() call('setMGUHCharging', car.mguhChargingBatteries ~= true) end },
  tc_up = { press = function() call('setTractionControl', cycle(num(car.tractionControlMode), 1, num(car.tractionControlModes) + 1)) end },
  tc_down = { press = function() call('setTractionControl', cycle(num(car.tractionControlMode), -1, num(car.tractionControlModes) + 1)) end },
  abs_up = { press = function() call('setABS', cycle(num(car.absMode), 1, num(car.absModes) + 1)) end },
  abs_down = { press = function() call('setABS', cycle(num(car.absMode), -1, num(car.absModes) + 1)) end },
  brake_bias_up = { press = function(el) call('setBrakeBias', math.min(1, num(car.brakeBias) + step(el, 0.005))) end },
  brake_bias_down = { press = function(el) call('setBrakeBias', math.max(0, num(car.brakeBias) - step(el, 0.005))) end },
  engine_brake_up = { press = function()
    touch.engineBrake = cycle(touch.engineBrake, 1, math.max(1, num(car.engineBrakeSettingsCount)))
    call('setEngineBrakeSetting', touch.engineBrake)
  end },
  engine_brake_down = { press = function()
    touch.engineBrake = cycle(touch.engineBrake, -1, math.max(1, num(car.engineBrakeSettingsCount)))
    call('setEngineBrakeSetting', touch.engineBrake)
  end },
  neutral = { press = function() call('switchToNeutralGear') end },
  autoshifter = { press = function() call('setAutoShifter', car.autoShift ~= true) end },
  extra_a = { press = function() call('setExtraSwitch', 0, car.extraA ~= true) end },
  extra_b = { press = function() call('setExtraSwitch', 1, car.extraB ~= true) end },
  extra_c = { press = function() call('setExtraSwitch', 2, car.extraC ~= true) end },
  extra_d = { press = function() call('setExtraSwitch', 3, car.extraD ~= true) end },
}

local pressLogged = {}

local function fire(el, phase)
  local def = ACTIONS[el.config.action or 'none']
  if not def then return end
  local fn = def[phase]
  if not fn then return end
  -- la primera pulsación de cada botón queda en el log de CSP: sirve para comprobar que el táctil
  -- llega al script aunque la acción no se note en el coche
  if phase == 'press' and not pressLogged[el.id] then
    pressLogged[el.id] = true
    ac.warn('[ACDG] botón "' .. tostring(el.name or el.id) .. '" pulsado → ' .. tostring(el.config.action))
  end
  fn(el)
end

-- ------------------------------------------------------------
-- Botones físicos: mallas del coche que se pulsan con el ratón (ac.isMeshPressed hace el raycast,
-- y solo mientras el ratón está pulsado, así que no cuesta nada el resto del tiempo).
-- ------------------------------------------------------------

local physical = {}   -- estado por botón físico: { down, nextRepeat, uvFrom, uvSize, pos }

local function initPhysical()
  physical = {}
  local list = cfg.physicalButtons
  if type(list) ~= 'table' then return end
  for i = 1, #list do
    local b = list[i]
    local st = { down = false, nextRepeat = 0 }
    if b.uv then
      st.uvFrom = vec2(b.uv.x or 0, b.uv.y or 0)
      st.uvSize = vec2(b.uv.width or 1, b.uv.height or 1)
    end
    if b.point and b.radius then st.pos = vec3(b.point.x or 0, b.point.y or 0, b.point.z or 0) end
    physical[i] = st
  end
end

local function meshPressed(b, st)
  local ok, r = pcall(ac.isMeshPressed, b.mesh, st.uvFrom, st.uvSize, st.pos, b.radius, b.localPoint == true)
  if not ok then
    if not actionErrors['isMeshPressed'] then
      actionErrors['isMeshPressed'] = true
      ac.error('[ACDG] botones físicos: ' .. tostring(r))
    end
    return false
  end
  return r == true
end

local function updatePhysical()
  local list = cfg.physicalButtons
  if type(list) ~= 'table' then return end
  for i = 1, #list do
    local b = list[i]
    local st = physical[i]
    if st then
      local down = meshPressed(b, st)
      local behavior = b.config.behavior or 'tap'
      if down and not st.down then
        st.nextRepeat = tReal + math.max(0.05, (b.config.repeatMs or 250) / 1000)
        fire(b, 'press')
      elseif down then
        if behavior == 'hold' then
          fire(b, 'hold')
        elseif behavior == 'repeat' and tReal >= st.nextRepeat then
          st.nextRepeat = tReal + math.max(0.05, (b.config.repeatMs or 250) / 1000)
          fire(b, 'press')
        end
      elseif st.down then
        fire(b, 'release')
      end
      st.down = down
    end
  end
end

local function initTouch()
  local tc = cfg.settings.touch
  touch.on = tc ~= nil and tc.enabled == true
  touch.hover, touch.active, touch.pressStrip = nil, nil, -1
  touch.prevManual, touch.engineBrake, touch.daytime = nil, 0, false
  touch.wasDown = false
  touch.sw, touch.storage = {}, nil
  if not tc or type(tc.switches) ~= 'table' then return end
  local defaults, any = {}, false
  for k, def in pairs(tc.switches) do
    touch.sw[k] = def.initial == true
    if def.remember then
      defaults['sw_' .. k] = def.initial and 1 or 0
      any = true
    end
  end
  if any and ac.storage then
    local ok, st = pcall(ac.storage, defaults)
    if ok and st then
      touch.storage = st
      for k, def in pairs(tc.switches) do
        if def.remember then touch.sw[k] = num(st['sw_' .. k]) >= 0.5 end
      end
    end
  end
end

-- Lectura del puntero: se hace a la frecuencia real del juego (aunque se salten frames de dibujo) para
-- no perder pulsaciones, y sobre la página que el jugador está viendo.
local function updateTouch()
  if not touch.on then
    touch.hover, touch.active = nil, nil
    return
  end
  local page = currentPageRef or cfg.pages[1]
  local tc = cfg.settings.touch or {}
  local down = uiFlag(ui.mouseDown)
  -- el flanco se calcula aquí y no solo con ui.mouseClicked(): con SKIP_FRAMES (o pocos Hz de
  -- refresco) el script no se ejecuta en todos los frames y ese aviso se perdería
  local clicked = uiFlag(ui.mouseClicked) or (down and not touch.wasDown)
  touch.wasDown = down

  -- botón bajo el puntero (cuesta un raycast: solo se busca si hace falta)
  local hovered = nil
  if page and (down or clicked or tc.hover ~= false) then
    local els = page.elements
    for i = #els, 1, -1 do
      local el = els[i]
      if el.type == 'button' then
        local visible, opacity = applyRules(el)
        if visible and opacity > 0 then
          local pad = el.config.padding or 0
          if rectHovered(el.x - pad, el.y - pad, el.width + 2 * pad, el.height + 2 * pad) then
            hovered = el
            break
          end
        end
      end
    end
  end
  touch.hover = hovered and hovered.id or nil

  -- botón que se estaba pulsando
  local act = nil
  if touch.active and page then
    for i = 1, #page.elements do
      if page.elements[i].id == touch.active then act = page.elements[i] break end
    end
  end
  if act and (not down or hovered == nil or hovered.id ~= act.id) then
    fire(act, 'release')
    touch.active, act = nil, nil
  end
  if clicked and hovered then
    touch.active = hovered.id
    touch.nextRepeat = tReal + math.max(0.05, (hovered.config.repeatMs or 250) / 1000)
    fire(hovered, 'press')
  elseif act then
    local b = act.config.behavior or 'tap'
    if b == 'hold' then
      fire(act, 'hold')
    elseif b == 'repeat' and tReal >= touch.nextRepeat then
      touch.nextRepeat = tReal + math.max(0.05, (act.config.repeatMs or 250) / 1000)
      fire(act, 'press')
    end
  end

  -- gesto: deslizar en horizontal cambia de página (si la pulsación no era de un botón)
  if tc.swipePages then
    if clicked and not hovered then touch.pressStrip = touchStrip() end
    if touch.pressStrip >= 0 and not down then
      local to = touchStrip()
      local need = math.max(1, math.ceil((tc.swipePct or 25) / (100 / STRIPS)))
      if to >= 0 and math.abs(to - touch.pressStrip) >= need then
        stepPage(to > touch.pressStrip and -1 or 1)
      end
      touch.pressStrip = -1
    end
  end
end

-- ------------------------------------------------------------
-- Ciclo de vida
-- ------------------------------------------------------------

function ACDG.init(config, dir)
  cfg = config
  scriptDir = dir or '.'
  convertColors(cfg)
  W, H = cfg.display.width, cfg.display.height
  brightness = cfg.settings.brightness or 1
  cfg.vars = cfg.vars or {}
  cfg.varMeta = cfg.varMeta or {}
  cfg.fonts = cfg.fonts or {}
  cfg.defaults = cfg.defaults or {}
  cfg.pages = cfg.pages or {}
  state = {}
  fonts = {}
  initPages()
  initTouch()
  initPhysical()
  currentPageRef = nil
  previousPageRef = nil
  pageEnteredAt = t
  startBoot()
end

function ACDG.setBrightness(b)
  brightness = b
end

local function updateNight(dt)
  local s = cfg.settings
  local target = 1
  if s.nightMode == 'headlights' then
    if car.headlightsActive then target = s.nightBrightness or 0.6 end
  elseif s.nightMode == 'time' then
    local h = num(sim.timeHours) + num(sim.timeMinutes) / 60
    if h < 7 or h >= 20 then target = s.nightBrightness or 0.6 end
  end
  nightTarget = target
  nightCurrent = lerp(nightCurrent, nightTarget, clamp01(dt * 2))
end

ACDG.dt = 0
local refreshAcc = 0

local touchErrorLogged = false

function ACDG.update(dt)
  if not cfg then return end
  tReal = tReal + dt
  -- rendimiento: coches lejanos y no enfocados no se actualizan
  local maxD = cfg.display.maxDistance or 50
  if not car.focused and num(car.distanceToCamera) > maxD then
    ac.skipFrame()
    return
  end
  -- táctil y botones físicos: se leen a la frecuencia del juego, incluso en los frames que no se
  -- dibujan (los botones físicos no necesitan que la pantalla sea táctil)
  local hasPhysical = type(cfg.physicalButtons) == 'table' and #cfg.physicalButtons > 0
  if touch.on or hasPhysical then
    for k in pairs(varCache) do varCache[k] = nil end
    local okT, errT = pcall(function()
      if touch.on then updateTouch() end
      if hasPhysical then updatePhysical() end
    end)
    if not okT and not touchErrorLogged then
      touchErrorLogged = true
      ac.error('[ACDG] táctil: ' .. tostring(errT))
    end
  end
  -- frecuencia de refresco: entre actualizaciones se conserva el frame anterior
  local hz = cfg.settings.refreshHz or 0
  if hz > 0 then
    refreshAcc = refreshAcc + dt
    local period = 1 / hz
    if refreshAcc < period then
      ac.skipFrame()
      return
    end
    refreshAcc = refreshAcc - period
    if refreshAcc > period then refreshAcc = 0 end
    -- t avanza solo cuando se dibuja (misma semántica que el editor)
    dt = period
  end
  ACDG.dt = dt
  t = t + dt
  physicsOk = car.physicsAvailable ~= false
  for k in pairs(varCache) do varCache[k] = nil end
  updateNight(dt)

  -- fondo: siempre se repinta entero (evita rastros con KEEP_BACKGROUND=1 e imágenes con alfa)
  p1.x, p1.y = 0, 0
  p2.x, p2.y = W, H
  if cfg.background.color then
    local c = col(cfg.background.color, 1)
    c.mult = 1
    ui.drawRectFilled(p1, p2, c)
  end
  if cfg.background.file then
    ui.drawImage(scriptDir .. '/' .. cfg.background.file, p1, p2, col(WHITE, 1))
  end

  local page = currentPage()
  if not page then return end
  local bs = bootSettings()
  local fadeS = bs.transition == 'fade' and (bs.transitionS or 0) or 0
  local k = 1
  if fadeS > 0 and trans.from and t - trans.startedAt < fadeS then
    k = clamp01((t - trans.startedAt) / fadeS)
    -- la página anterior se desvanece debajo (sus tiempos siguen congelados en el último estado)
    pageAlpha = 1 - k
    local prev = trans.from.elements
    for i = 1, #prev do
      if prev[i].type ~= 'video' then drawElement(prev[i]) end
    end
  end
  pageAlpha = k
  local els = page.elements
  for i = 1, #els do
    drawElement(els[i])
  end
  pageAlpha = 1
end

return ACDG
