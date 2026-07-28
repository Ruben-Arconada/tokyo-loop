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

### Telemetría de rendimiento (`src/game/PerfLog.ts`)

Grabadora de tiempos de frame para sesiones en dispositivo real. **No mide
«fps medios»**: una vuelta que promedia 59 fps pero suelta tres frames de 80 ms
en el bosquecillo de Komagome se siente a tirones, y 45 fps estables se sienten
suaves. Por eso guarda la DISTRIBUCIÓN, DÓNDE pasó cada tirón y CÓMO evoluciona
minuto a minuto (que es lo que delata a un móvil estrangulándose por calor).

- Coste por frame: unos cuantos incrementos enteros sobre arrays preasignados.
  Sin allocations, sin DOM, sin timers — el medidor no puede ser el motivo de que
  un frame vaya lento.
- Percentiles desde un **histograma** de 0,5 ms (no se guarda el array de
  frames). `p05` delata el techo de refresco: 16,7 ms = 60 Hz, 8,3 ms = 120 Hz.
- Se mide el intervalo **crudo** del bucle de render, no el `dt` clampado que usa
  la simulación: el tirón que el acumulador de física se traga es justo el que el
  jugador vio.
- **Un «frame» de más de 1 s no es un frame**, es el bucle suspendido (menú de
  pausa, app en segundo plano). Se excluye de las estadísticas y se cuenta como
  `gaps` — si no, una pausa de 30 s se convierte en el p99.
- Se persiste en `localStorage` cada 5 s: si iOS mata la pestaña a mitad de
  vuelta, el log sobrevive y el menú lo ofrece marcado «(sesión anterior)».

Formato de exportación (JSON compacto, ~13 KB por vuelta completa de 7 min):

```
v        5
ctx      { version, commit, ua, gpu, gpuTimer, dpr, cap, vw, vh, pwa, season,
           weather, weatherAuto, camera, hour, timeScale, shadows, muted }
summary  { seconds, frames, meanFps, p05, p50, p95, p99, maxMs, over17, over33,
           over50, maxDraws, maxTris, gaps, programs0, programsEnd,
           textures0, texturesEnd, texUploads0, texUploadsEnd, shadowFrames }
bins[]   [tSec, frames, meanMs, maxMs, draws, kTris, kmh, progress‰]  ← uno por segundo
hitches[][tSec, ms, renderMs, prevTickMs, gapMs, progress‰, station, draws,
          kTris, programasNuevos, texturasSubidas, tags]              ← peores primero
costs    { tag: [veces, msTotal, msPeor] }                            ← bloqueo SÍNCRONO en el móvil
```

### ⚠️ `ms` y `renderMs` NO miden el mismo fotograma (y por eso están los dos)

`ms` es el intervalo, y se toma **al principio** del tick: cubre el trabajo del
fotograma ANTERIOR. `renderMs` se mide alrededor de `renderer.render()` y es de
ESTE. La v3 emparejaba `ms` con los contadores de recursos leídos tras el
render, y eso desplazaba todo un fotograma: un render de 320 ms que enlazaba
dos programas apuntaba los programas a un fotograma de aspecto normal y los
320 ms al siguiente, que no había enlazado ninguno. **La columna puesta para
demostrar la compilación la habría desmentido siempre.** Por eso un tirón se
dispara con el PEOR de los dos relojes, se ordena por el peor de los dos, y el
eco del fotograma siguiente no se cuenta aparte. Lo sujeta
`test/perfLog.test.ts`; la línea base de recursos se toma en `start()` desde el
renderer, no del primer fotograma.

**Cómo se lee un tirón**: mira `renderMs` primero, pero sabiendo qué es —
**tiempo de CPU BLOQUEADO dentro de `renderer.render()`, no tiempo de GPU**.
WebGL es asíncrono: el trabajo de driver que dispara un dibujado (enlazar un
programa, subir una textura) no tiene por qué pagarse dentro de la llamada que
lo provocó. Así que un `renderMs` alto es evidencia fuerte de que el parón es
del lado del render; uno bajo **no** exonera a las columnas de recursos, porque
el coste puede caer en el siguiente dibujado o en el swap. Descartar GPU de
verdad exige `EXT_disjoint_timer_query_webgl2`, y por eso `ctx.gpuTimer` dice
si el dispositivo lo ofrece.

Con eso en la mano, `programasNuevos` y `texturasSubidas` separan «enlazó un
shader» de «subió una textura». Medido en escritorio, al entrar en una estación
nueva pasan LAS DOS cosas (Kiyomizu: +25 programas y +9 texturas), así que en
el móvil hará falta el dato real para decidir.

