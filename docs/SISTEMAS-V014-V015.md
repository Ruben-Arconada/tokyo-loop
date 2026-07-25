# Sistemas añadidos en v0.1.4, v0.1.5 y post-RC1

Referencia técnica de los sistemas que entraron en estas versiones, con sus
constantes de ajuste y puntos de extensión. Complementa a `DIRECCION-ARTE.md`
(estética) y `ESTRATEGIA-GRAFICA.md` (presupuesto técnico).

## v0.1.4 — Puertas manuales y pasajeros sprite

### Puertas como gameplay (`src/game/Train.ts`, `src/game/Game.ts`, `src/ui/UI.ts`)

Estados del tren: `running → stopped → doors_open → doors_closing → running`.
Al clavar la parada las puertas NO se abren solas: el botón DOORS del HUD (y la
tecla **D**) llama a `Train.requestDoorAction()`, que abre en `stopped` y cierra
en `doors_open` una vez `boardingComplete`.

- Bonus de apertura: ≤ `OPEN_INSTANT_SECONDS` (2 s) = +30 «¡Puertas al instante!»;
  ≤ `OPEN_QUICK_SECONDS` (4,5 s) = +15. Cierre en ventana `CLOSE_WINDOW_SECONDS`
  (3,5 s tras fin de embarque) = +30 «¡Salida puntual!». Los bonus de puertas NO
  tocan la racha de paradas perfectas (`applyDoorBonus` vs `applyScore`).
- Salvavidas: auto-apertura a `OPEN_AUTO_SECONDS` (9 s), aviso a
  `CLOSE_HURRY_SECONDS` (5,5 s) y auto-cierre a `CLOSE_AUTO_SECONDS` (9,5 s) —
  sin bonus, imposible bloquearse.
- El embarque dura `BOARDING_BASE_SECONDS + crowdDensityForHour(hora) ×
  BOARDING_CROWD_SECONDS` — rango efectivo ≈6,4–11 s (la densidad tiene un
  suelo de 0,16, así que el mínimo teórico de 5,5 s nunca se da): hora punta =
  andén lleno = más espera.
- Fases del botón en el HUD: `idle / can-open / boarding (con barra) /
  can-close / closing` — ver `DoorPhase` en UI.ts.

### Pasajeros 2D (`src/game/Passengers.ts`)

Sprite-sheet 100 % canvas (8 arquetipos × 2 frames idle + 4 walk, celdas
128×192) en UNA `InstancedBufferGeometry` de billboards cilíndricos + otra de
sombras de contacto (2 draw calls totales). Animación idle/walk EN el vertex
shader (uTime + fase por instancia): coste CPU cero en crucero.

- Coreografía: `beginBoarding(estación, segundos)` — bajan 2-4 viajeros, los que
  esperan caminan por waypoints (primero a la Z de su puerta, luego al borde) y
  desaparecen al «subir»; `endBoarding()` al cerrar puertas embarca a los
  rezagados. El andén se repuebla 2 estaciones después (`lastBoardedStation`).
- Visibilidad ambiental por `crowdDensityForHour` con refresco cada 1,6 s.
- **LECCIÓN DURA**: en `ShaderMaterial` custom NO usar `cameraPosition` (no se
  refresca de forma fiable — los sprites no se dibujaban). La base del billboard
  sale de las filas de `viewMatrix`:
  `vec3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x)` = camera-right.
  Niebla en ShaderMaterial: `fog: true` + `UniformsLib.fog` + chunks `fog_*`.
- Es el primer ladrillo del futuro personaje a pie: misma tecnología de sprites
  + patrón «andar por waypoints sobre superficie conocida» (hoy `PLATFORM_GEOM`
  de City.ts; mañana `groundHeightAt`).

## v0.1.5 — Estaciones del año, clima, casas japonesas, pendiente

### Estaciones del año (`src/game/Seasons.ts`)

Dos ejes seleccionables en el HUD junto al reloj (chips 🌸🌿🍁⛄ y ☀️☁️🌧️),
persistidos en localStorage (`yamanote-season` / `yamanote-weather`).

Arquitectura: **pools estacionales** — cada `instanceColor` (o atributo de
vertex colors) se registra con `registerPool(kind, attr, [rango])`, que guarda
una copia de los colores de fábrica; `applySeasonToPool` los remapea con
`seasonalColor(kind, season, i, r, g, b)`. Es un repintado **one-off al cambiar
de estación**: coste por frame CERO. Biomas (`FoliageKind`): `broadleaf`
(momiji procedural en otoño con hash determinista por instancia), `pine`,
`scrub`, `sakura`, `sakuraEver`, `roof`, `terrain`, `mountain`.

