# Japan Loop 0.2.3 — tercera familia gráfica: Nara `green`

Fecha de cierre local: 2026-08-18.

0.2.3 extiende la tesis de 0.2.1 —una estación debe cambiar de arquitectura,
no solo de color— con una tercera familia. El microtramo Susukino → Nishiki →
Nara pasa de cañón urbano a mercado estrecho y finalmente a un andén bajo y
abierto junto a un parque. Nara es la estación hero.

La versión se prepara para publicación y validación móvil; este documento no
declara que una prueba física que todavía debe hacer Rubén ya esté aprobada.

## 1. Decisión por consenso

Los siete perfiles del equipo se agruparon en tres revisiones independientes:

- Aiko, Yui y Haruto: dirección, lectura visual y plausibilidad japonesa;
- Marco y Diego: coste, determinismo y ausencia de regresiones de audio;
- Lena y Sam: prueba móvil, trazabilidad de versión y lanzamiento.

El consenso descartó la costa `bay`: Kamakura/Enoshima ya se reconocen por mar,
isla y puente, y añadir más allí podía tapar su mejor horizonte. Nara obliga a
demostrar algo más útil: que dos distritos `quiet` contiguos —Nishiki
`shitamachi` y Nara `green`— se distinguen por estructura incluso de día.

## 2. Qué se construyó

Ficheros principales:

- `src/game/ArtKit.ts`: fabricación neutral compartida por 0.2.1 y 0.2.3;
- `src/game/ArtPass023.ts`: composición Nara y borde de parque;
- `src/game/art023Contract.ts`: presupuesto puro y auditable;
- `src/game/City.ts`: retirada de las veinte mallas legacy de Nara;
- `src/game/Game.ts`, `src/ui/UI.ts`: sonda móvil y trazabilidad visible.

### Estación Nara

- cinco crujías reales en 70 m;
- postes de madera sobre basas de piedra y vigas/rafters legibles;
- gran cubierta de kawara con alero profundo y segundo cuerpo corto elevado;
- pabellón de espera abierto, celosía, banco y tabla de horario;
- luz ámbar bajo alero sin luces reales;
- nieve geométrica que solo aparece en invierno.

No hay torii, pagoda, shimenawa ni símbolos religiosos pegados al andén. Nara
se lee como estación ferroviaria junto a un parque, no como santuario temático.

### Borde Nishiki → Nara

La autoría ocupa solo la franja central del tramo de 0,6 km y conserva un vacío
antes de Nara. Incluye zócalo de piedra, cerca de madera, seis cedros facetados,
cuatro tōrō y tres ciervos low-poly estáticos detrás del cerramiento. Los dos
footprints de estación quedan libres.

Todos los apoyos fuera del andén nacen de `artFrameAt()`, que consulta
`groundHeightAt()`. No hay asignaciones ni reconstrucciones por frame.

## 3. Sustitución, no apilado

El landmark antiguo de Nara construía diez troncos y diez copas como veinte
`Mesh`, cada uno con material propio. 0.2.3 los retira y los sustituye por lotes
fusionados.

Hay una trampa determinista: esas diez copas consumían treinta valores de
`rngCity` —radio, x y z por árbol—. Aunque la geometría desaparece, `City`
continúa consumiendo exactamente esos treinta valores en el mismo orden. Así,
los landmarks construidos después de Nara conservan su reparto 0.2.2.

`ArtPass021` se refactoriza sobre `ArtKit` sin cambiar su salida: sigue
informando 12 mallas, 49.128 triángulos, 10 draws de día y 12 de invierno.

## 4. Presupuesto real post-merge

`ArtPass023` publica en desarrollo `<html data-art023>` con el informe de la
escena construida, no una estimación.

| concepto | resultado | límite |
|---|---:|---:|
| draws de día | 3 | 3 |
| draws de invierno | 4 | 4 |
| triángulos | 3.600 | 12.000 |
| texturas nuevas | 0 | 0 |
| luces reales | 0 | 0 |
| mallas legacy sustituidas | 20 | 20 |

