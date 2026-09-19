# REQUERIMIENTOS DEL PROYECTO — VERSIÓN 2
AC Display Generator — Editor y generador de displays para Assetto Corsa + CSP + Lua

| Campo | Valor |
| Versión del documento | 2.0 |
| Fecha | 14 de septiembre de 2026 |
| Sustituye a | Requerimientos v1 (Requerimientos_AC_Display_Generator.pdf) |
| Vehículo de referencia | av_toyota_starlet_millington (display 1593 × 987 px, malla Plano_014_001) |
| Stack elegido | Electron + TypeScript + React (ver sección 28) |

Objetivo: crear una aplicación de escritorio Windows que permita diseñar, configurar y generar displays personalizados para Assetto Corsa sin que el usuario final tenga que conocer CSP, Lua, DDS ni la estructura interna del vehículo.

## Resumen de cambios respecto a la versión 1

Los puntos nuevos o modificados están marcados con la etiqueta [v2] a lo largo del documento. Los cambios más relevantes son:

- Corregida la contradicción de relación de aspecto: el sistema de coordenadas es siempre la textura en píxeles; las medidas físicas pasan a ser informativas (sección 7).
- Los displays de CSP se asignan por malla (`MESHES`), no por material. El perfil pasa a definir `meshes[]`; material y shader son opcionales (secciones 5 y 21).
- Eliminada la conversión metros ↔ píxeles: CSP y Lua trabajan en píxeles.
- `data/` o `data.acd`: ambas estructuras son válidas (sección 4).
- DDS opcional: CSP carga PNG/JPG directamente; el DDS es una optimización activada por defecto (sección 20).
- Nueva arquitectura de generación: runtime Lua estable distribuido por la aplicación + configuración de datos generada por proyecto, en lugar de generar código imperativo por elemento (sección 21).
- Instalación no invasiva: los archivos generados se escriben directamente en `extension/` (sin subcarpetas) y en `ext_config.ini` solo se añade la sección del display entre marcadores; nunca se reescribe el resto del archivo (sección 20). [v2.2]
- Destino de instalación seleccionable: coche o skin (sección 20).
- Catálogo central de variables (`variables.json`) con marcado de variables físicas no disponibles en replays (secciones 10 y 26).
- Umbrales de RPM absolutos o relativos al limitador del coche (sección 12).
- Añadidos: deshacer/rehacer, selección múltiple, alinear/distribuir, atajos, autoguardado, proyectos recientes, desinstalar, unidades, idiomas, log (secciones 8, 16, 19, 22, 30).
- Soporte de brillo/emisivo desde el editor (sección 18).
- Funcionamiento garantizado en replays y en vehículos de otros jugadores/IA (sección 26).
- Los perfiles se distribuyen únicamente dentro del vehículo (`extension/display_profile.json`); la biblioteca local queda como caché y espacio de trabajo del creador (sección 25).
- Modo creador con lectura del `.kn5` para listar mallas y materiales (sección 24).
- Definidas fases de desarrollo (MVP, v1.1, v1.2) (sección 31).
- Anexos con esquemas JSON del perfil y del proyecto, estructura generada, catálogo inicial de variables y referencia CSP verificada contra el SDK instalado.

# 1. Visión general

La aplicación funciona como un editor visual WYSIWYG especializado en displays de Assetto Corsa. El usuario selecciona la carpeta del vehículo, carga una imagen con la resolución indicada por el creador y coloca visualmente los datos y elementos que desea mostrar. El programa genera automáticamente los recursos necesarios para CSP + Lua y puede instalarlos en el vehículo.

Principio fundamental: la complejidad técnica recae en el perfil del creador, no en el usuario final.

Principios de diseño [v2]:

- El usuario final trabaja en píxeles sobre una imagen, como en un programa de diseño gráfico sencillo.
- Lo que el editor muestra y lo que el runtime Lua dibuja parten del mismo modelo de datos, por lo que el preview es fiel salvo por las limitaciones documentadas (sección 14).
- La aplicación nunca modifica `.kn5`, `data.acd` ni archivos originales sin copia de seguridad.
- Todo lo que pueda predefinirse en el perfil del creador queda automatizado.
- Todo lo generado es reversible: actualizar, restaurar o desinstalar es una acción de un clic.

# 2. Glosario [v2]

| Término | Significado |
| AC | Assetto Corsa (Kunos, 2014). |
| CSP | Custom Shaders Patch. Extensión de AC que añade, entre otras cosas, scripts Lua y displays programables. |
| Scriptable display | Sección `[SCRIPTABLE_DISPLAY_...]` de CSP que asigna un script Lua a una malla del coche; el script dibuja cada frame sobre la textura de esa malla. |
| ext_config.ini | Archivo de configuración CSP del coche (`content/cars/<id>/extension/ext_config.ini`) o de la skin (`skins/<skin>/ext_config.ini`). |
| kn5 | Formato binario del modelo 3D de AC. Contiene mallas, materiales y texturas. |
| Perfil | `display_profile.json`: describe técnicamente el display de un vehículo (mallas, resolución, plantillas, variables, valores por defecto). Lo crea el creador del coche. |
| Proyecto | `.acdisplay`: diseño del usuario (imagen, elementos, posiciones, estilos, estados). |
| Runtime | `acdg_runtime.lua`: librería Lua estable distribuida con la aplicación que sabe dibujar cada tipo de elemento a partir de la configuración generada. |
| Creador | Persona que prepara el perfil técnico de un vehículo. |
| Usuario final | Persona que diseña el display sin conocimientos de CSP/Lua. |

# 3. Flujo mínimo del usuario final

- Seleccionar la carpeta del vehículo de Assetto Corsa (o elegirlo de la lista detectada automáticamente [v2]).
- La aplicación analiza el vehículo y busca un perfil compatible.
- Mostrar las medidas, la resolución del display y las mallas definidas por el perfil.
- Seleccionar una imagen de fondo del display.
- Comprobar automáticamente formato, resolución y relación de aspecto.
- Abrir el editor visual con la imagen como fondo.
- Añadir datos, barras, indicadores, iconos y elementos gráficos.
- Colocar y redimensionar cada elemento directamente sobre la imagen.
- Previsualizar valores dinámicos y animaciones.
- Guardar el proyecto y/o exportarlo directamente al vehículo o a la skin.
- Crear una copia de seguridad antes de modificar archivos.
- Validar la instalación y mostrar claramente cualquier error.

# 4. Selección y análisis del vehículo