- **REGLA DE ORO del overdrive**: los vertex/instance colors multiplican
  texturas oscuras (suelo ≈ 0,3 de luma; tejas ≈ 0,5). Para que una estación se
  LEA hay que superar 1.0: terreno otoño `lerp(STRAW,0.55)×1.85`, invierno
  `lerp(FROST,0.75)×2.7`, tejados invierno `lerp(SNOW_WHITE,0.82)×1.7`. Sin el
  overdrive todo queda olivo/pizarra (falló la ronda 1 del panel por esto).
- **Sakura perenne de Komagome** (decisión del director, botánicamente
  imposible a propósito): bosquecillo de 12 cerezos alrededor del andén de la
  colina registrado como `sakuraEver` (florece las 4 estaciones, sus pétalos
  caen todo el año) + 5 momiji fijos (`APPROACH_MAPLES` en `buildHillDressing`)
  en la llegada, para que en otoño convivan momiji rojo y sakura rosa en el
  mismo encuadre.
- Fuji invernal: segunda malla de nieve con snowline 0,28 (vs 0,55), conmutada
  por visibilidad en `Scenery.setSeason`.
- Invierno también encala el balasto (`ballastMat.color ×1.65`) y funde la banda
  de desgaste (`wearMat.opacity 0.25`) — en `Game.applyAtmosphere()`.

### Clima (`src/game/DayNightCycle.ts`, `src/game/Precipitation.ts`)

- `overcastGoal/overcast` en DayNightCycle: el cielo colapsa a un gris con
  **luminancia objetivo derivada del sol** (`dayLevel`) — un nublado de mediodía
  es perla LUMINOSA, no crepúsculo. Bajo nublado: sin sombras duras (o≥0,55),
  sin sol/luna/estrellas, niebla más cercana, ambient ligeramente arriba.
- `Precipitation`: cortina de quads instanciados en una caja de 38×26×38
  alrededor de la cámara, posiciones 100 % en shader; CPU por frame = un puñado
  de escrituras de uniform. **Invierno + precipitación = nieve** (mismo sistema,
  otro disfraz). Reescrita después de la RC1 → ver «Clima que responde al tren».
- Audio de lluvia (`AudioEngine.setRain(level)`): wash lowpass 850 Hz + patter
  bandpass destunado (playbackRate 1.31), fades de 1,2 s, respiración
  ±20 % (LFO 0.44 rad/s). La nieve entra a level 0,12 = casi muda. Coro
  estacional en `updateTimeAmbience`: primavera uguisu, verano cigarras ×2,1,
  otoño `playSuzumushi` (2 pulsos con vibrato LFO 26-34 Hz), invierno silencio
  nevado; insectos bajo lluvia con suelo 0,25 (se alejan, no se mudan).

### Casas japonesas (`Scenery.buildHouseRows`, reescrito entero)

500 casas compuestas desde ~12 pools instanciados: muros achaflanados
(`RoundedBoxGeometry` 1 segmento), tejados kirizuma (prisma) y **yosemune**
(cadera con caballete corto), irimoya = hip + gable apilado (composición, no
geometría nueva). Arquetipos: `gable` 42 % / `lplan` 20 % (ala con caballete
girado 90°) / `nikai` 16 % (dos plantas + irimoya) / `engawa` 22 % (tarima,
postes y alero). Cada parcela: cercado con hueco de puerta, 2 postes,
mini-tejadillo kirizuma sobre la puerta y camino de tierra hasta la casa (solo
en parcelas llanas, `spread < 0.4`).

- Entradas miran a la vía… salvo un **30 % `backTurned`** (desde un tren real se
  ven traseras). 
- **Laderas**: se sondea el terreno bajo el borde de la huella
  (`gMin`/`spread`) y muros/cercas/postes se ESTIRAN hacia abajo hasta el punto
  más bajo — enterrado cuesta arriba está bien, flotar cuesta abajo no
  (feedback en vivo de Rubén).
- Los postes de las balizas de distancia van 0,18 unidades POR DETRÁS del
  cartel (mismo feedback).

### Pendiente arcade (`Track.gradeYAt`, `Train.ts`)

