# Japan Loop (ジャパンループ) — notas para Claude Code

Simulador de conducción ferroviaria en Three.js. PWA instalable desplegada en
GitHub Pages: `https://ruben-arconada.github.io/tokyo-loop/`.

El juego se llama **Japan Loop** desde 2026-07-26, pero el repo, la URL, el
`package.json` y el nombre de caché conservan "tokyo-loop" **a propósito**:
renombrar el repo rompería la PWA ya instalada en los móviles y la URL de Pages.

Sistemas y decisiones de diseño: `docs/SISTEMAS-V014-V015.md` y
`docs/ESTRATEGIA-GRAFICA.md`.

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
dice qué partes se movieron. El informe de rendimiento (`PerfLog` v2) lleva la
semilla: dos vueltas solo son comparables si coincide.

`__semanticHash()` es el gemelo **ciego a la partición**: agrupa las
instancias por el nombre que declara el builder (`tagGroup`), las ordena como
CONJUNTO y digiere con el recuento dentro, así que da igual si un pool está
entero o repartido en ocho sectores. Es el que tiene que referear la
sectorización; el estructural cambiará entonces y eso es correcto.

### ⚠️ Antes de fiarte de un hash del mundo, lee esto

Ninguno de los dos hashes es todavía un contrato cerrado. Tres cosas
verificadas que hay que arreglar antes de usarlos como puerta de un refactor:

1. **No dependen solo de la semilla**: la estación y el clima guardados en
   `localStorage` los mueven. Con `yamanote-season=winter` el semántico da
   `9b1ba8bb` donde con primavera da `e7cdb9f8`. Hace falta fijar y REGISTRAR
   un escenario canónico (semilla por defecto, primavera, despejado, clima
   automático apagado).
2. **Las nubes están dentro del «mundo estático»** y se resiembran con el
   clima consumiendo del flujo `clouds` — ir a tormenta y volver NO devuelve
   el hash. Hay que marcarlas dinámicas o darles fingerprint aparte.
3. **Los ~110 grupos `untagged:` agrupan por geometría**, así que pueden
   mezclar sistemas distintos. Solo son de fiar los que llevan `tagGroup`
   explícito (hoy los diez de vegetación). Etiqueta antes de refactorizar.

Y la rama de `Points` digiere el buffer entero como un registro: si algún día
se sectorizan estrellas o partículas, deja de ser independiente de la
partición.

## Publicar

Ritual completo en la memoria del proyecto. Resumen: `npx tsc --noEmit` +
`npm run build`, y bump de versión solo en `package.json` (nada más la lleva;
lo decide Rubén). **Nada de tocar cachés a mano**: el `sw.js` y su generación
se generan solos en cada build, ver la sección de arriba. Push a `main`
dispara `.github/workflows/deploy.yml` → Pages. Verificar con
`gh run list --repo Ruben-Arconada/tokyo-loop --limit 1`.

`assets/` y `experiments/` están fuera de git a propósito: **nunca `git add -A`**.
