# Dirección de arte — Tokyo Loop

Complementa a `docs/ESTRATEGIA-GRAFICA.md` (que cubre postprocesado/atmósfera). Este documento fija el **contraste de zonas**: cómo el jugador siente que pasa de una zona rural/tranquila a una intermedia y a una urbana densa, a cualquier hora del día.

## El principio: contraste estructural, no lumínico

La iluminación (día/noche) ya varía mucho — pero eso NO basta para dar sensación de "cambiar de barrio", porque de noche todo se ve oscuro por igual. El contraste real tiene que estar en la **geometría y densidad**, para que se note a las 12:00 igual que a las 23:00.

## Las 3 franjas (`ZoneTier` en `src/data/stations.ts`)

Cada estación ya tenía un `district` (business/downtown/shitamachi/green/youth/bay) con su color. Ahora cada distrito además mapea a un **tier** estructural:

| Tier | Distritos | Estaciones | Sensación |
|---|---|---|---|
| `quiet` | shitamachi, green | 11 (Nippori, Komagome, Ueno, Meguro...) | Barrio bajo, casas con tejado kawara, pinos y sakura, sin neón, cielo abierto |
| `mid` | business, bay | 12 (Tokyo, Gotanda, Shinagawa...) | Torres medias, mezcla casas/oficinas, algo de neón |
| `urban` | downtown, youth | 7 (Shinjuku, Shibuya, Ikebukuro, Akihabara...) | Cañón de rascacielos, cero casas, neón saturado |

## Qué varía por tier (implementado)

Parámetros centralizados en `TIER_PARAMS` (`City.ts`) y tablas hermanas en `Scenery.ts`:

- **Altura y densidad de edificios de fondo** (`City.buildBuildings`): quiet 8-22m con densidad ×0.45, mid 14-55m ×1.0, urban 24-130m ×2.2. Las estaciones `landmark` añaden un +25% de altura dentro de su propio rango de tier (no lo rompen).
- **Casas bajas** (`Scenery.buildHouseRows`): 26 por estación quiet, 6 por estación mid, **0** en urban — en el centro no hay casas encajadas entre rascacielos.
- **Vegetación** (pinos, matorral — `Scenery.buildVegetation`): muestreo ponderado por tier vía `sampleTierWeightedT()` (peso 1.0 quiet, 0.35 mid, 0.05 urban), así los árboles se concentran en las zonas tranquilas sin tocar el conteo total de instancias.
- **Neón** (`Scenery.buildNeonSigns`): 0 en quiet, 2 por estación en mid, 10 en urban (×1.4 si es landmark).
- **Mobiliario de estación** (ya existía, ahora ligado a `tier === 'quiet'` en vez de a una lista de distritos): columnas de madera + farolillos en quiet, cristal esmerilado + LED en mid/urban.

## Verificado visualmente

Comparativa Komagome (quiet) vs Shinjuku (urban) a la misma hora: Komagome muestra casas, un pino y matorral con edificios de fondo bajos y dispersos; Shinjuku es pared de rascacielos de borde a borde sin una sola casa. El contraste es inmediato y no depende de si es de día o de noche.

## Por qué no voxels (recordatorio)

Sigue en pie el veredicto de `ESTRATEGIA-GRAFICA.md`: Cloudpunk/Nivalis no son voxels reales, son atmósfera (bloom, niebla, lluvia) sobre geometría optimizada. El sistema de tiers de este documento es compatible con esa hoja de ruta sin tocarla — el bloom nocturno seguirá funcionando igual de bien sobre neón urbano que sobre farolillos rústicos.

## Próximo nivel (si se quiere seguir puliendo esto)

- Postes de catenaria/utility más espaciados o ausentes en tramos quiet (hoy son uniformes en todo el anillo).
- Un cuarto tier opcional "bay" diferenciado de "mid" para Shinagawa/Tamachi/Hamamatsucho (agua, grúas, contenedores) si se quiere una cuarta paleta distinta.
- Assets externos (ver `ESTRATEGIA-GRAFICA.md`) encajarían muy bien como "hero buildings" específicos de cada tier: un edificio de oficinas más trabajado para mid, un torii/machiya para quiet, un rascacielos con más detalle para urban.
