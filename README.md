# 山手線 Yamanote Fun

Un simulador de conducción de trenes en 3D para navegador, ambientado en la línea circular Yamanote de Tokio. Enfocado en móvil, pensado para jugarse con el pulgar, con un ciclo completo de iluminación día/noche y melodías de estación originales.

**Juega en staging:** https://ruben-arconada.github.io/Yamanote-Fun/

## Qué hay dentro

- **Cabina en primera persona** sobre un recorrido circular estilizado con las 30 estaciones reales de la Yamanote, en orden.
- **Palanca única (wan-handle)** como en los trenes japoneses de verdad: arriba acelera (P1–P5), abajo frena (B1–B7 / freno de emergencia), tanto arrastrando en pantalla táctil como con teclado (↑/W, ↓/S, espacio).
- **Precisión de parada**: frena para detener el tren justo en el andén — la app puntúa la parada (perfecta / buena / correcta / fallada).
- **Ciclo día/noche completo**: amanecer, mañana, mediodía, atardecer, crepúsculo y noche cerrada, con sol y luna, estrellas, y ventanas/letreros de la ciudad que se iluminan al anochecer.
- **Estaciones emblemáticas** con ambientación propia: Tokyo (fachada de ladrillo), Ueno (parque), Ikebukuro y Shinjuku (rascacielos), Harajuku (gran torii entre pinos), Shibuya (pantalla gigante) y Shinagawa (bahía).
- **Tokio por capas**: Monte Fuji en el horizonte, Tokyo Tower (naranja de noche), Skytree (que alterna sus iluminaciones Iki y Miyabi), Rainbow Bridge, skyline lejano, casas shitamachi con ventanas cálidas, postes eléctricos con cables combados, neones verticales de kanji y sakura con pétalos a la deriva en los distritos verdes.
- **El fumikiri**: como en la Yamanote real, un único paso a nivel (en el tramo Tabata → Komagome) con luces alternantes y campana kan-kan cuando el tren se acerca.
- **Sonido generado en directo** con Web Audio API: melodías de estación originales por parada, motor y frenos sintetizados, y megafonía trilingüe (japonés, inglés y español) vía Web Speech API que siempre anuncia el lado de apertura de puertas — con una cola de anuncios que nunca se pisan entre sí.
- **Responsive de verdad**: HUD y controles se adaptan a móvil/tablet/escritorio, con áreas seguras para el notch y controles táctiles grandes.

## Sobre las melodías de estación

Las melodías que suenan al abrir las puertas son composiciones originales escritas para este juego, inspiradas en el estilo de las famosas "hassha melody" japonesas, pero **no son transcripciones de ninguna melodía real de JR East**, que siguen protegidas por derechos de autor de sus compositores.

## Desarrollo local

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # build de producción a dist/
npm run preview  # sirve el build de producción localmente
```

## Stack

Three.js + TypeScript + Vite, sin dependencias de assets externos: toda la geometría, texturas de rótulos y sonido se generan por código.

## El equipo

Yamanote Fun lo hace un estudio indie de siete personas obsesionadas con los trenes japoneses y con Tokio. Puedes leer sobre cada una desde el menú "Sobre el equipo" dentro del propio juego.
