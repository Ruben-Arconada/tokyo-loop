# Japan Loop (ジャパンループ) — notas para Claude Code

Simulador de conducción ferroviaria en Three.js. PWA instalable desplegada en
GitHub Pages: `https://ruben-arconada.github.io/tokyo-loop/`.

El juego se llama **Japan Loop** desde 2026-07-26, pero el repo, la URL, el
`package.json` y el nombre de caché conservan "tokyo-loop" **a propósito**:
renombrar el repo rompería la PWA ya instalada en los móviles y la URL de Pages.

Sistemas y decisiones de diseño: `docs/SISTEMAS-V014-V015.md`,
`docs/ESTRATEGIA-GRAFICA.md`, `docs/DIRECCION-ARTE.md` y — para TODO lo
gráfico del ciclo 0.2.0 (atmósfera por distrito, halos, cristal de cabina,
regla de anclaje al suelo) — **`docs/SISTEMAS-0.2.0.md`**, que además lista
las condiciones firmadas por el panel; y **`docs/SISTEMAS-0.2.1.md`** para la
vertical Susukino→Nishiki, el kit modular, los pasajeros híbridos, sus
presupuestos y la comparación exacta contra 0.2.0; y
**`docs/SISTEMAS-0.2.1.2.md`** para el pase de fabricación de cabina, sus
texturas funcionales y el presupuesto post-merge. Quien toque gráficos lee
los documentos que afecten a su sistema antes de editarlo.

Dos reglas de ese ciclo que NO se pueden olvidar:

1. **Todo lo que se apoya en el suelo pregunta al suelo** (`groundHeightAt`
   cerca de la vía, `terrainRelief` lejos). Los carteles de neón flotaron
   desde su creación por una Y absoluta — los halos nocturnos los delataron.
2. **Lo que pertenece a una superficie 3D no puede vivir en un overlay 2D de
   pantalla** (va 1 frame por detrás y no se escorza). En el canvas 2D solo
   óptica de pantalla: gotas y flare. El aderezo del cristal es textura del
   plano 3D en CabInterior.

Reglas nacidas en 0.2.1:

3. **La fachada que mira a la vía se valida desde la cámara real.** En
   `frameAt`, el frente de un edificio colocado a `side * offset` está en
   `side * width/2`; el signo contrario escondió todo el detalle detrás.
4. **El volumen de estación incluye sus cámaras.** Las filas de barrio terminan
   antes del footprint de 70 m y no pueden invadir el CCTV fijo. Cabina,
   exterior y andén se revisan siempre.
5. **Detalle móvil = fusionado y con LOD.** La vertical estática no puede pasar
   10/12 draws ni 50k tri; el personaje 3D vuelve a sprite fuera de 108 u y no
   puede pasar 6 draws/10k tri. Los límites viven en `art021Contract.ts`.
6. **No uses una referencia image-to-3D como escena terminada.** Puede alimentar
   un hero prop aislado; estación/barrio se construyen con módulos editables,
   anclados y fusionables. Criterio y prompts en `SISTEMAS-0.2.1.md`.
7. **Una sola huella de andén.** `PLATFORM_GEOM` en `City.ts` gobierna
   procedural, ArtPass y ambos LOD de pasajeros. No redeclares 3/14/70.
8. **Presupuesto no significa pantalla blanca.** Los informes runtime lanzan
   en desarrollo; producción registra la infracción y sigue. El test debe
   ejercer `enforceStatic/HybridArtBudget`, la misma unidad que llama el
   builder.
9. **Detalle de cabina = ensamblado, no malla por tornillo.** Junta, wipers,
   biseles, marcos, tornillos e interruptores viven en una malla fusionada; los
   dos paneles laterales comparten geometría/material/textura. El informe real
   se expone en `data-cab0212` y no puede pasar 20 draws, 3.500 tri, 10 texturas
   y debe conservar cero luces/materiales lit. Las tres cámaras siguen siendo
   parte del contrato.

## ⚠️ El origen es COMPARTIDO con los demás proyectos (incidente 2026-07-28)

Todos los proyectos de Rubén se publican bajo el **mismo origen**
`ruben-arconada.github.io` — solo cambia la carpeta. Y `CacheStorage` (igual que
localStorage, IndexedDB y las cookies) está aislado **por origen, no por
carpeta**. Es decir: Japan Loop, Abismo y Abismo 2 comparten un único espacio de
cachés y se ven las claves entre sí.

**Qué pasaba:** los tres service workers tenían la misma línea en `activate`:

```js
keys.filter(k => k !== CACHE).map(k => caches.delete(k))   // ← MAL
```

