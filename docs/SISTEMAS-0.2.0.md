# Sistemas del ciclo 0.2.0 — «el anillo aprende a respirar»

Ciclo publicado entero en 0.2.0 (commits `72c3a9b` → `8dba42b`). Este
documento existe para quien toque los GRÁFICOS después (auditor incluido):
qué hay, dónde vive, y qué invariantes NO se pueden romper. Las reglas
generales del proyecto (origen compartido, determinismo, hashes) están en
`AGENTS.md`; esto es el detalle de lo nuevo.

## 1. Atmósfera por distrito — `src/game/zoneAmbience.ts`

Cada uno de los 6 distritos de `src/data/stations.ts` tiene un perfil de
aire: tinte de niebla con color Y peso separados para día/noche
(`fogTintDay/Night`, `fogTintW/fogTintWNight`), multiplicadores de densidad
(`fogNearMul/fogFarMul`), tinte hemisférico y de sol. `AmbienceTrack.sample(t)`
lo muestrea por fracción de vía con **crossfade**: meseta del 20 % alrededor
de cada estación, smoothstep por el centro del tramo, costura t=1→0 incluida.
Módulo puro (sin three), testeado en `test/zoneAmbience.test.ts`.

**Integración** (`Game.step`, bloque `f:ambience`): DESPUÉS de
`dayNight.update` y ANTES del override del túnel. El orden es sagrado:
DayNightCycle reescribe niebla/luces con `.copy()` cada frame (no hay
acumulación posible), la zona lerpea encima, el túnel pisa al final. El
overcast atenúa el peso de zona ×(1−0.55·o); el hemisférico además
×(1−0.3·night). También tiñe `bottomColor` del cielo a medio peso.

**CONTRATO (Diego, panel r3-r4)**: este sampler — perfiles y `urbanity`
(0 quiet · 0.5 mid · 1 urban, crossfadeado igual) — es LA fuente de verdad
de «¿en qué zona estoy?» dado un `progressFraction`. `Game.zoneUrbanity` lo
publica cada frame. El audio por zonas del próximo ciclo DEBE consumirlo;
`BAY_T0/T1` en Game.ts es una segmentación paralela anterior que debe
plegarse a él, no crecer.

## 2. Halos nocturnos — `src/game/glowCards.ts`

Pase POSTERIOR sobre la escena construida: lee las posiciones de instancia
de los pools etiquetados (`neon-signs-*` con el color de tubo por diseño,
`platform-lamp-bodies`, `platform-lanterns`) y levanta ~300 billboards
aditivos en **UN draw call** (InstancedBufferGeometry, billboarding por
filas de viewMatrix — patrón Passengers). Opacidad = smoothstep(nightFactor,
0.12, 0.8); `visible=false` de día (+0 draws); desvanecen con la distancia
en el shader (>550 u) para no sumar «pared de luz». **Cero sorteos nuevos
del RNG** y marcado `userData.dynamic`: fuera de los fingerprints y del
sectorizador, mismo estatus que las nubes. Si añades una fuente de luz
nueva al mundo, añade su grupo a `SOURCES` y los halos la recogen solos.

## 3. El cristal de la cabina — LECCIÓN DE ARQUITECTURA

**Regla que costó un bug**: lo que «pertenece» a una superficie 3D no puede
vivir en un overlay 2D de pantalla. La primera versión pintaba el aderezo
(tinte, banda, viñeta, vetas, escarcha) en el canvas 2D recortado a la
proyección del parabrisas: iba 1 frame por detrás (matrixWorldInverse solo
se refresca al renderizar) y un rectángulo alineado a ejes no se escorza —
Rubén lo describió como el cristal «acompañando» al girar la cabeza.

Arquitectura actual, en dos capas:

- **`CabInterior.paintGlassDressing`** — el aderezo es TEXTURA del plano 3D
  del cristal (CanvasTexture 1024×400). Se repinta SOLO en pasos
  cuantizados: escarcha 1/100, noche 1/20 (`setGlassState`). La escarcha
  (esquinas + condensación de alféizar, azulada, ×(1+0.45·night) de noche)
  la alimenta Game vía `CabInstrumentState.frost` (easing 0,4/s, 0 en túnel).
