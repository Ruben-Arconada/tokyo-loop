# Certificación móvil física — Japan Loop 0.2.3

Fecha: 2026-08-18. Compilación probada: **0.2.3 · `537065f`**.

## Dictamen

**APROBADA en el iPhone probado.** La sonda sostuvo el objetivo visual y de
fluidez, no mostró deriva térmica apreciable, el teléfono terminó templado y
la PWA pudo cerrarse por completo y abrirse de nuevo en modo avión.

Este dictamen certifica la combinación concreta de dispositivo, sistema,
navegador y compilación que aparece abajo. No implica que todos los modelos de
móvil queden certificados sin probarlos.

## Contexto capturado por la sonda

| dato | valor |
|---|---|
| dispositivo | iPhone, Apple GPU |
| sistema y navegador | iOS 18.7, Safari 26.6 |
| modo | PWA instalada |
| viewport | 375 × 761; DPR 3, render cap 2 |
| escenario | cabina, invierno, ventisca, 22:00 |
| recorrido | Nishiki ↔ Nara, 24 tramos |
| sectorización | apagada; mundo entero |
| duración | 419,7 s |
| frames | 25.149 |

## Resultado medido

| métrica | resultado |
|---|---:|
| media | 59,9 FPS |
| frame p50 | 17,3 ms |
| frame p95 | 18,3 ms |
| frame p99 | 20,3 ms |
| máximo | 50 ms |
| frames por encima de 33 ms | 7 de 25.149 |
| pausas largas detectadas | 0 |
| programas de GPU | 98 → 98 |
| coste total de `ArtPass023.update` | 50 ms; máximo 1 ms/frame |

La media ponderada de frame fue aproximadamente 16,685 ms en la primera
mitad y 16,690 ms en la segunda: menos de 0,01 ms de diferencia. No aparece
degradación sostenida al calentarse el dispositivo.

Por segmento:

| segmento | frames | media | p95 | máximo | >33 ms |
|---|---:|---:|---:|---:|---:|
| Nishiki · primera mitad | 6.286 | 16,69 ms | 17,3 ms | 50 ms | 2 |
| Nara · primera mitad | 6.291 | 16,68 ms | 18,3 ms | 34 ms | 1 |
| Nishiki · segunda mitad | 6.285 | 16,69 ms | 17,3 ms | 44 ms | 3 |
| Nara · segunda mitad | 6.287 | 16,69 ms | 18,8 ms | 36 ms | 1 |

El único hitch de 50 ms ocurrió a los 0,1 s, en el teletransporte inicial a
Nishiki. No coincidió con compilación de shaders ni subida de texturas y no
pertenece a Nara. `shadowFrames` quedó en cero porque la prueba extrema se
ejecutó de noche y con ventisca, sin pase de sombra solar; no invalida la
comparación Nara ↔ Nishiki que realiza esta sonda.

## Observación física de Rubén

- temperatura: **templado**, quizá algo más caliente en la zona del procesador;
  no llegó a caliente ni incómodo;
- calidad visual: **visualmente mejor**;
- offline: cerró completamente la PWA, activó modo avión y pudo abrirla de
  nuevo desde el icono.

## Cierre

Las tres puertas móviles de 0.2.3 quedan satisfechas para este dispositivo:

1. rendimiento sostenido y temperatura aceptables;
2. mejora gráfica percibida;
3. cierre y reapertura offline correctos.

No se necesita repetir ahora otra sonda larga para 0.2.3. El siguiente salto
gráfico puede usar esta medición como presupuesto móvil de referencia y deberá
volver a certificarse si altera de forma material escena, sombras, cabina o
postprocesado.
