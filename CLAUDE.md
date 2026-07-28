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

**La regla, para siempre** — en [public/sw.js](public/sw.js): el nombre de caché
lleva prefijo de proyecto y el borrado solo puede tocar claves con ESE prefijo:

```js
const CACHE_PREFIX = 'tokyo-loop-'
const CACHE = CACHE_PREFIX + 'v5'
// ...
keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
```

Arreglado a la vez en los tres repos afectados: `tokyo-loop`, `abismo` y
`abismo-2`. `neon-exodus-2087` tiene manifest pero todavía no tiene service
worker: si algún día se le añade uno, debe nacer con prefijo.

**localStorage vive en el mismo origen compartido.** Por eso todas las claves de
este juego van prefijadas (`yamanote-season`, `yamanote-best-score`…). Mantener
esa costumbre: una clave genérica tipo `settings` chocaría con la de otro juego.

## Publicar

Ritual completo en la memoria del proyecto. Resumen: `npx tsc --noEmit` +
`npm run build`, bump de versión solo en `package.json`, y si se toca `public/`
subir también `CACHE` en `public/sw.js`. Push a `main` dispara
`.github/workflows/deploy.yml` → Pages. Verificar con
`gh run list --repo Ruben-Arconada/tokyo-loop --limit 1`.

`assets/` y `experiments/` están fuera de git a propósito: **nunca `git add -A`**.