### Fases del frame (`f:*` en `costs`)

`perfPhase()` mide un bloque **sin dejar marca**, al revés que `perfTime()`.
La diferencia importa: el anillo de marcas tiene 48 huecos y sirve para que un
tirón nombre lo que pasó justo antes; marcar doce fases a 60 Hz lo reescribiría
dieciséis veces por segundo y **todos los tirones volverían etiquetados con la
última fase**, borrando justo la evidencia que el anillo existe para guardar.
Verificado: una marca real sobrevive a 4.800 mediciones de fase.

Hoy están medidas `f:physics`, `f:step`, `f:daynight`, `f:city`, `f:flow`,
`f:schedule`, `f:passengers`, `f:scenery`, `f:transfer`, `f:consist`,
`f:precip`, `f:windshield`, `f:audio`, `f:camera`, `f:lever` y `f:hud`.

⚠️ **Las fases NO se suman a `frameMs`, y decirlo aquí fue un error.** `frameMs`
es el intervalo ANTERIOR al tick y las fases son de ESTE, así que sumarlos
compara fotogramas distintos — el mismo fallo que el desfase original con otra
cara. Lo que los máximos de `costs` sí demuestran es que **ninguna fase medida
llegó nunca a tardar 320 ms en toda la grabación**, que es una afirmación más
débil pero cierta. Y las fases tampoco cubren todo nuestro código: `record()`,
el sondeo de subidas y el chip de fps quedan fuera de ellas.

Para eso están **`prevTickMs`** (el callback anterior ENTERO, esas tres cosas
incluidas) y **`gapMs`** (desde que devolvimos el control hasta que nos vuelven
a llamar). Los dos pertenecen al mismo intervalo que `frameMs`, así que
**`ms ≈ prevTickMs + gapMs`** sí es una ecuación que se sostiene, y lo sujeta
`test/perfLog.test.ts`. Un tirón con `gapMs` grande pasó fuera de nuestro
callback: compositor, GC, temporizadores, callbacks de audio o trabajo del
driver diferido más allá del swap.

**Coste del propio instrumento**: envolver una fase asigna una closure por
fase y fotograma (~16), se grabe o no. Es garbage que antes no existía, y con
el GC entre los sospechosos hay que tenerlo presente — cuando la caza termine,
estas fases deberían salir o quedar tras una bandera.

### 🧪 Prueba de tirones automática (menú de pausa)

El diagnóstico de las congelaciones por estación se lanza solo. Botón
**«Prueba de tirones (auto, ~2 min)»** → conduce él, y al terminar abre el menú
con el log listo para copiar. Hace falta porque el protocolo manual tiene
CUATRO condiciones y cualquiera invalida la tanda:

1. **Alternar DOS estaciones** (Kiyomizu ↔ Fushimi Inari). Saltar dos veces a
   la misma no cambia `targetStationIndex`, así que `updateLever` no recrea la
   tablilla de destino y esa hipótesis queda sin probar.
2. **Vista de CABINA**. La tablilla cuelga de `cabRig`, oculto en exterior y
   andén: se recrearía sin llegar nunca a subirse a la GPU.
3. **Llegar al anuncio**. `ARRIVING_ANNOUNCE_DISTANCE` es 260 y el salto
   aterriza a 300: saltando en el acto se prueban los recursos visuales y
   nunca la ruta de audio.
4. **No pausar en medio**. `setRunning(false)` dibuja un fotograma que nadie
   registra y calienta recursos fuera del log — si se pausa, la prueba **se
   cancela sola** y lo dice, en vez de devolver una tanda que parece buena.

Arranca la grabación unos fotogramas DESPUÉS de fijar la cabina, para que la
primera subida de la propia cabina caiga en la línea base y no en el primer
tirón.

**Sí se puede lanzar SILENCIADA, y hace falta**: el A/B del audio son dos
arranques en frío idénticos, uno con sonido y otro sin él, y `ctx.muted` dice
cuál fue cada log. Al principio se negaba a arrancar en silencio para que nadie
invalidara la rama de audio sin querer; ahora que el parón está fuera de todas
las fases síncronas, esa comparación es justo la que falta.

**Ojo en dev**: `version`/`commit` se inyectan con `define` de Vite, que se
evalúa al ARRANCAR el servidor — en `npm run dev` el commit se queda congelado
en el que hubiera entonces. En un build de producción es siempre el del build.

**La base de `texturasSubidas` se sondea SIEMPRE, no solo grabando.** Si el
contador solo mirase durante la grabación valdría cero al pulsar grabar, y el
primer fotograma descubriría de golpe todas las texturas ya residentes y las
apuntaría como subidas nuevas: un pico inventado, en el primer fotograma,
señalando justo al sospechoso que se investiga. Lo sujeta
`test/textureWatch.test.ts`.