Es el copia-pega clásico de "limpia tus versiones antiguas"… salvo que aquí
borraba **todas las claves del origen que no fueran la propia**, o sea las
cachés de los proyectos vecinos. Cada vez que se activaba una versión nueva de
un service worker (no en cada visita: solo al instalarse/activarse uno nuevo),
los otros dos juegos perdían su contenido offline y tenían que redescargarlo
todo en la siguiente visita **con conexión**. Si el jugador abría el juego sin
red después de eso, no había nada guardado.

Nadie lo detectaba porque cada repo, leído por separado, parecía correcto.

**La regla, para siempre**: el nombre de caché lleva prefijo de proyecto y el
borrado solo puede tocar claves con ESE prefijo.

```js
keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
```

## 🔧 El service worker se GENERA — no lo edites en `public/`

**`public/sw.js` ya no existe. No lo recrees.** La plantilla es
[src/sw-template.js](src/sw-template.js) y el plugin `swGeneration` de
[vite.config.ts](vite.config.ts) emite el `sw.js` real en cada build,
horneándole dentro la **generación** y la **lista exacta de ficheros
emitidos**. **Ya no se bumpea ningún `CACHE` a mano**: cada build tiene su
caché `tokyo-loop-<generación>` y el `activate` barre las anteriores.

Cuatro invariantes que costaron una prueba fallida cada una:

1. **Horneado, no leído por red.** Un SW se mata y reinicia constantemente; si
   necesita `fetch` para saber el nombre de su propia caché, offline no sirve
   NADA. Lo que haga falta para responder sin red va dentro del worker.
2. **Instalación transaccional**: bundles primero, `index.html` al final, y si
   algo falla `caches.delete(CACHE)` antes de propagar el error — `caches.open`
   crea la caché antes de que `addAll` pueda fallar, así que un despliegue a
   medias dejaría una caché huérfana.
3. **La generación cubre TODO lo que forma una generación**: nombres de
   bundles + la plantilla + `index.html` + el manifest. Con solo los bundles,
   cambiar el worker sin tocar un chunk reutilizaba el nombre de la caché VIVA
   y una instalación fallida la borraba.
4. **La revalidación va en `event.waitUntil()`**. Al servir desde caché se
   responde antes de que la red termine, y un worker sin nada pendiente lo
   matan — con la escritura a medias.

**Cómo se prueba** (el navegador integrado bloquea la navegación con el
servidor caído, así que hay que pedir con `fetch` desde la página ya cargada):
servir `dist/` dentro de una carpeta `tokyo-loop/` con
`python3 -m http.server`, y comprobar los cuatro casos: instalación, offline
(matando el servidor), actualización y actualización interrumpida.

Arreglado a la vez en los tres repos afectados: `tokyo-loop`, `abismo` y
`abismo-2`. `neon-exodus-2087` tiene manifest pero todavía no tiene service
worker: si algún día se le añade uno, debe nacer con prefijo.

**localStorage vive en el mismo origen compartido.** Por eso todas las claves de
este juego van prefijadas (`yamanote-season`, `yamanote-best-score`…). Mantener
esa costumbre: una clave genérica tipo `settings` chocaría con la de otro juego.

## 🎲 El mundo estático es DETERMINISTA — no metas `Math.random()` en él

Ver [src/game/Rng.ts](src/game/Rng.ts). La semilla por defecto es
`japan-loop-0.5-world-1` y `?seed=loquesea` reparte otro Japón. Cada **sistema**
tiene su propio flujo (`worldStream('vegetation')`, `'city'`, `'houses'`…), y eso
es lo importante: con una secuencia global, añadir una sola llamada en cualquier
sitio desplaza todos los sorteos posteriores y rebaraja el mundo entero.

Reglas al tocar el escenario:

1. **Nada de `Math.random()` en la construcción del mundo.** Usa el flujo del
   sistema que estés tocando.
2. **Dos módulos no pueden compartir nombre de flujo** o sortearán exactamente
   los mismos números. Le pasó a Scenery y City con `'city'`; hoy son
   `'skyline'` y `'city'`.
3. **Las texturas son artwork, no reparto**: semilla FIJA (`mulberry32(0x…)`),
   para que se vean igual en todos los mundos. Todo `signage.ts` va así.
4. **Lo dinámico se queda sin sembrar a propósito** (pasajeros, precipitación,
   frentes de clima, audio): es jugabilidad, no maquetación. Márcalo con
   `userData.dynamic = true` para que no ensucie el fingerprint.
5. **Las melodías tienen su propia semilla por estación** y su propio
   `hashString` local: cambiar de mundo no puede cambiar lo que suena en
   Kiyomizu, y unificar ese hash reescribiría las treinta.