Cambio v2.1 (acordado tras la primera versión): al seleccionar el vehículo la aplicación analiza únicamente la carpeta `extension/`:

- Si existe `ext_config.ini`, se leen sus secciones y sus `[INCLUDE]` en busca de todo lo relacionado con displays (`[SCRIPTABLE_DISPLAY...]`, mallas, script, `KEEP_BACKGROUND`, `SKIP_FRAMES`, `RESOLUTION`), además de otros `.ini` de la carpeta no incluidos. Si no existe, se crea al generar el display.
- Si la sección referencia un script Lua, se comprueba (existencia y sintaxis). Si el script lo generó la aplicación, su proyecto se carga automáticamente; si es un script hecho a mano, se importa (malla, resolución e imagen deducidas del ini, del script y del `.kn5`) y se ofrece desactivar la sección original al instalar para no dibujar dos displays sobre la misma malla (reversible al desinstalar). Si no hay script, se crea.

- Botón "Seleccionar vehículo" mediante selector de carpetas.
- [v2] Detección automática de la instalación de AC: registro de Steam (`SteamPath`) + `libraryfolders.vdf`, ruta configurada en Content Manager, y ruta manual como último recurso. Con la ruta detectada se ofrece una lista de vehículos con nombre, marca e icono leídos de `ui/ui_car.json` y `ui/badge.png`.
- Comprobar que la carpeta pertenece a un vehículo válido de Assetto Corsa: debe contener `data/` **o** `data.acd` [v2], al menos un `.kn5` y `ui/ui_car.json`.
- Detectar `extension/`, `extension/ext_config.ini`, `skins/` y sus `ext_config.ini` [v2].
- Buscar automáticamente un perfil de display compatible (orden de búsqueda en la sección 25).
- No asumir que todos los vehículos utilizan la misma estructura, malla o material.
- Mostrar el nombre del vehículo, perfil encontrado, versión y configuración del display.
- [v2.4] **Destello** configurable en todas las luces (shift light, luces de cambio y segmentos de la barra RPM): halo en px e intensidad (sombra difuminada en el editor, capas concéntricas en CSP), y ciclo de parpadeo (% del periodo encendido).
- [v2.4] Nuevos elementos: **Luces de cambio** (tira de N LEDs entre dos regímenes, orden extremo→extremo / extremos→centro / centro→extremos, tramos de color en orden de encendido, parpadeo en limitador, textura opcional del LED) y **Aguja** (gira alrededor de un eje ajustable —arrastrable en el lienzo— entre un ángulo mínimo y máximo según la variable, con textura o aguja simple, suavizado y límite de recorrido). Las barras (RPM y genéricas) en estilo continuo admiten **textura personalizada** de llenado (se descubre según el valor) y de fondo, con tinte opcional.
- [v2.3] Si el vehículo ya tiene un proyecto generado, se abre directamente; desde el editor, "+ Display" permite añadir más displays al mismo proyecto (importando uno definido a mano en `extension/` o eligiendo una malla del kn5). La definición se añade al perfil del vehículo y "Quitar este display del proyecto" lo elimina.
- [v2.3] Al crear el proyecto, las secciones de display ajenas de `extension/` (en `ext_config.ini`, sus includes u otros .ini) que usen las mallas del proyecto se desactivan automáticamente (comentadas con `;ACDG-OFF;`, con copia de seguridad previa) para que no se superpongan con lo generado; "Desinstalar" las reactiva.
- [v2] Detectar si ya existe un display generado por la aplicación (bloque `; ACDG BEGIN <id>` en `ext_config.ini`) y abrir automáticamente el proyecto guardado en `extension/acdg_project.acdisplay`.
- [v2] Detectar si el `ext_config.ini` ya contiene un `[SCRIPTABLE_DISPLAY_...]` sobre la misma malla que el perfil y avisar del conflicto.
- Permitir cancelar el proceso si el vehículo no es compatible.
- [v2] Si no hay perfil, ofrecer dos salidas: abrir el modo creador o usar un "perfil manual mínimo" (solo malla + resolución) sin garantías.

# 5. Perfiles de vehículo

Cada vehículo/display se define mediante un perfil externo para que la aplicación pueda incorporar nuevos vehículos sin modificar el programa principal.

Requisitos del perfil:

- Identificador único, versión del perfil, versión mínima de la aplicación y del runtime [v2].
- Lista de vehículos compatibles (`car_ids[]`) para cubrir variantes (asfalto/tierra, etc.) [v2].
- Uno o varios displays por vehículo (`displays[]`) [v2]: un coche puede tener dash + volante + pantalla de navegación.
- Por display: mallas (`meshes[]`, obligatorio), resolución de textura (obligatorio), tamaño físico en metros (informativo), región UV usada (opcional), `KEEP_BACKGROUND`, `SKIP_FRAMES`, configuración de emisivo/brillo, snippets `ext_config` adicionales (por ejemplo `[SHADER_REPLACEMENT_...]`).
- Variables disponibles y valores por defecto (RPM máx., zonas, combustible máx., etc.), pudiendo extender el catálogo global.
- Diseño inicial opcional (`preset_layout`) con elementos ya colocados.
- Fuentes recomendadas incluidas con el perfil.
- Versión mínima de CSP (`csp_min_build`) que el generador convertirá en la condición `ACTIVE = $" read('csp/version', 0) >= N "`.
- Los perfiles se distribuyen dentro del vehículo (sección 25) y deben ser válidos sin recompilar la aplicación.

Esquema completo en el Anexo A.

# 6. Imagen de fondo

- Admitir como mínimo PNG, DDS y JPG/JPEG; priorizar PNG y DDS.
- Mostrar nombre, formato, resolución y presencia de canal alfa.
- Comparar la resolución real con la resolución requerida por el perfil.
- Impedir la generación si la resolución no es compatible, salvo que se habilite redimensionado automático.
- Permitir opcionalmente escalar, recortar o mantener proporción.
- Usar la imagen como fondo bloqueable dentro del editor.
- [v2] Permitir trabajar sin imagen (fondo de color plano) para displays completamente generados.
- [v2] Advertir si la imagen tiene alfa y el perfil usa `KEEP_BACKGROUND = 1`: en ese modo la textura no se limpia entre frames y las barras dejan rastro (problema real documentado en el script del Starlet). El runtime resuelve esto pintando el fondo cada frame o limpiando las zonas de las barras.

# 7. Sistema de coordenadas [v2]

