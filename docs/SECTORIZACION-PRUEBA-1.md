# Sectorización del anillo — prueba 1 (2026-07-30)

Primera medición de partir el anillo en 4 / 6 / 8 sectores, camino de la 0.4.9.
**Está detrás de una bandera y por defecto APAGADO**: `?sectors=N` en la URL.
Sin el parámetro el juego se comporta exactamente como antes.

## Por qué había algo que ganar

Medido en cabina antes de tocar nada: **89 `InstancedMesh`, 28.720 instancias,
663k triángulos — y 78 de los 89 pools dibujándose ENTEROS.**

El culling de frustum ya estaba encendido y funcionaba bien. El problema es que
no tenía dónde morder: cada pool abarca las 12.675 unidades del anillo, así que
su esfera envolvente encierra el mundo entero y siempre corta el frustum. La
cámara ve como mucho un cuarto del anillo y paga por los cuatro cuartos.

## Cómo está hecho

`src/game/sectorize.ts`, como **pase posterior sobre una escena ya construida**,
no como un cambio en sesenta y tantos sitios de construcción. Lee cada pool,
reparte sus instancias por ángulo alrededor del centro del anillo, y sustituye
la malla por N más pequeñas que comparten geometría y material.

Se salta a propósito, y lo deja escrito en `report.skipped`:
- lo marcado `dynamic` (lo coloca la simulación, no la semilla),
- lo que no lleva `tagGroup` (el hash semántico no podría seguirlo al partirlo),
- los pools con menos de 24 instancias,
- los que ya son **locales** (radio < 600): partirlos paga draw calls sin ganar
  culling.

Y **no toca** `Points`, `Line` ni `InstancedBufferGeometry` (las cartas de las
copas): el hash los digiere como UN registro con el búfer entero, así que
partirlos SÍ movería el semántico. Hay que aplanarlos antes, y eso es otro
trabajo — es el aviso que ya estaba escrito en AGENTS.md.

## El contrato, cumplido

> «Hash semántico y RECUENTOS idénticos (el estructural SÍ cambiará y es
> correcto)»

| sectores | semántico | estructural | mallas |
|---|---|---|---|
| 1 | `494d8caa` | `dfce1556` | 89 |
| 4 | **`494d8caa`** | `2a1d6c9d` | 255 |
| 6 | **`494d8caa`** | `5bc61548` | 352 |
| 8 | **`494d8caa`** | `d354c7a2` | 447 |

El semántico **no se mueve ni un dígito**. El estructural cambia con cada N,
que es su trabajo. 64 pools partidos, 28.396 instancias movidas.

Además hay **tres tests nuevos sin navegador** en `test/worldHash.test.ts` que
fijan esto: que sectorizar a 1/4/6/8 deja el hash y los recuentos intactos, que
lo dinámico y lo sin etiquetar se quedan enteros, y que un pool ya local no se
parte. 29/29 en verde.

## Lo que cuesta y lo que ahorra

Cuatro poses del anillo, escenario canónico, 1280×720, vista de cabina.

**Triángulos** (lo que se gana):

| pose | 1 | 4 | 6 | 8 |
|---|---|---|---|---|
| Yokohama | 642.784 | 369.264 (−43 %) | **284.314 (−56 %)** | 352.312 (−45 %) |
| Kiyomizu (colina) | 666.874 | 387.452 (−42 %) | 325.840 (−51 %) | **309.414 (−54 %)** |
| Dōtonbori (túnel) | 664.180 | 436.426 (−34 %) | 275.254 (−59 %) | **261.548 (−61 %)** |
| Kamakura (costa) | 642.994 | 363.812 (−43 %) | 308.862 (−52 %) | **246.684 (−62 %)** |

**Draw calls** (lo que cuesta):

| pose | 1 | 4 | 6 | 8 |
|---|---|---|---|---|
| Yokohama | 164 | 220 | 216 | 271 |
| Kiyomizu | 187 | 251 | 288 | 298 |
| Dōtonbori | 136 | 200 | 150 | 158 |
| Kamakura | 183 | 242 | 275 | 286 |

