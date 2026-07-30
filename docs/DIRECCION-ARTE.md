# Dirección de arte — Tokyo Loop

Complementa a `docs/ESTRATEGIA-GRAFICA.md` (que cubre postprocesado/atmósfera). Este documento fija el **contraste de zonas**: cómo el jugador siente que pasa de una zona rural/tranquila a una intermedia y a una urbana densa, a cualquier hora del día.

## Estado 0.2.1: el tier ya no basta por sí solo

El sistema de abajo sigue siendo el fondo barato de todo el anillo. La vertical
Susukino→Nishiki añade la capa cercana authored que faltaba: estaciones de 70 m
con estructura propia, fachadas que miran realmente a vía y barrios modulares
fusionados. Contrato, imágenes y coste exacto en
[`SISTEMAS-0.2.1.md`](SISTEMAS-0.2.1.md).

La regla para extenderlo es **fondo por tier + primer plano por kit de
distrito**. No se pretende conseguir identidad cambiando solo altura/tinte, ni
copiar un diorama único treinta veces.

## El principio: contraste estructural, no lumínico

La iluminación (día/noche) ya varía mucho — pero eso NO basta para dar sensación de "cambiar de barrio", porque de noche todo se ve oscuro por igual. El contraste real tiene que estar en la **geometría y densidad**, para que se note a las 12:00 igual que a las 23:00.

## Las 3 franjas (`ZoneTier` en `src/data/stations.ts`)

Cada estación ya tenía un `district` (business/downtown/shitamachi/green/youth/bay) con su color. Ahora cada distrito además mapea a un **tier** estructural:

| Tier | Distritos | Estaciones | Sensación |
|---|---|---|---|
| `quiet` | shitamachi, green | 11 (Nishiki, Nara, Koyasan, Kiyomizu...) | Barrio bajo, casas con tejado kawara, pinos y sakura, sin neón, cielo abierto |
| `mid` | business, bay | 12 (Tokyo, Yokohama, Kamakura, Enoshima...) | Torres medias, mezcla casas/oficinas, algo de neón |
| `urban` | downtown, youth | 7 (Susukino, Fukuoka, Nagoya, Dotonbori...) | Cañón de rascacielos, cero casas, neón saturado |

## Qué varía por tier (implementado)

Parámetros centralizados en `TIER_PARAMS` (`City.ts`) y tablas hermanas en `Scenery.ts`:

- **Altura y densidad de edificios de fondo** (`City.buildBuildings`): quiet 8-22m con densidad ×0.45, mid 14-55m ×1.0, urban 24-130m ×2.2. Las estaciones `landmark` añaden un +25% de altura dentro de su propio rango de tier (no lo rompen).
- **Casas bajas** (`Scenery.buildHouseRows`): 26 por estación quiet, 6 por estación mid, **0** en urban — en el centro no hay casas encajadas entre rascacielos.
- **Vegetación** (pinos, matorral — `Scenery.buildVegetation`): muestreo ponderado por tier vía `sampleTierWeightedT()` (peso 1.0 quiet, 0.35 mid, 0.05 urban), así los árboles se concentran en las zonas tranquilas sin tocar el conteo total de instancias.
- **Neón** (`Scenery.buildNeonSigns`): 0 en quiet, 2 por estación en mid, 10 en urban (×1.4 si es landmark).
- **Mobiliario de estación** (ya existía, ahora ligado a `tier === 'quiet'` en vez de a una lista de distritos): columnas de madera + farolillos en quiet, cristal esmerilado + LED en mid/urban.

## Verificado visualmente

La comparación de referencia actual es Nishiki (quiet) vs Susukino (urban) a
la misma hora: además del tier de fondo, 0.2.1 prueba machiya/madera/aleros
contra acero/vidrio/balcones/servicios. El contraste ya no depende del neón.

## Por qué no voxels (recordatorio)

Sigue en pie el veredicto de `ESTRATEGIA-GRAFICA.md`: Cloudpunk/Nivalis no son voxels reales, son atmósfera (bloom, niebla, lluvia) sobre geometría optimizada. El sistema de tiers de este documento es compatible con esa hoja de ruta sin tocarla — el bloom nocturno seguirá funcionando igual de bien sobre neón urbano que sobre farolillos rústicos.

## Próximo nivel (si se quiere seguir puliendo esto)

- Postes de catenaria/utility más espaciados o ausentes en tramos quiet (hoy son uniformes en todo el anillo).
- Un cuarto tier opcional "bay" diferenciado de "mid" para Shinagawa/Tamachi/Hamamatsucho (agua, grúas, contenedores) si se quiere una cuarta paleta distinta.
- Extraer `StationKit`/`DistrictKit` desde `ArtPass021`, una vez validado el
  coste en iPhone, y probar una tercera familia `green` o `bay`.
- Assets externos o image-to-3D solo como hero props aislados (ver
  `ESTRATEGIA-GRAFICA.md`), nunca como sustituto monolítico del kit.