El editor utiliza la resolución de textura definida por el creador como único sistema de coordenadas. Ejemplo: un display de 1593 × 987 px se edita exactamente en ese espacio y el Lua generado dibuja en esos mismos píxeles. No existe conversión metros ↔ píxeles: CSP no la necesita.

- Origen en la esquina superior izquierda, eje Y hacia abajo (igual que `display.*` de CSP).
- Posición y tamaño en píxeles; se admiten decimales pero el editor redondea a entero por defecto.
- Coordenadas X/Y visibles opcionalmente.
- Las medidas físicas del perfil (`physical_size_m`) se usan solo para: mostrar información al usuario y ofrecer el toggle "Vista física", que deforma el lienzo a la relación de aspecto real de la malla para previsualizar cómo se verá en el coche cuando la textura no tenga la misma proporción que el display físico (caso del Starlet: textura 1,61:1 sobre un display de 1,25:1).
- Si el perfil define `uv_region`, el editor muestra la zona de la textura realmente visible en la malla y atenúa el resto.

# 8. Editor visual WYSIWYG

- Lienzo central con la imagen del display.
- Zoom (rueda, atajos, ajuste a ventana, 100 %) y desplazamiento del lienzo (barra espaciadora + arrastre, botón central).
- Añadir elementos mediante panel lateral o botón "+ Añadir elemento".
- Arrastrar elementos con el ratón.
- Redimensionar mediante tiradores visuales (8 tiradores; Shift mantiene proporción).
- Rotar cuando el tipo de elemento lo permita.
- Eliminar, duplicar, ocultar y bloquear elementos.
- Mostrar límites, posición y tamaño del elemento seleccionado.
- Editar valores numéricos en el panel de propiedades para ajustes de precisión.
- [v2] Deshacer/Rehacer ilimitado dentro de la sesión (Ctrl+Z / Ctrl+Y), incluyendo cambios de propiedades.
- [v2] Selección múltiple (Shift+clic, marco de selección), mover y redimensionar en grupo.
- [v2] Copiar/pegar/duplicar (Ctrl+C / Ctrl+V / Ctrl+D) con desplazamiento automático.
- [v2] Alinear (izquierda, centro, derecha, arriba, medio, abajo) y distribuir (horizontal, vertical) la selección.
- [v2] Agrupar/desagrupar elementos.
- [v2] Atajos de teclado documentados en una ventana de ayuda.
- [v2] Panel de propiedades contextual según el tipo de elemento.

# 9. Colocación y precisión

- Movimiento libre con ratón.
- Movimiento mediante teclas de dirección (1 px) y Shift + dirección (10 px).
- Rejilla configurable (tamaño y color) y ajuste a rejilla.
- Ajuste al centro del display y a los bordes.
- Ajuste a bordes y centros de otros elementos con líneas guía inteligentes.
- Guías manuales arrastrables desde las reglas [v2].
- Lectura en tiempo real de X, Y, ancho y alto en la barra de estado.

# 10. Catálogo de variables [v2]

El usuario añade variables sin escribir código Lua. Cada variable se define en un catálogo central `variables.json` distribuido con la aplicación y ampliable por los perfiles:

| Campo | Descripción |
| id | Identificador estable (`rpm`, `speed`, `gear`, `water_temp`...). |
| label | Etiqueta traducida mostrada al usuario. |
| category | Motor, Conducción, Tiempo, Vehículo, Estado, Neumáticos, Eléctrico, Sesión. |
| type | number, integer, boolean, text, time_ms. |
| lua | Expresión Lua real sobre `car` / `sim` (`car.rpm`, `car.speedKmh`, `car.performanceMeter`...). |
| unit | Unidad base (rpm, km/h, °C, bar, L, ms, %). |
| range | Mínimo/máximo por defecto para barras y gauges (puede sobreescribirse por el perfil, por ejemplo con `car.rpmLimiter`). |
| physics_only | `true` si el valor solo existe con físicas locales (no disponible en replays ni coches remotos). El runtime usa `fallback` cuando `car.physicsAvailable == false`. |
| fallback | Valor o expresión alternativa. |

Categorías y elementos mínimos:

| Categoría | Variables mínimas |
| Motor | RPM, limitador (`rpmLimiter`), temperatura de agua, temperatura de aceite, presión de aceite, presión de turbo, voltaje de batería. |
| Conducción | Velocidad, marcha, freno, acelerador, embrague, freno de mano, ángulo de volante. |
| Tiempo | Lap Time, Last Lap, Best Lap, sectores (actual, último, mejor), Delta (`performanceMeter`), vuelta actual, tiempo estimado. |
| Vehículo | Combustible, combustible máx., consumo por vuelta, temperaturas y presiones de neumáticos (4), desgaste, temperatura de frenos, posición en carrera, daños. |
| Estado | ABS (modo y en acción), TC (modo y en acción), luces (cortas, largas, intermitentes, emergencia), pit limiter, en pit, limitador activo, DRS, KERS, bandera, vuelta válida, extraA–T. |
| Sesión | Tipo de sesión, tiempo restante, vueltas totales, posición/total, mejor vuelta de sesión. |

Cada elemento está vinculado a una variable por su `id`; la sintaxis Lua queda oculta al usuario. Opcionalmente un elemento puede aplicar una transformación sencilla configurada visualmente: escala, desplazamiento, límites, redondeo.

Catálogo inicial en el Anexo D.

# 11. Elementos del editor

Tipos de elemento (consolidación de las secciones 10 a 16 de v1):

## 11.1 Texto dinámico y estático

- Variable asociada o texto fijo.
- Fuente y tamaño configurables; grosor, alineación (izquierda/centro/derecha), escala y rotación.
- Formato numérico: decimales, ceros a la izquierda, separador, signo.
- Formatos de tiempo: `m:ss.mmm`, `m'ss"mm`, `ss.m`, etc., configurables.
- Prefijo/sufijo y unidad opcional (con conversión automática según sección 16).
- Anchura/altura del área de texto y comportamiento al desbordar (recortar, reducir, desplazar).
- [v2] Tabla de sustitución de valores (ej.: marcha -1 → "R", 0 → "N").

## 11.2 Barra de RPM

Componente específico, no una imagen estática.

- Orientación horizontal o vertical; sentido de llenado.
- Estilo continuo o segmentos/LEDs individuales con número configurable.
- RPM mínima y máxima (absolutas o relativas al limitador, sección 12).
- Inicio de zona de advertencia, inicio de zona roja, RPM del limitador.
- Tamaño, separación, grosor, esquinas y posición configurables.
- Colores por estado (Normal, Warning, Redline, Limiter) y color de segmento apagado.
- Ocultar/mostrar segmentos dinámicamente; parpadeo en limitador.
- [v2] Modo "imagen": la barra revela progresivamente una imagen aportada por el usuario (`uvStart/uvEnd`), útil para dashes con LEDs ya pintados en el fondo.