**Cómo se comprueba** (en dev, consola): `__worldHash()` devuelve un
fingerprint CUANTIZADO de los datos generados — matrices, colores y atributos
instanciados. **No compares capturas píxel a píxel**: WebGL cambia con la GPU,
el driver y el antialiasing aunque el mundo sea idéntico. `__fingerprintDiff(a,b)`
dice qué partes se movieron. El informe de rendimiento (**`PerfLog` v4**) lleva
la semilla, la versión y el commit: dos vueltas solo son comparables si
coinciden los tres. Formato y trampas en `docs/SISTEMAS-V014-V015.md`.

`__semanticHash()` es el gemelo **ciego a la partición**: agrupa las
instancias por el nombre que declara el builder (`tagGroup`), las ordena como
CONJUNTO y digiere con el recuento dentro, así que da igual si un pool está
entero o repartido en ocho sectores. Es el que tiene que referenciar la
sectorización; el estructural cambiará entonces y eso es correcto.

### Cómo se comprueba que un refactor no cambió el mundo

Los tres huecos que había aquí (escenario sin fijar, nubes contaminando el
mundo estático, ~110 grupos sin etiquetar) están **cerrados**. El contrato hoy:

- **Escenario canónico** (`CANONICAL_SCENARIO` en `worldHash.ts`): semilla por
  defecto + primavera + despejado + clima automático APAGADO. Cárgalo con
  **`?canon`**, que lo fija ignorando lo que haya en `localStorage` — sin él,
  un perfil dejado en invierno da otro número y parece un cambio del mundo.
  Los dos fingerprints llevan dentro el escenario y avisan por consola si no
  es el canónico.
- **`__checkWorld()`** en la consola de dev recorre las CUATRO estaciones,
  compara con la tabla de `src/game/worldReferences.ts` y deja el mundo como
  estaba. Las cuatro hacen falta: una partición puede conservar primavera y
  romper el repintado estacional, que reescribe doce búferes de color.
- **`?canon&checkWorld`** ejecuta el mismo chequeo y escribe el resultado en
  `data-world-check`; `data-art021` y `data-render-info` exponen en dev el
  presupuesto real post-merge y el último frame para auditorías automatizadas.
  Receta independiente literal: servidor en `127.0.0.1:5173`, vaciar
  localStorage/sessionStorage, abrir
  `http://127.0.0.1:5173/?canon&checkWorld` dos veces. Mide el mundo entero en
  `spring→summer→autumn→winter`, no «cuatro estaciones» ferroviarias. El
  auto-check se ejecuta directamente tras el constructor: no lo vuelvas a
  meter en `requestAnimationFrame`, que se congela en tabs de automatización.
- **`npm test`** ejecuta las propiedades de partición sin navegador
  (`test/worldHash.test.ts`, runner nativo de node, sin dependencias nuevas):
  las mismas instancias en 1, 2 y 8 sectores dan un solo hash, contiguas o
  repartidas en round-robin.

Al sectorizar: **el semántico DEBE seguir igual, el estructural cambiará** y
eso es correcto — re-captura el estructural cuando el refactor esté cerrado.

### ⚠️ Alcance EXACTO de la garantía (no es «todo el mundo»)

Lo que se puede afirmar: **los pools INSTANCIADOS se pueden repartir entre
sectores libremente y el hash semántico aguanta**. Lo que NO:

- **Solo se recorren `Mesh`, `Points` y `Line`.** `Sprite` queda fuera (sol y
  luna, que van marcados `dynamic` a propósito para que la exclusión esté
  declarada y no sea un accidente). Cualquier tipo dibujable nuevo es
  invisible al hash hasta que el recorrido lo aprenda. Esto ya mordió: los
  cables del tendido llevaban `tagGroup` y **no entraban en el hash**, así que
  parecían cubiertos sin serlo.
- **`Points` y `Line` se digieren como UN registro con el búfer entero**, al
  revés que las instancias, que se aplanan una a una. Vale mientras cada uno
  sea un objeto único; deja de valer el día que se sectorizen estrellas,
  pétalos o la catenaria. Aplanarlos antes de tocarlos.

**Una referencia escrita a mano se pudre.** El número viejo `e7cdb9f8` se
anotó como «el semántico de la semilla por defecto» y al re-medirlo en el
mismo commit con almacenamiento limpio daba `851a0eed`; nunca se supo por qué.
Por eso la tabla vive en el repo y la compara `__checkWorld()`, no el ojo.

## 🧩 Sectorización del anillo (prueba 1 medida, tras bandera)

Informe completo con tablas: `docs/SECTORIZACION-PRUEBA-1.md`. Lo esencial:

- El culling de frustum siempre estuvo BIEN; no tenía dónde morder: cada uno de
  los ~89 `InstancedMesh` abarca el anillo entero, así que su esfera envolvente
  siempre corta el frustum. Medido: 78 de 89 pools se dibujaban ENTEROS.