## Qué dicen estos números

1. **El ahorro es real y grande**: entre un tercio y casi dos tercios de los
   triángulos, y con ellos el pase de sombras y el trabajo de vértices.
2. **Se sale del presupuesto de draws.** El proyecto trabaja con ~192 en la
   vista peor y aquí vamos de 200 a 298. Eso NO invalida la prueba —el criterio
   de aceptación ya decía que los draws subirían— pero significa que **el
   veredicto sólo lo puede dar el iPhone**, midiendo tiempo de frame, no un Mac
   contando llamadas.
3. **Ni 4 ni 8 ganan siempre.** A 6 sectores Yokohama baja a 284k mientras que a
   8 sube a 352k; en la costa pasa al revés. Esa incoherencia tiene una causa
   identificada, y es la siguiente tarea (ver abajo).

## Lo siguiente, por orden

1. **Repartir por FRACCIÓN DE VÍA, no por ángulo.** El anillo es un estadio
   alargado, no un círculo: repartir por `atan2(z,x)` desde el centro da
   sectores de tamaños muy distintos y con formas malas para una esfera
   envolvente. Bucketear por el `t` de la curva daría sectores compactos y
   parejos, y casi seguro explica por qué 6 gana a 8 en unas poses y pierde en
   otras. **Es el cambio con mejor relación coste/beneficio que queda.**
2. **Medir en el iPhone 14 Pro Max** con PerfLog v4 (lleva semilla, versión y
   commit; dos vueltas sólo se comparan si coinciden los tres). Sin eso, el
   punto 2 de arriba no tiene respuesta.
3. **Aplanar `Points` y `Line`** antes de sectorizar estrellas, pétalos o
   catenaria.
4. Sólo entonces: decidir N y encenderlo por defecto.

## Cómo reproducir

```
?canon             → sin sectorizar (línea base)
?canon&sectors=4   → 4 sectores
?canon&sectors=6
?canon&sectors=8
```

Y en consola: `__game.sectorReport` dice qué se partió y qué se saltó y por qué;
`__semanticHash().total` tiene que salir **`494d8caa`** en los cuatro casos.

---

## El botón de la sonda ahora ES esta prueba (2026-07-30)

Decisión de Rubén: el botón «Prueba de tirones» del menú de pausa cambia de
trabajo. Su hipótesis original está cerrada (los tirones eran
`speechSynthesis`, arreglado y publicado), así que ahora se llama
**«Prueba A/B de sectores»** y responde a la pregunta abierta: ¿compra tiempo
de frame la sectorización EN EL MÓVIL?

**Cómo funciona**: los mismos 8 tramos Kiyomizu ↔ Fushimi Inari de siempre,
pero **alternando por tramo** — impares con el anillo entero, pares
sectorizado a 6. No son dos vueltas separadas a propósito: este teléfono pasa
de 58,8 fps a 43-44 en seis minutos con MENOS carga (estrangulamiento térmico
medido), así que una vuelta A y una vuelta B compararían un chip frío contra
uno caliente. Intercalado, la deriva cae igual sobre las dos condiciones.

**Qué sale en el log (PerfLog v5)**: un objeto `segments` con una fila por
condición — frames, media, p95, máximo, over17/over33:

```json
"segments": {
  "sectors:off": { "frames": 3876, "meanMs": …, "p95Ms": …, "over17": … },
  "sectors:on":  { "frames": 3288, "meanMs": …, "p95Ms": …, "over17": … }
}
```

El interruptor (`setSectorsEnabled`) SEPARA del árbol la copia que no toca —
no la esconde: `visible = false` dejaba las dos copias en el grafo y el hash
semántico contaba cada instancia dos veces (lo cazó el test de node al
momento). Al terminar o cancelar la sonda, el mundo vuelve SIEMPRE al estado
entero.

**Protocolo para Rubén**: quitar el silencio → menú de pausa → «🧪 Prueba A/B
de sectores» → esperar ~2 min → «Copiar log» → pegarlo en el chat. Igual que
siempre.