## 11.3 Shift light y limitador

- Elemento Shift Light independiente con RPM (o %) de activación y desactivación (histéresis).
- Estado fijo o parpadeante; frecuencia configurable.
- Elemento Limitador independiente activado al alcanzar las RPM configuradas o `car.isEngineLimiterOn`.
- Cambio de estado, visibilidad, opacidad, color, imagen o animación al activarse.
- [v2] Shift light multi-etapa (varios LEDs con umbrales crecientes) como preset.

## 11.4 Barra genérica

- Cualquier variable numérica del catálogo (freno, acelerador, combustible, temperaturas, presiones, velocidad, delta...).
- Valor mínimo y máximo; orientación; tamaño; estilo continuo o segmentado.
- Umbrales y estados con colores.
- [v2] Barra bipolar (centro en cero) para delta y aceleración lateral.
- Animación opcional (suavizado).

## 11.5 Indicador de marcha

- Tabla de valores: N, 1..n, R y otros; fuente y colores por estado (ej. limitador).

## 11.6 Iconos e imágenes

- Iconos de serie para aceite, frenos, ABS, TC, combustible, luces, pit, avisos, DRS, intermitentes.
- Importar iconos/recursos personalizados (PNG/DDS) y copiarlos al paquete generado.
- Visibilidad, color u opacidad según variables y umbrales.
- [v2] Estados de imagen: imagen distinta por estado (apagado/encendido/aviso).
- [v2] Atlas automático: la aplicación puede empaquetar los iconos en un único atlas para reducir cargas de textura, siguiendo la recomendación de CSP.

## 11.7 Elementos gráficos

- Rectángulo (relleno, borde, esquinas), línea, círculo/elipse, polígono simple.
- Todos aceptan color por estado y visibilidad condicional.

## 11.8 Indicador circular (gauge)

- Valores mínimo y máximo; ángulo inicial y final; radio y grosor; sentido de recorrido.
- Variable asociada, umbrales, estilo (arco, aguja, arco + aguja, segmentado) y animación.
- [v2] Se implementa con `ui.drawPie`/arcos de CSP; el preview replica la geometría.

# 12. Sistema de estados y animaciones

- Estados mínimos para RPM: Normal, Warning, Redline, Limiter.
- Cualquier elemento puede definir reglas: `variable` + `operador` + `umbral` → estado (color, visibilidad, opacidad, imagen, parpadeo, escala).
- [v2] Umbrales de RPM expresables como valor absoluto o como porcentaje del limitador real del coche (`car.rpmLimiter`), para que un perfil o diseño sirva a variantes con distinto corte. El editor muestra siempre el valor absoluto resultante según el perfil.
- Parpadeo con frecuencia y ciclo de trabajo configurables.
- Animaciones asociadas a valores: suavizado (lerp) configurable en ms, transición de color.
- [v2] Histéresis opcional en umbrales para evitar oscilaciones.
- Los elementos pueden tener distintos comportamientos según el valor de la variable.

# 13. Capas

- Lista de capas con orden Z; subir/bajar/al frente/al fondo.
- Ocultar/mostrar; bloquear/desbloquear; renombrar; duplicar.
- El fondo puede bloquearse para evitar moverlo accidentalmente.
- [v2] Búsqueda/filtro en la lista y agrupación en carpetas.

# 14. Previsualización

- Modo de previsualización separado del diseño (sin tiradores ni guías).
- Panel de simulación con sliders para RPM, velocidad, marcha, freno/acelerador, temperaturas, presiones, combustible, tiempos, delta, estados booleanos.
- [v2] Escenarios predefinidos: "ralentí", "corte", "boxes", "vuelta rápida", "noche", y reproducción automática (subida de RPM en bucle).
- Comprobación visual de estados, parpadeos y animaciones.
- [v2] Limitación documentada: el preview del editor no es CSP. Las fuentes bitmap de AC, el emisivo y la deformación de la malla se aproximan. Se ofrece "Generar y abrir carpeta" para probar rápidamente en el juego.

# 15. Páginas [v2, fase v1.2]

- Un display puede tener varias páginas conmutables con las entradas `extraA…extraF` de CSP (botones del volante) o al cambiar de estado (pit, limitador).
- El modelo de datos del proyecto contempla `pages[]` desde el MVP aunque el editor exponga una sola página hasta la fase v1.2.

# 16. Unidades y formatos [v2]

- Unidades seleccionables por elemento o globalmente: km/h ↔ mph, °C ↔ °F, bar ↔ psi, L ↔ gal.
- Por defecto se respeta `car.prefersImperialUnits` si el usuario elige "automático".
- Formatos de tiempo y número centralizados en el runtime para que preview y juego coincidan.

# 17. Fuentes [v2]

CSP ofrece dos vías de texto en displays:

- Fuentes bitmap de AC (`display.text`, atlas PNG + descriptor), usadas por la mayoría de dashes existentes; aspecto "instrumento", muy rápidas.
- DirectWrite (`ui.dwriteText` + `ui.DWriteFont`), fuentes TTF/OTF con calidad de texto normal.

Requisitos:

- El editor soporta ambas y muestra en el preview una aproximación fiel (renderiza el atlas bitmap real cuando exista).
- Las fuentes se copian a `extension/` junto al script; nunca se referencian rutas absolutas.
- [v2.3] Área visible (UV): el lienzo es siempre la textura completa (lo que renderiza CSP), pero la malla puede mostrar solo una parte de ella (su rectángulo UV; p. ej. la franja central en el Porsche 992). La aplicación lee las UV de la malla en el kn5 (la V se guarda negada), guarda la región en el perfil (`uv_region`) junto con el tamaño físico estimado (`physical_size_m`), la marca en el editor (fuera de ella se oscurece; en previsualización se recorta), coloca los elementos nuevos dentro y permite ajustarla a mano o detectarla de nuevo (propiedades del display → Área visible). La sección generada incluye `RESOLUTION = ancho, alto` para que el render target coincida con el lienzo.
- El perfil puede incluir fuentes; la aplicación incluye un conjunto básico con licencia libre (por ejemplo, familias OFL).
- Aviso de licencia al importar fuentes propias.
- Un elemento de texto puede cambiar de fuente sin perder el resto de propiedades.

