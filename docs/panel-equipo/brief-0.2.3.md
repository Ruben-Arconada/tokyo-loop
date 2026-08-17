# Brief de revisión — Japan Loop 0.2.3

Fecha: 2026-08-18. Criterio fijo: **8 = publicar con orgullo**. Consenso solo
si los siete perfiles puntúan ≥8; no se regala el 8 ni se mueve la portería.

## Pregunta del pase

¿Demuestra Nara una tercera familia `green`, estructuralmente distinta de
Nishiki `shitamachi`, sin gastar el presupuesto móvil que aún debe medir Rubén?

## Alcance

- `ArtPass023`: Nara hero + franja central Nishiki→Nara.
- `ArtKit`: extracción neutral; salida 0.2.1 inalterada.
- Sustitución de 20 mallas legacy, no apilado.
- Prueba móvil dedicada, versión/commit visibles y documentación local.

Fuera de alcance: bloom, height fog, suelo húmedo, sectorización por defecto,
pasajeros nuevos, ciervos animados, audio nuevo, GLB, costa, tren/cabina.

## Datos medidos

- 3 draws día / 4 invierno; 3.600 tri; 0 texturas; 0 luces.
- 20 mallas antiguas retiradas: saldo −17/−16 draws en Nara.
- 0.2.1 conserva 10/12 draws y 49.128 tri tras la extracción de `ArtKit`.
- `npm test`: 55/55; TypeScript y build verdes.
- mundo canónico coincidente en primavera/verano/otoño/invierno, repetido.

## Capturas obligatorias

Leer todas en `docs/art-0.2.3/captures/`:

1. `nara-cab-300m-day.jpg`
2. `nara-cab-approach.jpg`
3. `nara-exterior.jpg`
4. `nara-cctv-night.jpg`
5. `nara-winter-blizzard-night.jpg`
6. `compare-susukino.jpg`
7. `compare-nishiki.jpg`
8. `mobile-probe-progress.jpg`

## Qué juzga cada perfil

- Aiko: lectura en ≤3 s, dirección e inmersión.
- Marco: presupuesto real, lotes, determinismo y cero trabajo por frame.
- Yui: jerarquía grande/media/pequeña y acabado sobrio.
- Diego: regresión cero del sistema sonoro y sonda comparable.
- Haruto: tipología ferroviaria, lado de puertas, clearances y ausencia de
  religiosidad de parque temático.
- Lena: versión verificable, botón habitual, progreso móvil y cierre del flujo.
- Sam: cohesión, verdad de las afirmaciones y publicabilidad.

## Notas honestas

- Las capturas fueron producidas con navegador de escritorio; 390×844 valida
  interfaz, no temperatura ni GPU física de iPhone/Android.
- La PWA/offline se certifica después del despliegue y la prueba de Rubén.
- El aviso deprecado `THREE.Clock` continúa; no nace en este pase.
- Los fondos procedurales `quiet` no se reescriben: la familia nueva es la capa
  hero cercana, no un rediseño global de Nara.