La estación opaca es la única malla nueva que proyecta sombras; el borde de
parque solo las recibe. Frente a las veinte mallas retiradas, el saldo local es
−17 draws de día y −16 en invierno si el conjunto Nara está en cuadro.

## 5. Mundo determinista

El cambio estático es deliberado, por lo que se recapturaron las ocho
referencias. Dos cargas consecutivas de `?canon&checkWorld` devolvieron:

| estación | semántico | estructural |
|---|---|---|
| primavera | `34d9dd41` | `5c112856` |
| verano | `214c25c6` | `7fe341ef` |
| otoño | `69c0ac07` | `37dc7acf` |
| invierno | `a1f1c3bf` | `6dc5929c` |

En ambas cargas: “Idéntico a la referencia en las cuatro estaciones,
semántico y estructural”. La tabla y el motivo del cambio viven en
`src/game/worldReferences.ts`.

## 6. Evidencia visual

- [cabina a 300 m](art-0.2.3/captures/nara-cab-300m-day.jpg)
- [aproximación](art-0.2.3/captures/nara-cab-approach.jpg)
- [exterior 3/4](art-0.2.3/captures/nara-exterior.jpg)
- [CCTV nocturno](art-0.2.3/captures/nara-cctv-night.jpg)
- [invierno + ventisca + 22:00](art-0.2.3/captures/nara-winter-blizzard-night.jpg)
- comparación: [Susukino](art-0.2.3/captures/compare-susukino.jpg),
  [Nishiki](art-0.2.3/captures/compare-nishiki.jpg),
  [Nara](art-0.2.3/captures/nara-cab-300m-day.jpg)
- [sonda visible a 390×844](art-0.2.3/captures/mobile-probe-progress.jpg)

La consola queda sin errores propios. Continúa únicamente el aviso conocido de
deprecación de `THREE.Clock`, anterior y fuera de este pase.

## 7. Prueba móvil preparada

El menú conserva intacta **«🧪 Prueba A/B de sectores»** y reemplaza la vieja
sonda de cabina por **«🌿 Prueba gráfica 0.2.3 (auto, ~6 min)»**.

Al tocarla:

1. fija cabina, invierno, ventisca, 22:00 y reloj detenido;
   si se abrió una URL de desarrollo con sectores, guarda ese estado y fuerza
   primero el mundo entero;
2. conduce 24 tramos alternando Nishiki (control) y Nara (`green`);
3. reparte seis tramos en cada celda:
   `control:nishiki:first-half`, `green:nara:first-half`,
   `control:nishiki:second-half`, `green:nara:second-half`;
4. registra contexto `probe: "graphics-023-mobile"`, informe `art023`,
   cabina `cab0212`, ruta y sectores apagados;
5. muestra progreso persistente, restaura ajustes y sectorización previa, y
   abre el menú con el log.

Inicio y Pausa muestran `v0.2.3 · <commit>`, para comprobar que la PWA no está
sirviendo una generación anterior.

### Protocolo físico que debe hacer Rubén

- abrir Pages/PWA y confirmar `v0.2.3` más el commit publicado;
- ejecutar la prueba sin pausar ni cambiar de aplicación;
- copiar el log y anotar si el teléfono termina frío, templado, caliente o
  incómodo;
- confirmar que Nara se reconoce sin HUD por cubierta baja/abierta y parque;
- cerrar por completo, activar modo avión y reabrir desde el icono;
- confirmar inicio, cabina, Nara y nueva generación sin red.

Hasta recibir ese log y el resultado offline, 0.2.3 queda **publicada para
certificación móvil**, no certificada en móvil.

## 8. Puertas verificadas antes de publicar

- `npm test`: 55/55;
- `npx tsc --noEmit`;
- `npm run build`;
- presupuesto runtime 0.2.3;
- referencias canónicas repetidas;
- flujo móvil 390×844 y progreso sin solapes;
- build servido bajo `/tokyo-loop/`, recargado correctamente después de matar
  el servidor local (service worker/offline de producción);
- dictamen 7/7 en `docs/panel-equipo/resultado-0.2.3.md`.