# 18. Brillo y emisivo [v2]

- El perfil define cómo se vuelve emisiva la malla del display (`emissive` en el Anexo A): `[SHADER_REPLACEMENT_...]` con `ksEmissive` o el mecanismo que el creador indique.
- El usuario dispone en el proyecto de un ajuste "Brillo" global (multiplicador de color aplicado por el runtime a todo lo dibujado) y de un ajuste por elemento.
- Modo noche: reducción de brillo automática configurable cuando `car.headlightsActive` o según hora de la sesión (`sim.timeHours`), con transición suave.
- Opción de exponer el brillo al usuario del juego mediante `extraX` (subir/bajar brillo con un botón) en fase v1.2.
- El preview incluye un slider de "ambiente" (día/noche) para comprobar la legibilidad.

# 19. Guardado de proyectos

Formato propio `.acdisplay` [v2: contenedor ZIP] con:

- `project.json` (esquema en el Anexo B): referencia al perfil (id + versión), display seleccionado, páginas, elementos con posiciones, tamaños, estilos, variables, estados, capas, brillo, unidades.
- `assets/`: imagen de fondo, iconos importados, fuentes.
- `thumbnail.png` para la lista de proyectos recientes.

Requisitos:

- Guardar/Guardar como/Abrir; proyectos recientes; miniaturas.
- Autoguardado periódico y recuperación tras cierre inesperado.
- Versionado del formato con migraciones automáticas.
- Portabilidad total: el archivo se puede abrir en otro equipo.
- Al generar, se guarda una copia del proyecto dentro del coche (`extension/acdg_project.acdisplay`) para poder reeditarlo desde el vehículo.

# 20. Generación e instalación

Estructura generada (Anexo C) [v2.2]: todo lo que la aplicación crea se escribe directamente en `extension/` (o `skins/<skin>/`), sin subcarpetas: `<display_id>.lua` (script autocontenido: configuración + runtime), `<display_id>_<recurso>.png/.dds` (imágenes e iconos), fuentes y `acdg_project.acdisplay`. En `ext_config.ini` se añade la sección `[SCRIPTABLE_DISPLAY_...]` entre marcadores `; ACDG BEGIN <display_id>` / `; ACDG END <display_id>`, con una línea `; ACDG FILES:` que lista los archivos escritos (para actualizar y desinstalar sin tocar nada ajeno). Si ya existe un `.lua` ajeno con el nombre del display (p. ej. el `display.lua` original importado) el script se llama `<display_id>_acdg.lua` y el original no se sobrescribe. Nunca se reescribe el resto del archivo.

- Generar `display.ini` con la sección `[SCRIPTABLE_DISPLAY_...]` a partir del perfil.
- Generar `display_config.lua` (datos del proyecto) y copiar `acdg_runtime.lua` (librería estable, versionada).
- Generar `display.lua` mínimo que carga runtime + config.
- Copiar imagen de fondo, iconos y fuentes; generar DDS (BC3/BC7, con mipmaps) cuando la opción esté activa; en caso contrario copiar PNG.
- Destino: coche (`extension/`) o skin (`skins/<skin>/`) a elección del usuario [v2].
- Crear carpetas necesarias; no requerir herramientas externas.
- Permitir "Exportar paquete" sin instalar: carpeta o ZIP listo para copiar, con instrucciones en `LEEME.txt`.
- Al detectar un display previo: ofrecer actualizar, crear copia o cancelar.
- Ofrecer abrir la carpeta generada y, si Content Manager está instalado, lanzar el juego con el coche seleccionado para probar (comando `acmanager://`) [v2].

# 21. Runtime Lua y plantillas [v2]

Se sustituye la generación de código por elemento por un enfoque de datos:

- `acdg_runtime.lua`: implementa `text`, `rpmBar`, `shiftLight`, `limiter`, `bar`, `gear`, `icon`, `image`, `rect`, `line`, `circle`, `gauge`, estados, parpadeos, suavizados, unidades y formatos. Se distribuye con la aplicación y se versiona de forma independiente (`runtime_version`).
- `display_config.lua`: tabla Lua generada con el display, páginas, elementos y sus propiedades. Es una traducción directa de `project.json`.
- `display.lua`: `require` del runtime + config y `function script.update(dt) ACDG.update(dt) end`.
- Plantillas parametrizadas solo para lo que no es dato: `display.ini` y el bloque INCLUDE. Marcadores mínimos: `{{DISPLAY_ID}}`, `{{MESHES}}`, `{{SCRIPT}}`, `{{KEEP_BACKGROUND}}`, `{{SKIP_FRAMES}}`, `{{ACTIVE_CONDITION}}`, `{{EXTRA_INI}}`.
- El perfil puede indicar una plantilla `display.ini` propia y bloques de ext_config adicionales.
- El generador valida que no queden marcadores sin resolver.
- El Lua generado se comprueba sintácticamente en la aplicación con un parser Lua 5.1/LuaJIT embebido antes de instalar.
- Solo se usan campos de `car`/`sim` presentes en el catálogo; el runtime protege cada lectura frente a `nil`.
- Rendimiento: `SKIP_FRAMES` del perfil, `ac.skipFrame()` cuando el coche está lejos de la cámara (`car.distanceToCamera` mayor que el umbral del perfil) y no está enfocado; evitar crear tablas/vec2 por frame.

# 22. Copia de seguridad, restauración y desinstalación

- Crear backup antes de modificar archivos, con fecha y hora, en la carpeta de datos de la aplicación (`%APPDATA%/AC Display Generator/backups/<coche>/<timestamp>/`); el coche no recibe ninguna carpeta extra. [v2.2]
- Conservar los archivos originales modificados (solo `ext_config.ini`, ya que el resto es nuevo).
- Botón "Restaurar original".
- [v2] Botón "Desinstalar display": elimina los archivos listados en el bloque, la sección de `ext_config.ini` y reactiva los displays originales desactivados, dejando el coche como estaba.
- No sobrescribir silenciosamente archivos existentes.
- Si ya existe un display generado, ofrecer actualizar, crear copia o cancelar.

# 23. Validación

Antes de instalar y después de instalar:

