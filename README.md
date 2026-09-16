# AC Display Generator

Editor visual (WYSIWYG) y generador de displays para Assetto Corsa con Custom Shaders Patch. El usuario elige el coche, carga la imagen del display, coloca datos, barras e iconos, previsualiza y genera automáticamente el paquete CSP + Lua e instala en el vehículo — sin escribir Lua ni tocar `ext_config.ini` a mano.

Requerimientos completos: [docs/REQUERIMIENTOS_v2.md](docs/REQUERIMIENTOS_v2.md).

## Estado (v0.1 — MVP en construcción)

Funciona de punta a punta:

- Detección de Assetto Corsa (Steam), listado de vehículos con logo, validación de carpeta (`data/` o `data.acd`, kn5, `ui_car.json`).
- Análisis automático de `extension/` al elegir el coche: lee `ext_config.ini` y sus `[INCLUDE]`, localiza todas las secciones `[SCRIPTABLE_DISPLAY…]` (también en `.ini` sueltos), comprueba los scripts Lua (existencia y sintaxis) y decide solo: si el display lo generó la app se abre su proyecto; si es un display hecho a mano se importa por completo: malla, resolución e imagen deducidas del ini/script/kn5, y **el script Lua se ejecuta en una máquina virtual aislada (wasmoon)** con `car`/`sim` simulados para convertir cada texto, barra, imagen e icono en elementos del editor (variables detectadas perturbando cada campo leído, formatos, colores, zonas rojas, orden de dibujo); si no hay nada se crea desde cero y `ext_config.ini` se genera al instalar. Al instalar sobre una malla que ya tiene display se ofrece desactivar la sección original (reversible al desinstalar).
- Perfiles `display_profile.json` v2 (en el coche, biblioteca local o incluidos con la app) validados con esquema; al instalar se guarda el perfil en el coche si no existía.
- Modo creador básico: lee el `.kn5`, lista mallas/materiales y rellena la resolución con la textura del material.
- Imagen de fondo PNG/JPG/DDS (DXT1/DXT5/RGBA8 decodificados en la app) con comprobación de resolución y alfa.
- Editor: zoom/pan, arrastrar, tiradores, selección múltiple, marco, rejilla, ajuste a bordes/centros/elementos con guías, deshacer/rehacer, copiar/pegar/duplicar, capas (orden, ocultar, bloquear, renombrar), alinear/distribuir, atajos.
- Catálogo de datos: ~70 variables seleccionadas con etiquetas en español + **todos los campos numéricos/booleanos del SDK de CSP** (`car`, `car.wheels[i]`, `sim`, sesión; ~500 más) generados con `tools/gen_variables.py` y seleccionables desde un buscador.
- Elementos: texto dinámico, marcha, barra RPM (segmentos/continua, zonas, limitador), shift light (histéresis, parpadeo), barra genérica (umbrales, bipolar, suavizado), indicador circular, icono (23 integrados + importados), imagen, rectángulo, círculo, línea; reglas de estado (color, visibilidad, opacidad, parpadeo) con RPM relativas al limitador.
- Simulación con sliders, escenarios, RPM automáticas, ambiente día/noche, modo replay (variables sin físicas).
- Proyecto `.acdisplay` (ZIP con `project.json` + assets), recientes, autoguardado de recuperación.
- Generación: runtime Lua estable + `display_config.lua` de datos, `display.ini`, `[INCLUDE]` entre marcadores en `ext_config.ini`, backup, restaurar, desinstalar, exportar paquete sin instalar, DDS opcional, validación sintáctica del Lua.

Pendiente (ver fases en los requerimientos): páginas, fuentes DWrite empaquetadas probadas en juego, atlas de iconos, biblioteca de perfiles con versionado, lanzamiento de sesión desde Content Manager, instalador firmado, inglés.

## Desarrollo

Requisitos: Node 22+.

```bash
npm install
npm run dev        # Electron + Vite con recarga
npm test           # vitest (generador, formato, kn5, perfil)
npm run typecheck
npm run build      # out/
npm run dist       # instalador y portable en release/ (electron-builder)
```

Arnés de pruebas manual: con `ACDG_DEBUG=<carpeta>` la app vuelca la consola del renderer, ejecuta `<carpeta>/cmd.js` en el renderer (resultado en `cmd.out`), captura `shot.png` al crear `shot.request` y los diálogos nativos devuelven el contenido de `dialog.txt` si existe. `window.acdgStore` expone el estado (zustand).

## Estructura

```
src/shared/       modelo del proyecto, esquema del perfil, catálogo de variables, formato, generador (puro, testeable)
src/main/         Electron main: localizador de AC, scanner de vehículos, lector kn5, perfiles, proyectos (.acdisplay),
                  imágenes/DDS, instalador + backups, IPC
src/preload/      puente window.acdg
src/renderer/     React: inicio, asistente (vehículo → perfil → imagen → proyecto), editor (lienzo Canvas 2D, capas,
                  propiedades, simulación), diálogo de generación
resources/runtime/acdg_runtime.lua   librería Lua que dibuja el display en CSP a partir de display_config.lua
resources/icons/                     iconos integrados (SVG blanco, se rasterizan a PNG al generar)
resources/profiles/                  perfiles de ejemplo (Toyota Starlet Millington)
tests/                               vitest
```

Regla de oro: `src/renderer/src/render/draw.ts` (preview) y `resources/runtime/acdg_runtime.lua` (juego) implementan la misma semántica; cualquier cambio en uno se replica en el otro.

## Qué se genera en el coche

```
content/cars/<id>/extension/
  ext_config.ini                 + bloque "; ACDG BEGIN <display>" … "[INCLUDE: acdg/<display>/display.ini]" … "; ACDG END"
  acdg/<display>/
    display.ini                  [SCRIPTABLE_DISPLAY_ACDG_<DISPLAY>] MESHES/SCRIPT/KEEP_BACKGROUND/SKIP_FRAMES (+ shader emisivo opcional)
    display.lua                  carga runtime + config
    acdg_runtime.lua             runtime (versionado)
    display_config.lua           datos del proyecto (elementos, reglas, variables usadas)
    assets/, icons/, fonts/      recursos
    project.acdisplay            copia del proyecto para reeditar
    LEEME.txt
  acdg/_backup/<fecha>/          copias de seguridad (ext_config.ini + carpeta anterior)
```
