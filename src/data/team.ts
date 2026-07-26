// Japan Loop is presented as the work of a small indie team — seven
// railfans and Japanophiles who share one rule: if it isn't fun, immersive,
// and good to look at and listen to, it doesn't ship. Fictional flavor text
// for the credits screen, not a real studio roster.

export interface TeamMember {
  name: string
  role: string
  note: string
}

export const TEAM: TeamMember[] = [
  { name: 'Aiko Tanabe', role: 'Directora creativa & ex-conductora aficionada', note: 'Se pasó tres años recorriendo andenes de todo Tokio con una grabadora antes de fundar el estudio.' },
  { name: 'Marco Ferretti', role: 'Programador principal', note: 'Construyó su primer simulador de trenes en QBasic a los doce años y nunca lo dejó.' },
  { name: 'Yui Sakamoto', role: 'Arte y ambientación', note: 'Ha fotografiado los treinta andenes del anillo en las cuatro estaciones del año.' },
  { name: 'Diego Reyes', role: 'Diseño de sonido', note: 'Compone las melodías originales de cada estación en su piano vertical de 1987.' },
  { name: 'Haruto Endo', role: 'Investigación e historia ferroviaria', note: 'Colecciona horarios de tren descatalogados y corrige a todo el equipo sobre precisión.' },
  { name: 'Lena Vogt', role: 'UX e interfaces', note: 'Insiste en que la palanca de mando se sienta "pesada" aunque sea solo software.' },
  { name: 'Sam Okafor', role: 'Producción y comunidad', note: 'El que de verdad se pone de acuerdo con los otros seis antes de cada lanzamiento.' },
]