- **`src/game/sectorize.ts`** parte los pools como PASE POSTERIOR sobre la
  escena construida, detrás de **`?sectors=N`** y **apagado por defecto**.
  Salta lo `dynamic`, lo sin `tagGroup`, pools <24 instancias y los ya locales.
  NO toca `Points`/`Line`/`InstancedBufferGeometry` (ver alcance, arriba).
- Contrato verificado: semántico `494d8caa` idéntico a 1/4/6/8; el estructural
  cambia con cada N. Triángulos −34 %…−62 %; draws suben a 200–298. **El
  veredicto lo da el iPhone con tiempo de frame**, no un Mac contando draws.
- **El botón «Prueba A/B de sectores»** (antes «de tirones», su hipótesis se
  cerró) alterna anillo entero/partido POR TRAMO — intercalado a propósito: la
  térmica del iPhone (58,8→43 fps en 6 min) haría trampa en dos vueltas
  separadas. El log (PerfLog v5) sale con `segments: {'sectors:off', 'sectors:on'}`.
- ⚠️ `setSectorsEnabled` SEPARA del árbol la copia que no toca (esconderla con
  `visible=false` duplicaba el mundo ante el fingerprint, que recorre el
  grafo). Y es SOLO para medir dentro de un escenario: el repintado estacional
  guarda referencias a las mallas originales.
- Siguiente paso decidido: repartir por FRACCIÓN DE VÍA (`t`), no por ángulo —
  el anillo es un estadio, no un círculo, y por eso 6 gana a 8 en unas poses y
  pierde en otras.

## 🚃 La cabina y el tren comparten cotas — no las dupliques

`src/game/CabInterior.ts` construye la cabina del conductor DERIVANDO todo de
las constantes exportadas de `TrainConsist.ts`: `WINDSCREEN` (las dos lunas y
el montante — las lee también `buildNoseGlass`, así que cambiar `paneX`/`paneW`
cambia la cara del tren POR FUERA), `CAB_SIDE_WINDOW` (la ventanilla del
maquinista: el hueco interior y el cristal exterior son la misma constante),
`CAB_LEN_IN_CAR` (el acristalamiento de salón se retranquea para no pasar por
encima de la cabina), `HALF_W`/`FLOOR_Y`/`ROOF_Y`/`WALL_T`/`NOSE_LEN`.
**Ningún número de la cabina se elige a ojo**; si algo no casa, la constante
compartida es el sitio donde arreglarlo.

Trampas que ya costaron una iteración cada una: la cabina es UNLIT con el
sombreado horneado en colores de vértice (iluminarla con el sol del mundo la
hacía cambiar de color según el rumbo y salir 5× más clara bajo tierra que a
mediodía); `box().rotateX()` gira alrededor del ojo del conductor, usa
`tilted()`; nada montado a menos de medio grosor del panel o queda DENTRO;
戸締灯 se enciende con puertas CERRADAS; el manómetro es BC/MR (la aguja SUBE
al frenar); los testigos son aditivos para no tapar su leyenda; y la lluvia de
`WindshieldFX` se recorta al cristal vía `CabInterior.windscreenNdc()`.

El pase interno 0.2.1.2, publicado como 0.2.2, añade solo fabricación visible:
gasket panorámico, wipers, biseles, juntas, tornillería, interruptores, 時刻表
y paneles laterales. No subas esos documentos al HUD ni redibujes sus
CanvasTexture por frame. El contrato, las capturas y la prueba física preparada
están en `docs/SISTEMAS-0.2.1.2.md`.

## Publicar

Ritual completo en la memoria del proyecto. Resumen: `npm test` +
`npx tsc --noEmit` + `npm run build`. **Nada de tocar cachés a mano**: el
`sw.js` y su generación se generan solos en cada build, ver la sección de
arriba. Push a `main` dispara `.github/workflows/deploy.yml` → Pages, que
ejecuta `npm test` ANTES del build. Verificar con
`gh run list --repo Ruben-Arconada/tokyo-loop --limit 1`.

**La versión la decide Rubén y vive en DOS sitios**: `package.json` y
`package-lock.json` (que la repite dos veces, en la raíz y en el paquete
`""`). Bumpear a mano solo el primero los deja descuadrados — se arregla con
`npm install --package-lock-only`.

**Numeración (decisión de Rubén, 2026-07-28)**: la etiqueta de sus chats y la
versión del código son **la misma** desde la 0.1.8 — antes iban por separado
(el código estaba en `0.2.0-rc.2`) y eso confundía. El camino es
0.1.8 → … → **0.4.9** → **0.5.0**, que será la primera para testers internos
y algún beta tester externo.

`assets/` y `experiments/` están fuera de git a propósito: **nunca `git add -A`**.
