# Estrategia gráfica — Tokyo Loop

Objetivo: estética "muy buena" (referente: la atmósfera de Cloudpunk/Nivalis de
ION LANDS) sin bajar de 60 fps en móvil de gama media.

**Estado 0.2.1:** la cifra vieja de 150–164 draws ya no es vigente. En la misma
cabina y posición, 0.2.0 daba 200 draws/~670k tri con sombras; la vertical
0.2.1 da 207–211/~688–720k a 300 m. El coste exacto, LOD de personajes y
condiciones están en `SISTEMAS-0.2.1.md`. El presupuesto se decide con frame
time/térmica de iPhone; el recuento sigue siendo la alarma estructural.

## ¿Voxels? No — y por qué

Cloudpunk **parece** voxels pero no renderiza cubos: son mallas optimizadas (greedy meshing) con *estética* voxel. Su magia no está en los cubos sino en la **atmósfera**: niebla volumétrica, bloom de neones, lluvia, reflejos húmedos y paleta nocturna. Todo eso es alcanzable sobre nuestra base low-poly actual sin reescribir nada. Pasar a voxels de verdad = rehacer todos los generadores procedurales para ganar un estilo que se puede evocar con dirección de arte. **Veredicto: no migrar.** Si se quiere el sabor voxel en edificios concretos, la vía es assets externos estilo MagicaVoxel (ver abajo), no un cambio de motor.

## El multiplicador real: postprocesado selectivo (prioridad 1)

1. **Bloom selectivo nocturno** — EL truco de Cloudpunk. Los neones, farolillos, LED y ventanas ya son emisivos; un bloom a media resolución (threshold alto, solo lo emisivo brilla) transforma la noche por completo. Coste: ~1-2 ms GPU a half-res. Lib recomendada: `pmndrs/postprocessing` (fusiona pasadas, más rápida que EffectComposer clásico). Activar con intensidad ligada a nightFactor (0 de día = gratis de día).
2. **Viñeta + grano fino** — una pasada trivial, da acabado "de juego caro".
3. **NO usar**: SSAO, SSR, motion blur — matan el fill rate móvil y no pegan con el estilo.

## Atmósfera (prioridad 2)

- **Height fog**: niebla más densa cerca del suelo (patch del chunk de fog). Profundidad instantánea al amanecer/anochecer.
- **Glow cards**: billboards con degradado radial bajo farolas y neones de noche (halos falsos, coste cero práctico).
- **Modo lluvia** (el "momento Cloudpunk"): streaks instanciados alrededor de la cámara + suelo/andén oscurecidos con roughness bajada + charcos (planos con envMap) + envMapIntensity subida. 4-6 h de trabajo, cambia el juego entero de personalidad. Podría ser aleatorio por vuelta o un preset más del reloj.
- **Reflejo del skyline en ventanas**: subir envMapIntensity por material en edificios cercanos (ya existe el RoomEnvironment).

## Presupuesto de rendimiento y trucos (mantener 60 fps)

- El antiguo objetivo absoluto ≤120 draws/≤500k tri ya no describe el mundo
  actual y no debe citarse como si pasara. La regla vigente para una extensión
  artística es: presupuesto incremental explícito, A/B en el mismo encuadre y
  validación física de frame time/térmica. En 0.2.1: +3,5…5,5 % draws y
  +2,9…7,4 % tri a 300 m.
- **Sectorización del anillo**: dividir los pools instanciados por sectores del loop (p. ej. 8 arcos) y esconder los no visibles — la cámara nunca ve más de ~1/4 del anillo. Recupera presupuesto para todo lo demás. (Mayor ganancia pendiente.)
- **Sombra**: mantener 1024 y bias actual; actualizar la shadow camera cada 2-3 frames si hiciera falta rascar ms.
- **LOD barato**: las casas a >500 m pueden colapsar a cajas sin tejado (segundo pool); evaluar solo si el sector visible se carga.
- Ya aplicado y a conservar: instancing masivo, texturas 256², nubes con fill rate capado, faro apagado de día, cero allocs por frame.

## Assets externos — pipeline si me pasas modelos

Sí me puedes pasar assets; requisitos para que entren sin dolor:

- **Formato**: glTF/GLB. Si vienen de MagicaVoxel (.vox), exportar a OBJ y convertir (obj2gltf) — o me pasas el .vox y lo convierto yo.
- **Presupuesto por modelo**: héroes de estación ≤20k tris; props repetibles ≤2k tris (van instanciados). Texturas ≤1024², a poder ser paleta plana (el estilo actual no usa UV complejos).
- **Optimización**: los paso por `gltf-transform` (Draco/meshopt + KTX2) antes de integrarlos.
- **Fuentes recomendadas** si no quieres encargar arte: Kenney (CC0, kits city/trains), Quaternius (CC0 low-poly), Kay Lousberg (kits japoneses low-poly). Para sabor voxel: cualquier artista de MagicaVoxel en itch.io — un kit de 10-15 edificios japoneses voxel para los landmarks daría el guiño Cloudpunk sin migrar nada.
- Dónde rinden más los assets externos, por orden: 1) el **tren** visto en andenes/reflejos, 2) edificios héroe de las 7 estaciones landmark, 3) props de andén (bancos, máquinas, tornos), 4) vehículos de calle aparcados.
- **Image-to-3D / `img2threejs`**: no convertir una captura completa de juego.
  Probar un solo hero prop sobre fondo limpio, sin personas ni vegetación,
  frente y 3/4 claros; después separar, escalar, decimar, meshopt y medir
  contra el módulo procedimental. La decisión aplicada y los prompts están en
  `SISTEMAS-0.2.1.md`.

## Orden de ejecución propuesto

| # | Qué | Esfuerzo | Impacto |
|---|-----|----------|---------|
| 1 | Bloom selectivo nocturno + viñeta | 2-4 h | Transforma la noche |
| 2 | Height fog + glow cards | 2 h | Profundidad a todas horas |
| 3 | Sectorización del anillo | medida detrás de bandera; falta veredicto iPhone | Presupuesto para el resto |
| 4 | Modo lluvia + suelo húmedo | 4-6 h | El "momento Cloudpunk" |
| 5 | Kit de edificios externo (landmarks) | según assets | Identidad por estación |
| 6 | Charcos/reflejos y pulido final | 2-3 h | Acabado |

La vertical modular Susukino→Nishiki y el primer LOD híbrido de pasajeros ya
están hechos en 0.2.1. El siguiente paso no es sumar otra técnica global:
primero se conduce esta pareja en el iPhone, luego se extrae el kit y se prueba
una tercera familia `green`/`bay`.
