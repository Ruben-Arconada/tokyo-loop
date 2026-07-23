# 東京ループ Tokyo Loop

Un simulador de conducción de trenes en 3D para navegador, ambientado en una versión estilizada de la línea circular de Tokio. Enfocado en móvil, pensado para jugarse con el pulgar, con un ciclo completo de iluminación día/noche y melodías de estación originales.

**Juega en staging:** https://ruben-arconada.github.io/tokyo-loop/

> **Aviso**: Tokyo Loop es un juego de fans sin afiliación con JR East ni con ninguna compañía ferroviaria. Los nombres de estación se usan como topónimos de los barrios de Tokio; la numeración de línea ("TL"), la señalética, el material rodante y todas las melodías son creaciones originales del juego.

## Qué hay dentro

- **Cabina en primera persona** sobre un recorrido circular estilizado con 30 estaciones reales de Tokio, en su orden geográfico.
- **Palanca única (wan-handle)** como en los trenes japoneses de verdad: arriba acelera (P1–P5), abajo frena (B1–B7 / freno de emergencia), tanto arrastrando en pantalla táctil como con teclado (↑/W, ↓/S, espacio).
- **Precisión de parada** con sistema de puntos: frena para detener el tren justo en el andén — perfecta / buena / correcta / fallada, con racha de perfectas y récord guardado.
- **Ciclo día/noche completo**: amanecer, mañana, mediodía, atardecer, crepúsculo y noche cerrada, con sol y luna, estrellas, y ventanas de la ciudad que se encienden una a una al anochecer. Toca el reloj para saltar a la hora que quieras.
- **Estaciones emblemáticas** con ambientación propia: Tokyo (fachada de ladrillo), Ueno (parque), Ikebukuro y Shinjuku (rascacielos), Harajuku (gran torii entre pinos), Shibuya (pantalla gigante) y Shinagawa (bahía).
- **Tokio por capas**: Monte Fuji en el horizonte, torres emblemáticas iluminadas de noche, puente de la bahía, skyline lejano, casas de tejado kawara con ventanas cálidas, postes eléctricos con cables combados, neones verticales de kanji y sakura con pétalos a la deriva.
- **El fumikiri**: un único paso a nivel en todo el anillo (tramo Tabata → Komagome) con luces alternantes y campana kan-kan cuando el tren se acerca.
- **Sonido generado en directo** con Web Audio API: melodías de estación originales por parada, motor y traqueteo sintetizados, ambiente natural según la hora (pájaros, cigarras, grillos), puertas y murmullo de andén posicional, y megafonía trilingüe (japonés, inglés y español) que siempre anuncia el lado de apertura de puertas.
- **PWA instalable** en Android e iOS, con icono propio y funcionamiento offline tras la primera visita.
- **Responsive de verdad**: HUD estilo mapa de líneas con numeración TL, áreas seguras para el notch y controles táctiles grandes.

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

Tokyo Loop lo presenta como el trabajo de un estudio indie de siete personas obsesionadas con los trenes japoneses y con Tokio. **Es un guiño de ambientación**: los siete perfiles del menú "Sobre el equipo" son personajes ficticios creados para dar sabor a los créditos, no un estudio real.