**`texturasSubidas` no es `texturesEnd`**: el total residente cuenta lo que hay
vivo, y la tablilla de destino se destruye y se recrea en cada estación
(`updateLever`), así que una se va mientras otra llega y el total no se mueve.
El contador de subidas es monótono y sí lo ve. Vigila los 30 carteles de
estación (1024×384, se suben en su primer dibujado) y la tablilla.

`tags` son los eventos de juego marcados en los 2 s previos al tirón
(`perfMark`), y `costs` mide bloques envueltos en `perfTime` — los hooks están
al final de `PerfLog.ts` y son no-ops mientras no haya grabación. Hoy están
instrumentados `announce`/`chime`/`pa-bed`/`speak-init`/`speak` (la locución
trilingüe), `station`, `arriving`, `missed` y `perf-persist`. Sirve para no
adivinar: un tirón con nombre es un bug, y sin nombre es una corazonada.

**Si no hubo ningún evento en la ventana**, `tags` ya no viene vacío: trae
`~<último evento>+<edad>s`. Un vacío significaba dos cosas distintas («no
pasaba nada» y «lo que fuera pasó hace más de 2 s») y 16 de los 22 tirones
grandes de la primera vuelta real volvían vacíos.

**`programasNuevos` acota, no sentencia.** three enlaza un programa de shader
la PRIMERA vez que se dibuja un material, y en iOS ese enlazado bloquea el hilo
principal cientos de milisegundos: un frame de 320 ms que enlazó programas es
evidencia fuerte de compilación. **Al revés NO vale.** Un 0 no la descarta,
porque el driver puede diferir el trabajo al siguiente dibujado o al swap y el
coste caer en un frame que no enlazó nada — es la misma asincronía que impide
leer `renderMs` como tiempo de GPU, y por coherencia hay que aplicarla también
aquí.

Lo único concluyente es la escala de VUELTA: si `programs0 == programsEnd` no
se enlazó un solo programa en toda la grabación, y entonces la compilación no
explica nada de lo que pasó dentro. Igual con `texUploads0/texUploadsEnd`.

**`shadows` es el AJUSTE, `shadowFrames` es la realidad.** Bajo cielo cerrado
el sol deja de proyectar (`DayNightCycle`), así que una vuelta con lluvia
declara `shadows: true` y no paga el pase ni una vez. El caso peor (despejado
a mediodía) exige `shadowFrames` alto, no `shadows: true`.

`progress‰` es la posición en el anillo ×1000, así que un tirón se localiza en el
mapa: cruzar ese número con `docs/vista-cenital-tokyo-loop.jpg` o con los markers
de `Track` dice qué se estaba dibujando.

**Primera vuelta real (iPhone 14 Pro Max, PWA, iOS 18.7, invierno+tormenta,
2026-07-25)**: techo de 60 Hz (p05 15,3 ms — Safari no da 120 Hz aquí), 60 fps
clavados los 3 primeros minutos y decaimiento sostenido a ~44 fps a partir del
minuto 3 **con MENOS carga** (110→91 draws, 464k→438k tris), o sea estrangulamiento
térmico, no escena. 22 congelaciones de 315-347 ms, todas junto a un marcador de
estación y una por estación. `maxDraws` 125 < 160 del presupuesto. OJO: esa
vuelta fue con tormenta, y con `overcast` alto el sol NO proyecta sombras
(`castShadow` con o < 0,55), así que el pase de sombras no entró — el caso peor
(despejado a mediodía) sigue sin medir.

En el HUD: chip con el contador y punto rojo parpadeante mientras graba (encima
del marcador). En el menú de pausa: iniciar/detener, titular con el resumen, y
«Copiar log» (portapapeles dentro del gesto; si la plataforma lo rechaza, cae a
un textarea seleccionado). La tecla **P** hace el mismo toggle en escritorio —
sustituye al overlay de perf ad-hoc que había antes.

### Arnés de test (ampliado)

`window.__audio` existe también en DEV: el singleton de audio no tenía ningún
asa desde consola y **todo el sonido es sintetizado**, así que leer los nodos de
ganancia y las frecuencias de filtro es la única forma de comprobar una mezcla
sin oírla en el dispositivo. Con el AudioContext corriendo, `gain.value`
converge de verdad — pero hace falta tiempo de reloj real entre fijar el target
y leerlo (el bucle síncrono de `step()` no avanza `ctx.currentTime`).
