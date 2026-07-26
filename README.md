# ジャパンループ Japan Loop

Un simulador de conducción de trenes en 3D para navegador: un anillo que es un paseo por un Japón en miniatura — templos, aldeas de montaña, neón, un túnel urbano y la costa. Enfocado en móvil, pensado para jugarse con el pulgar, con un ciclo completo de iluminación día/noche y melodías de estación originales.

**Juega en staging:** https://ruben-arconada.github.io/tokyo-loop/

> **Aviso**: Japan Loop es un juego de fans sin afiliación con ninguna compañía ferroviaria. Las estaciones son alegorías de lugares reales de Japón usados como topónimos; la numeración de línea ("JL"), la señalética, el material rodante y todas las melodías son creaciones originales del juego.

## Qué hay dentro

- **Cabina en primera persona** sobre un anillo estilizado con 30 paradas que recorren Japón entero: la colina de Kiyomizu, las casas de Shirakawa-gō, el torii de Fushimi Inari, el neón de Dōtonbori, la costa de Kamakura y Enoshima…
- **Palanca única (wan-handle)** como en los trenes japoneses de verdad: arriba acelera (P1–P5), abajo frena (B1–B7 / freno de emergencia), tanto arrastrando en pantalla táctil como con teclado (↑/W, ↓/S, espacio).
- **Precisión de parada** con sistema de puntos: frena para detener el tren justo en el andén — perfecta / buena / correcta / fallada, con racha de perfectas y récord guardado.
- **Ciclo día/noche completo**: amanecer, mañana, mediodía, atardecer, crepúsculo y noche cerrada, con sol y luna, estrellas, y ventanas de la ciudad que se encienden una a una al anochecer. Toca el reloj para saltar a la hora que quieras.
- **Estaciones emblemáticas** con ambientación propia: Tokyo (fachada de ladrillo), Nara (parque), Fukuoka y Nagoya (rascacielos), Fushimi Inari (gran torii entre pinos), Dōtonbori (pantalla gigante y el túnel bajo la ciudad) y Kamakura–Enoshima (la costa).
- **Japón por capas**: Monte Fuji en el horizonte, torres emblemáticas iluminadas de noche, puente de la bahía, skyline lejano, casas de tejado kawara con ventanas cálidas, postes eléctricos con cables combados, neones verticales de kanji y sakura con pétalos a la deriva.
- **El fumikiri**: un único paso a nivel en todo el anillo (tramo Uji → Kiyomizu, entre los campos de té y la subida al templo) con luces alternantes y campana kan-kan cuando el tren se acerca.
- **Sonido generado en directo** con Web Audio API: melodías de estación originales por parada, motor y traqueteo sintetizados, ambiente natural según la hora (pájaros, cigarras, grillos), puertas y murmullo de andén posicional, y megafonía trilingüe (japonés, inglés y español) que siempre anuncia el lado de apertura de puertas.
- **PWA instalable** en Android e iOS, con icono propio y funcionamiento offline tras la primera visita.
- **Responsive de verdad**: HUD estilo mapa de líneas con numeración JL, áreas seguras para el notch y controles táctiles grandes.

## Sobre las melodías de estación

Las melodías que suenan al abrir las puertas son composiciones originales escritas para este juego, inspiradas en el estilo de las famosas "hassha melody" japonesas, pero **no son transcripciones de ninguna melodía real**, que siguen protegidas por derechos de autor de sus compositores.

## Desarrollo local

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # build de producción a dist/
npm run preview  # sirve el build de producción localmente
```

## Stack

Three.js + TypeScript + Vite, sin dependencias de assets externos: toda la geometría, texturas de rótulos y sonido se generan por código. Ver [LICENSES.md](LICENSES.md) para el aviso de licencia de Three.js (MIT).

## El equipo

Japan Loop lo presenta como el trabajo de un estudio indie de siete personas obsesionadas con los trenes japoneses y con Japón. **Es un guiño de ambientación**: los siete perfiles del menú "Sobre el equipo" son personajes ficticios creados para dar sabor a los créditos, no un estudio real.