- Carpeta de vehículo válida; perfil válido (esquema JSON) y compatible con la versión de la aplicación.
- Mallas del perfil presentes en el `.kn5` (cuando el lector kn5 esté disponible).
- Imagen compatible y resolución correcta.
- DDS, Lua, `display.ini` y bloque INCLUDE generados correctamente.
- Lua sintácticamente válido; sin marcadores sin resolver.
- Archivos colocados en las rutas esperadas y legibles.
- Conflictos: otro `[SCRIPTABLE_DISPLAY]` sobre la misma malla.
- Todos los errores se muestran con explicación comprensible y acción sugerida; nunca se ocultan.

# 24. Modo creador

Modo avanzado opcional para preparar perfiles reutilizables:

- Definir mallas [v2: seleccionables de una lista leída del `.kn5`, con filtro por nombre y material] y material/shader emisivo.
- Definir dimensiones físicas, resolución y región UV.
- Definir variables disponibles, rangos, umbrales por defecto y limitador.
- Definir `display.ini` y bloques ext_config adicionales.
- Definir elementos preconfigurados (`preset_layout`) y fuentes.
- Exportar `display_profile.json` y, con un clic, colocarlo en `extension/` del vehículo para su distribución [v2].
- Validar el perfil y probarlo con un proyecto de ejemplo.
- El usuario final no necesita entrar en este modo.

# 25. Distribución y biblioteca de perfiles [v2]

Decisión: los perfiles se distribuyen únicamente con los vehículos.

- Ubicación canónica: `content/cars/<id>/extension/display_profile.json` (o `display_profiles/*.json` si hay varios).
- Orden de búsqueda: (1) perfil dentro del vehículo; (2) biblioteca local de la aplicación (`%APPDATA%/ACDisplayGenerator/profiles/`), pensada como espacio de trabajo del creador y caché de perfiles abiertos anteriormente; (3) selección manual de archivo.
- Cada vehículo puede tener uno o varios perfiles; identificador único y versión; nombre descriptivo.
- Compatibilidad declarada con versiones del generador y del runtime.
- Incorporación de perfiles sin recompilar la aplicación.

# 26. Replays y otros vehículos [v2]

Decisión: los displays deben funcionar en replays y en los vehículos de otros jugadores/IA.

- CSP ejecuta el script del display por cada instancia de coche; el global `car` corresponde al coche propietario, por lo que no se requiere lógica adicional para "otros coches".
- En replays y coches remotos `car.physicsAvailable == false`: las variables marcadas `physics_only` (modo ABS/TC, brake bias, consumo por vuelta, limitador de boxes manual...) no existen. El runtime usa el `fallback` del catálogo (ocultar icono, mostrar "--", valor 0) y nunca produce errores.
- El editor muestra un aviso en las propiedades de las variables `physics_only`.
- Rendimiento con muchos coches: el perfil define `max_distance_m` (por defecto 50 m) a partir del cual el runtime llama a `ac.skipFrame()` salvo que el coche esté enfocado.
- Escenario de prueba obligatorio: cargar un replay y una sesión online/IA con varios coches del mismo modelo.

# 27. Funcionamiento offline

La aplicación funciona completamente en local. No requiere cuenta, servidor, conexión a Internet, API externa ni base de datos online para editar o generar un display. La comprobación opcional de actualizaciones, si existe, es desactivable y nunca bloquea.

# 28. Arquitectura y stack [v2]

Stack elegido: Electron + TypeScript + React + Vite. Motivos: entorno disponible (Node 22), lienzo Canvas 2D/WebGL ideal para un editor WYSIWYG, empaquetado en instalador y portable con electron-builder, acceso completo al sistema de archivos desde el proceso principal, y ecosistema para parsear binarios (kn5), codificar DDS y validar Lua (`luaparse`).

Módulos (proceso principal salvo indicación):

- UI / Editor (renderer): lienzo, capas, propiedades, preview, simulación, historial (undo/redo).
- Vehicle Scanner: localización de AC, validación de carpeta, lectura de `ui_car.json`, detección de displays previos.
- KN5 Reader: listado de mallas, materiales y texturas.
- Profile Manager: carga, validación (JSON Schema), búsqueda y biblioteca local.
- Project Manager: `.acdisplay` (ZIP), autoguardado, migraciones, recientes.
- Image Manager: decodificación PNG/JPG/DDS, metadatos, redimensionado.
- DDS Encoder: BC3/BC7 con mipmaps, implementado en TypeScript/WASM (sin herramientas externas).
- Variable Catalog: `variables.json` + extensiones del perfil.
- Lua Runtime (recurso distribuido) y Config Generator (project → `display_config.lua`).
- Template Engine: `display.ini`, INCLUDE, `LEEME.txt`.
- Lua Validator: parser Lua 5.1 embebido.
- Installer: copia de archivos, bloque INCLUDE, destino coche/skin, exportar paquete.
- Backup Manager: backups, restaurar, desinstalar.
- Validator: comprobaciones previas y posteriores.
- AC Locator / CM Integration: rutas, lanzamiento del juego.
- Logger e i18n.

Separación de datos: configuración de la aplicación (`%APPDATA%/ACDisplayGenerator/config.json`), perfiles locales, proyectos del usuario (`Documentos/AC Display Generator/`), y archivos generados (dentro del coche/skin).

# 29. Compatibilidad con AC y CSP [v2]

- CSP mínimo por defecto: la versión indicada en el perfil (`csp_min_build`); la aplicación usa como referencia el build 2050 de los coches de ejemplo y emite la condición `ACTIVE` correspondiente.
- La aplicación se valida contra la documentación del SDK instalado en `extension/internal/lua-sdk/ac_car_scriptable_display/` (Anexo E).
- Content Manager es opcional pero se aprovecha si está: detección de rutas y lanzamiento de prueba.
- No se modifican `.kn5`, `data.acd` ni archivos con checksum online.

# 30. Requisitos de calidad

- Interfaz minimalista y clara; tema oscuro por defecto (editores gráficos) y claro opcional.
- Mensajes de error comprensibles; no ocultar errores de generación.
- No modificar archivos originales sin backup.
- No depender de rutas absolutas siempre que sea posible.
- Compatibilidad con diferentes instalaciones de AC mediante detección/configuración de ruta.
- Separar claramente configuración, perfiles, proyectos y archivos generados.
- Diseño ampliable para nuevos tipos de sensores, variables y componentes (catálogo y registro de tipos de elemento).
- [v2] Idiomas: español e inglés desde el inicio, textos externalizados.
- [v2] Registro de actividad (`log`) con nivel configurable, incluido en el paquete de soporte.
- [v2] Rendimiento: el editor mantiene 60 fps con 200 elementos en un lienzo de 2048 × 2048.
- [v2] Pruebas automáticas: unitarias (catálogo, generador, parser kn5, DDS), de integración (generar contra un coche de prueba) y comprobación sintáctica del Lua generado.
- [v2] Instalador y versión portable firmados/versionados; actualización manual sin perder configuración.