`GRADE_ACCEL_KMH_S = 8.8` × componente Y del tangente unitario = el 16 % visual
de Komagome se comporta como un 4 % físico (factor 0,25 acordado).
`gradeYAt` es analítico (del perfil `hillGrade`), sin muestrear la curva y sin
alocaciones — no usar `tangentAt` en el bucle de física.

### Rendimiento (regla de Marco)

150-164 draw calls según vista (presupuesto ~160). `lerpKeyframes` reescrito
sobre scratch (cero clones/frame; **el Keyframe devuelto es efímero — no
cachear referencias**). Overlay de perf: tecla **P** (FPS + draws + tris; las
lecturas diurnas incluyen el pase de sombras: ~670k tris vs ~400k de noche).

### Testing sin conducir (arnés de esta casa)

`window.__game` existe en DEV. Con el panel del navegador oculto no hay rAF:
avanzar a mano — `game.train.update(1/60)` + `game.step(1/60)` en bucle +
`game.renderOnce()`. Teleport: `train.progressFraction =
track.markerFor(i).tFraction - unidades/track.getLength()`. Captura:
`renderOnce()` y en el MISMO tick dibujar el canvas GL sobre un canvas 2D →
`toDataURL`.

## Proceso de calidad: «se reúne el equipo»

v0.1.5 se aprobó con un panel de 7 jueces-persona (los ficticios de
`src/data/team.ts`, cada uno su aspecto) puntuando capturas + código en 2
rondas hasta consenso ≥8/10 en todo (ronda 2: 8,9,8,9,8,8,9). Pendientes que
dejaron anotados para v0.1.6: parar las BufferSources de lluvia a gain 0,
gotas 2D en el parabrisas, nieve cuajada en traviesas, aclarar la textura base
del suelo (~0,45 de luma) para dar margen a las estaciones, code-split del
chunk de 718 kB, lowpass a insectos bajo lluvia, y una escucha real del audio
(el panel no puede oír).

---

## Post-RC1 — Clima que responde al tren, tormenta y panel «Atmósfera»

### La precipitación se dibuja en el marco de referencia de la cabina (`Precipitation.ts`)

Lo que ve el maquinista no es la caída de la gota sino su **velocidad
aparente**: gravedad + viento − movimiento del tren. Por eso el quad ya no es
una raya vertical fija, se construye **en espacio de vista a lo largo de ese
vector**. Consecuencias, todas derivadas de la misma física:

- Parado, la lluvia cae vertical y la nieve flota redonda. En marcha las
  estelas se alargan y **radian desde el punto de fuga** (cortas en el centro,
  muy inclinadas en los bordes), que es lo que se ve por la luna delantera.
- El alargamiento usa `length(velView.xy)` — la componente que **cruza** el
  cristal — menos `uFallSpeed`, para que la gravedad sola nunca estire una gota
  parada. `vRound` decide en el fragment si el quad se pinta como raya o como
  copo redondo, así que la nieve rápida se convierte en estela sin código extra.
- La velocidad de la cabina se **deriva de la posición de la cámara** (no del
  `speedKmh` del tren): lo que importa aquí es la dirección real de avance por
  el mundo. Suavizada y limitada, para que un frame largo o un teleport no
  desplacen la cortina de golpe.
- Densidad variable sin tocar buffers: se descartan instancias por hash contra
  `uDensity` (chirimiri y aguacero cuestan lo mismo).
- Distancias de caída/deriva **acumuladas en CPU** (`uFall`, `uDrift`), no
  `uTime × velocidad`: si no, cada cambio de clima teletransportaba todas las
  gotas. `uFall` se envuelve a 10·box.y y las velocidades por instancia son
  décimas discretas (0,8…1,2) para que en el wrap el producto siga siendo
  múltiplo exacto de la caja y ninguna gota salte.

**Dos trampas que costaron una bisección** (además de la de `cameraPosition`
de v0.1.4): (1) `smoothstep(edge0, edge1, x)` con `edge0 > edge1` es
**indefinido** en GLSL — devolvía NaN y se comía la cortina entera; (2) orientar
el quad a lo largo de un eje que apunta hacia ABAJO invierte el winding del
plano y **backface culling** lo borra: la cortina necesita `side: DoubleSide`.

### Tormenta y fases por hora (`Seasons.ts`, `DayNightCycle.ts`)

