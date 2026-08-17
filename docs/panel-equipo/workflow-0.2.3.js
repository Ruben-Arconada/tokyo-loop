export const meta = {
  name: 'reunion-equipo-023-cierre',
  description: 'Los 7 perfiles revisan Nara green, coste móvil y release 0.2.3',
  phases: [{ title: 'Revisión 0.2.3' }],
}

const ROOT = '/Users/clickcom/tokyo-loop'
const BRIEF = `${ROOT}/docs/panel-equipo/brief-0.2.3.md`
const SHOTS = `${ROOT}/docs/art-0.2.3/captures`

const SCHEMA = {
  type: 'object',
  properties: {
    nombre: { type: 'string' },
    nota: { type: 'number', minimum: 1, maximum: 10 },
    veredicto: { type: 'string' },
    mejoras: { type: 'array', items: { type: 'string' } },
  },
  required: ['nombre', 'nota', 'veredicto', 'mejoras'],
  additionalProperties: false,
}

const JUDGES = [
  ['Aiko Tanabe', 'Dirección creativa e inmersión'],
  ['Marco Ferretti', 'Rendimiento, determinismo y solidez técnica'],
  ['Yui Sakamoto', 'Arte, jerarquía y ambientación'],
  ['Diego Reyes', 'Audio y comparabilidad de la sonda'],
  ['Haruto Endo', 'Rigor ferroviario y japonesidad'],
  ['Lena Vogt', 'UX móvil y trazabilidad de versión'],
  ['Sam Okafor', 'Producción, cohesión y verdad del release'],
]

phase('Revisión 0.2.3')
const results = await parallel(JUDGES.map(([nombre, aspecto]) => () =>
  agent(
    `Cierre de Japan Loop 0.2.3. Eres ${nombre}. Tu aspecto es: ${aspecto}.\n\n` +
    `Lee COMPLETO ${BRIEF}, ${ROOT}/docs/SISTEMAS-0.2.3.md y las ocho capturas de ${SHOTS}. ` +
    `Inspecciona el código citado cuando corresponda. Puntúa de 1 a 10. ` +
    `8 significa listo para publicar con orgullo: ni regales el 8 ni muevas la portería con otro pase. ` +
    `Separa un bloqueo real de una mejora futura. Responde en español.`,
    { label: `juez-023:${nombre.split(' ')[0].toLowerCase()}`, phase: 'Revisión 0.2.3', schema: SCHEMA },
  ),
))

const votes = results.filter(Boolean)
const aprobado = votes.length === JUDGES.length && votes.every((v) => v.nota >= 8)
log(`0.2.3: ${votes.map((v) => `${v.nombre.split(' ')[0]} ${v.nota}`).join(' · ')} → ${aprobado ? 'CONSENSO' : 'sin consenso'}`)
return { aprobado, votes }