# 31. Fases de desarrollo [v2]

| Fase | Contenido |
| MVP (v1.0) | Selección de vehículo y perfil; imagen PNG; texto dinámico; barra RPM; shift light; barra genérica; indicador de marcha; icono/imagen; rectángulo; capas; deshacer/rehacer; preview con sliders; guardar/abrir `.acdisplay`; generar con INCLUDE, backup, restaurar y desinstalar; runtime v1; validación; ES/EN. |
| v1.1 | Gauges circulares; animaciones y parpadeos avanzados; DDS con mipmaps; fuentes DWrite y personalizadas; instalación en skin; brillo/noche; alinear/distribuir; atlas de iconos. |
| v1.2 | Modo creador completo con lector kn5; páginas; unidades avanzadas; biblioteca local de perfiles con versionado; brillo por botón en juego; lanzamiento desde Content Manager. |

# 32. Ejemplo de uso (actualizado)

Supuesto: el creador del Toyota Starlet Millington define en `extension/display_profile.json` un display sobre la malla `Plano_014_001`, tamaño físico 0,094 × 0,075 m y textura 1593 × 987 px, `KEEP_BACKGROUND = 1`, limitador 8000 rpm.

- El usuario abre la aplicación; ésta detecta AC y lista los coches. Selecciona el Starlet.
- El programa encuentra el perfil dentro del coche y muestra 1593 × 987 px y la malla.
- Carga `DriverDisplay.png`. El programa confirma que la resolución es correcta y avisa de que tiene canal alfa.
- Añade "Velocidad", la arrastra a su posición y ajusta el tamaño.
- Añade "Marcha" y la centra con la guía inteligente.
- Añade "Barra RPM" con 0–100 % del limitador; advertencia al 85 % y zona roja al 95 %.
- Añade Shift Light al 94 % (7520 rpm).
- Previsualiza 6500, 7500 y 8000 rpm y el escenario "noche".
- Guarda el proyecto `ToyotaStarlet_Display.acdisplay`.
- Pulsa "Generar e instalar" en el coche. La aplicación crea backup, escribe `extension/driver_display.lua` y sus imágenes, añade la sección a `ext_config.ini`, valida el Lua y muestra el resumen.
- Abre Assetto Corsa (o pulsa "Probar en CM") y comprueba el resultado, también en un replay.

# 33. Requisito de diseño más importante

La aplicación no debe intentar convertir al usuario en programador. Toda opción técnica que pueda predefinirse en el perfil del creador debe quedar automatizada. El usuario debe trabajar principalmente mediante selección, arrastrar/soltar, redimensionado y configuración visual.

# Anexo A. Esquema de display_profile.json (v2)

```
{
  "profile_version": 2,
  "id": "av_toyota_starlet_millington.driver_display",
  "name": "Toyota Starlet Millington – Driver Display",
  "author": "Nombre del creador",
  "car_ids": ["av_toyota_starlet_millington"],
  "min_app_version": "1.0.0",
  "min_runtime_version": "1.0.0",
  "csp_min_build": 2050,
  "displays": [
    {
      "id": "driver_display",
      "name": "Driver Display",
      "meshes": ["Plano_014_001"],
      "texture_size": { "width": 1593, "height": 987 },
      "physical_size_m": { "width": 0.094063, "height": 0.075243 },
      "uv_region": { "x": 0, "y": 0, "width": 1, "height": 1 },
      "keep_background": true,
      "skip_frames": 1,
      "max_distance_m": 50,
      "emissive": {
        "mode": "shader_replacement",
        "shader": "ksPerPixel",
        "ks_emissive": [1, 1, 1],
        "brightness_default": 1.0
      },
      "extra_ini": [],
      "defaults": {
        "rpm_limiter": 8000,
        "rpm_warning_pct": 0.85,
        "rpm_redline_pct": 0.95,
        "max_fuel_l": 60,
        "water_temp_range": [40, 130]
      },
      "variables_override": [],
      "fonts": ["fonts/c7_new"],
      "preset_layout": "presets/starlet_default.acdisplay"
    }
  ]
}
```

# Anexo B. Esquema de project.json (dentro de .acdisplay)

```
{
  "format_version": 1,
  "app_version": "1.0.0",
  "profile": { "id": "av_toyota_starlet_millington.driver_display", "version": 2 },
  "display_id": "driver_display",
  "canvas": { "width": 1593, "height": 987 },
  "background": { "file": "assets/DriverDisplay.png", "locked": true, "mode": "fit" },
  "settings": { "units": "auto", "brightness": 1.0, "night_brightness": 0.6, "grid": 8, "snap": true },
  "pages": [
    {
      "id": "main",
      "elements": [
        {
          "id": "el_speed", "type": "text", "name": "Velocidad",
          "x": 1140, "y": 310, "width": 264, "height": 116, "rotation": 0,
          "visible": true, "locked": false, "opacity": 1,
          "binding": { "variable": "speed", "unit": "km/h", "decimals": 0 },
          "style": { "font": "c7_new", "size": 120, "color": "#FFCC00", "align": "center" },
          "rules": [
            { "when": { "variable": "rpm", "op": ">=", "value": "95%limiter" }, "set": { "color": "#FF2600" } }
          ]
        },
        {
          "id": "el_rpm", "type": "rpm_bar",
          "x": 150, "y": 43, "width": 1350, "height": 200,
          "config": { "orientation": "horizontal", "style": "segments", "segments": 16,
                      "min": 0, "max": "100%limiter", "warning": "85%limiter", "redline": "95%limiter",
                      "colors": { "normal": "#FFCC00", "warning": "#FF9900", "redline": "#FF2600", "limiter": "#0066FF", "off": "#222222" },
                      "limiter_blink_hz": 8 }
        }
      ]
    }
  ],
  "layers_order": ["el_rpm", "el_speed"]
}
```

# Anexo C. Estructura generada en el vehículo [v2.2]