- Cuarto estado de clima: `storm`. En invierno se llama **ventisca** —
  `weatherFace(weather, season)` renombra en la UI (Lluvia→Nieve,
  Tormenta→Ventisca), porque «Lluvia» en enero es mentira.
- `precipProfile(weather, season, hour)` devuelve en un objeto **scratch** (se
  lee cada frame) densidad, viento, escala de caída y niveles de audio. El
  viento lateral existe solo en tormenta: la lluvia normal se inclina
  únicamente porque el tren se mueve.
- **Fases por hora** en vez de más opciones de menú: `rainPhase01(hour)` va de
  0,62 (chirimiri de madrugada) a 1 (pico convectivo de la tarde) y multiplica
  densidad, caída y audio. `rainPhaseLabel()` lo hace visible en el panel
  («chirimiri» / «lluvia constante» / «aguacero» / «tormenta encima»).
- Relámpagos en `DayNightCycle`: `stormy` + `flash`. Es luz **de lámina** (el
  cielo entero se vuelve la fuente), no un sprite de rayo ni una direccional —
  una direccional proyectaría sombras duras imposibles bajo nubes. Cada
  descarga tiene su reflash a los ~0,1 s. `onLightning(delay, strength)` avisa
  al audio: el sonido viaja, así que la fuerza del destello ES la distancia y
  decide cuántos segundos tarda el trueno. **La ventisca no tiene rayos.**
- `overcastTarget('storm')` = 1,15, por encima del tope: cualquier `1 - o` que
  multiplique opacidades tiene que ir **clampado** (`clearAmount`).

### El sonido del clima depende de dónde estás sentado (`AudioEngine.ts`)

`updateWeatherBed()` re-voicea lluvia y viento cada frame. Dos cosas mandan, y
ninguna es el clima:

- **Velocidad**: parado oyes el wash (la lluvia ahí fuera); en marcha las gotas
  llegan AL cristal — el patter sube ×2,2 y su banda se abre de 3,2 a 5,6 kHz.
- **Puertas**: abrirlas mete el exterior dentro (+55 % y más brillo). Es el
  momento en que el clima suena más fuerte de todo el juego.
- `setWind(level)` es una capa nueva con rachas propias (LFO doble) y filtro que
  silba al subir la racha. Es la única voz de la ventisca: la nieve no suena, y
  sin viento una ventisca sonaba igual que una tarde despejada de invierno.
- `thunder(strength, delay)` se programa con Web Audio: retumbo de ruido con
  lowpass que se cierra durante la caída (2,2-5,6 s según distancia) + dos
  hinchadas dentro, y un crack brillante solo si la descarga es cercana.
- El bed de clima hace **duck bajo la megafonía** (0,65 — más suave que el
  motor) para que una tormenta respire por debajo del aviso.

### Panel «Atmósfera» (`UI.ts`)

Hora + estación + clima vivían en tres desplegables gemelos colgando de la
barra superior, que en un móvil son 40 px de pantalla: esos tres chips eran
justo lo que empujaba las píldoras de estación a una segunda fila. Ahora hay
**un solo chip** (el reloj, que ya muestra el estado: `12:31 🌸⛈️`) que abre una
hoja centrada con las tres secciones y todas las opciones visibles a la vez.

- **No pausa**: el sentido del panel es ver el cielo responder, así que el mundo
  sigue rodando detrás de un fondo más claro que el de los demás overlays.
- En vertical la barra vuelve a **una sola fila** hasta 320 px de ancho (las
  píldoras encogen con elipsis, no envuelven) y el diagrama de línea recupera su
  sitio a 58 px. En apaisado (`max-height: 560px`) las tres secciones se
  reordenan en columnas para que no haya scroll.
- `updateAtmoPhase()` se llama cada frame pero solo toca el DOM cuando el texto
  cambia (comparación de strings).
- También se llega desde el menú de pausa («Atmósfera»), que se cierra al abrirlo.

### Arnés de test (ampliado)

`window.__audio` existe también en DEV: el singleton de audio no tenía ningún
asa desde consola y **todo el sonido es sintetizado**, así que leer los nodos de
ganancia y las frecuencias de filtro es la única forma de comprobar una mezcla
sin oírla en el dispositivo. Con el AudioContext corriendo, `gain.value`
converge de verdad — pero hace falta tiempo de reloj real entre fijar el target
y leerlo (el bucle síncrono de `step()` no avanza `ctx.currentTime`).