- **`WindshieldFX`** — SOLO óptica de pantalla: gotas/copos (pool 64,
  swap-remove) y el **flare** (núcleo+estela+2 fantasmas, todo sprites
  pre-renderizados, cero gradientes por frame). El canvas se OCULTA del todo
  sin lluvia ni flare. El clear en cabina es la UNIÓN del rect anterior y el
  actual (+2 px) — solo el actual dejaba restos en barridos de cabeza
  (bloqueo justificado de Marco en r3). Game refresca
  `camera.matrixWorldInverse` antes de proyectar clip y sol (mata el frame
  de retardo de lo que queda en pantalla).

El flare: `Game` proyecta `dayNight.sunSprite` a NDC; la opacidad del sprite
ya pliega elevación+overcast; falloff hacia el borde del cristal; ×(1−túnel);
`coreMul = 1 − 0.45·urbanity·(1−altura del sol)` — la oclusión del pobre:
el núcleo concede al skyline urbano, el velo no. **Sin oclusión real por
geometría** (declarado, estilizado a la baja).

## 4. Cabina cozy

`CabInstrumentState.coldOutside` (invierno ×(1+0.35·overcast)): la sala vira
a tungsteno (r +13 %, b −22 % sobre el factor cozy = cold×(0.55+0.45·dark)),
diales +0.10 de glow. El BC se asienta a ~0.3 con el tren parado y puertas en
ciclo (un tren parado sin freno rodaría — Haruto). El suelo de invierno es
BLANCO por **contra-tinte de MATERIAL** (1.24, 1.06, 1.32) en plano y
terraplén: blanco×textura-verde daba salvia; los vertex colors NO se tocan,
así que este truco no mueve los fingerprints.

## 5. REGLA DE ANCLAJE (auditoría 2026-07-30)

**Todo lo que se apoya en el suelo pregunta al suelo**: `groundHeightAt`
(≤~150 u de la vía) y/o `terrainRelief` (lejos, ±14). Y-absolutas solo con
enterramiento de sobra (Fuji −60, cordilleras −15). Lo corregido en este
ciclo: carteles de neón (¡flotaban de nacimiento, con halo nuevo se veía!) →
suelo + pilón real (`neon-sign-poles`); torre Kōbe y aguja Kanazawa → relieve
real; losas de andén → cimiento 0.6; panel-mapa → tótem de pie.

**Deuda anotada, sin bug visual hoy**: constantes de terreno duplicadas a
mano en hill-walls (−0.48), level-crossing (−0.42), utility-poles (clamp
−0.02), catenaria (−0.58 sin `embankmentSurface`), y los landmark props de
City a −0.58 en frame de ESTACIÓN (no de mundo) — el comentario de
`City.ts` sobre esto miente; si un landmark se mudara a la colina se iría
68 u arriba.

## 6. Probe A/B y CCTV (primeros commits del ciclo)

- El plan de tramos del probe vive en `src/game/probePlan.ts` (puro, con
  tests): estaciones alternan cada tramo, condición en ABBA. El primer log
  real salió confounded (estación⇄condición en fase) — no repetir ese error.
- Vista andén = CCTV VHS: `body.cctv-look` aplica el filtro al canvas SOLO
  en esa vista; ruido/scanlines/banda de tracking en CSS puro; FOV 95; eje
  vertical del arrastre invertido por decisión de Rubén.

## 7. Cambios deliberados del mundo = re-captura

Cualquier cambio del mundo estático (mover/añadir geometría instanciada,
tocar vertex colors) rompe las referencias de `worldReferences.ts` — ESO ES
CORRECTO si el cambio es deliberado. Ritual: carga `?canon`, `__checkWorld()`,
copia la tabla al fichero, recarga y re-verifica 4/4. Lo que NO rompe
referencias: colores/props de MATERIAL, flags castShadow, y todo lo marcado
`userData.dynamic`.

## 8. Condiciones pactadas (panel, 5 tandas, firmado 9/9/9/9/9/9/9.5)

1. El PerfLog v5 del iPhone con invierno+nieve+noche urbana es la
   **CONDICIÓN** para mantener la intensidad de la capa de cristal
   (`f:windshield` y `f:ambience` salen con nombre en el log).
2. Primera pieza de audio del próximo ciclo: grillos por tier urbano
   (`updateTimeAmbience`), consumiendo `urbanity` — luego atar `setShore`
   al peso de bay.
3. El crossfade entre zonas se verifica CONDUCIENDO (si la meseta del 20 %
   se queda corta, es la constante de `crossfade()` en zoneAmbience.ts).