```
content/cars/<car_id>/
  extension/
    ext_config.ini                    <- solo se añade el bloque:
                                         ; ACDG BEGIN driver_display
                                         ; ACDG FILES: driver_display.lua, driver_display_bg.dds, driver_display_icon_abs.png
                                         [SCRIPTABLE_DISPLAY_...]
                                         MESHES = LCD
                                         SCRIPT = driver_display.lua
                                         KEEP_BACKGROUND = 1
                                         SKIP_FRAMES = 1
                                         ; ACDG END driver_display
    display_profile.json              <- perfil del creador (no lo toca el usuario final)
    driver_display.lua                <- script autocontenido (configuración + runtime ACDG)
    driver_display_bg.dds / .png      <- fondo e imágenes del display (prefijo = id del display)
    driver_display_icon_<id>.png      <- iconos integrados usados
    <fuente>.ttf                      <- fuentes (compartidas entre displays)
    acdg_project.acdisplay            <- copia del proyecto para reeditar desde el vehículo

%APPDATA%/AC Display Generator/backups/<car_id>/2026-09-14_18-30-00/
    ext_config.ini, archivos generados anteriores, backup.json
```

# Anexo D. Catálogo inicial de variables

| id | Categoría | Lua | Unidad | physics_only |
| rpm | Motor | car.rpm | rpm | no |
| rpm_limiter | Motor | car.rpmLimiter | rpm | no |
| water_temp | Motor | car.waterTemperature | °C | no |
| oil_temp | Motor | car.oilTemperature | °C | no |
| oil_pressure | Motor | car.oilPressure | bar | no |
| turbo_boost | Motor | car.turboBoost | bar | no |
| battery_voltage | Eléctrico | car.batteryVoltage | V | no |
| speed | Conducción | car.speedKmh | km/h | no |
| gear | Conducción | car.gear | – | no |
| throttle | Conducción | car.gas | % | no |
| brake | Conducción | car.brake | % | no |
| clutch | Conducción | car.clutch | % | no |
| handbrake | Conducción | car.handbrake | % | no |
| steer | Conducción | car.steer | ° | no |
| lap_time | Tiempo | car.lapTimeMs | ms | no |
| last_lap | Tiempo | car.previousLapTimeMs | ms | no |
| best_lap | Tiempo | car.bestLapTimeMs | ms | no |
| delta | Tiempo | car.performanceMeter | s | no |
| current_sector | Tiempo | car.currentSector | – | no |
| sector_time | Tiempo | car.previousSectorTime | ms | no |
| lap_count | Tiempo | car.lapCount | – | no |
| estimated_lap | Tiempo | car.estimatedLapTimeMs | ms | no |
| fuel | Vehículo | car.fuel | L | no |
| fuel_max | Vehículo | car.maxFuel | L | no |
| fuel_per_lap | Vehículo | car.fuelPerLap | L | sí |
| tyre_pressure_fl..rr | Neumáticos | car.wheels[i].tyrePressure | psi | no |
| tyre_temp_fl..rr | Neumáticos | car.wheels[i].tyreCoreTemperature | °C | no |
| brake_temp_fl..rr | Neumáticos | car.wheels[i].discTemperature | °C | no |
| race_position | Sesión | car.racePosition | – | no |
| abs_mode | Estado | car.absMode | – | sí |
| abs_active | Estado | car.absInAction | bool | sí |
| tc_mode | Estado | car.tractionControlMode | – | sí |
| tc_active | Estado | car.tractionControlInAction | bool | sí |
| headlights | Estado | car.headlightsActive | bool | no |
| high_beams | Estado | car.highBeams | bool | no |
| turn_left | Estado | car.turningLeftLights | bool | no |
| turn_right | Estado | car.turningRightLights | bool | no |
| hazards | Estado | car.hazardLights | bool | no |
| pit_limiter | Estado | car.manualPitsSpeedLimiterEnabled | bool | sí |
| in_pit | Estado | car.isInPit | bool | no |
| in_pitlane | Estado | car.isInPitlane | bool | no |
| limiter_on | Estado | car.isEngineLimiterOn | bool | no |
| lap_valid | Estado | car.isLapValid | bool | sí |
| drs_active | Estado | car.drsActive | bool | sí |
| brake_bias | Estado | car.brakeBias | % | sí |
| extra_a..t | Estado | car.extraA … car.extraT | bool | no |
| session_time_left | Sesión | sim.sessionTimeLeft | ms | no |
| time_hours | Sesión | sim.timeHours | h | no |

Nota: las expresiones exactas se validan contra `lib.lua` del SDK de CSP instalado; los nombres de campos de `wheels[i]` se confirmarán durante la implementación.

# Anexo E. Referencia CSP verificada (SDK instalado)

Claves de `[SCRIPTABLE_DISPLAY_...]` observadas en coches instalados y en el SDK:

| Clave | Uso |
| MESHES | Malla(s) sobre las que se dibuja. Obligatoria. |
| SCRIPT | Ruta del script Lua relativa a `extension/`. |
| RESOLUTION | Resolución de la textura generada (opcional; por defecto la de la textura original). |
| DISPLAY_SIZE / DISPLAY_POS | Tamaño y posición del área de dibujo dentro de la textura (opcional). |
| KEEP_BACKGROUND | 1 para no limpiar la textura cada frame. |
| SKIP_FRAMES | Frames a saltar entre actualizaciones (rendimiento). |
| INTERACTIVE | 1 para displays con interacción por clic. |
| ACTIVE | Condición, por ejemplo `$" read('csp/version', 0) >= 2050 "`. |
| FORCE_UPDATE_AFTER | Ordenación respecto a otras entidades de la misma textura (navegador). |

API Lua relevante (`display.*` y `ui.*`):

- `display.rect { pos, size, color }`
- `display.image { image, pos, size, color, uvStart, uvEnd }`
- `display.text { text, pos, letter, font, color, alignment, width, spacing }` (fuentes bitmap de AC)
- `display.horizontalBar { pos, size, delta, activeColor, inactiveColor, total, active }`
- `ui.drawPie(center, radius, angleFrom, angleTo, color, image)`, `ui.pathArcTo`, `ui.beginRotation()/ui.endRotation()`
- `ui.dwriteText`, `ui.DWriteFont` (fuentes TTF)
- `ac.currentDisplaySize()`, `ac.currentDisplayTextureResolution()`, `ac.skipFrame()`, `ac.boostFrameRate()`
- `ac.configValues{}` para leer parámetros de la sección INI desde el script
- `car.*` (ac.StateCar), `sim.*` (ac.getSim()), `car.physicsAvailable`

Fuente: `extension/internal/lua-sdk/ac_car_scriptable_display/lib.lua` y `README.md`, y `ext_config.ini` de av_renault_clio_rally5_ph2, urd_darche_cup_2021 y av_toyota_starlet_millington.
