// The ring is a DREAM TOUR of Japan, not a real line: thirty stops, each an
// allegory of a recognizable Japanese place, matched to what the world
// actually shows there — the temple hill is Kiyomizu, the village of steep
// old roofs right after it is Shirakawa-gō, the vermilion torii is Fushimi
// Inari, the coast is Kamakura and Enoshima, the giant glowing billboard is
// Dōtonbori, and the red-brick station among the towers is Tokyo itself.
// Geography is deliberately impossible (Sapporo two stops from Kyoto): this
// is the Japan of a postcard box, not of a map.
//
// The inter-station distances are UNCHANGED from the original layout: every
// world anchor (the hill center, the trench window, the crossing, the coast
// arc) derives from these cumulative distances, so they are load-bearing.

/**
 * Structural zone tier — drives density/height/vegetation/signage contrast
 * that reads the same at any hour (unlike lighting, which only shows at
 * night). 'quiet' = low-rise and green, 'mid' = moderate towers and mixed
 * use, 'urban' = dense skyline and neon-saturated.
 */
export type ZoneTier = 'quiet' | 'mid' | 'urban'

export type StationTheme = {
  buildingColor: number
  accentColor: number
  district: 'business' | 'downtown' | 'shitamachi' | 'green' | 'youth' | 'bay'
  tier: ZoneTier
}

export interface StationDef {
  id: string
  nameEn: string
  nameJa: string
  /** Furigana reading of nameJa, shown small above the kanji on station signs. */
  nameKana: string
  distanceToNextKm: number
  landmark: boolean
  theme: StationTheme
  blurb: string
  /**
   * Which side the doors open, read out in announcements. An assigned
   * stylistic value — this stylized single-loop world has no second track.
   */
  doorSide: 'left' | 'right'
  /** Flavor transfers at the landmark stops: real, commonly-known lines OF EACH PLACE, so the PA sells the allegory. */
  transferLines?: string[]
}

const THEMES: Record<StationTheme['district'], StationTheme> = {
  business: { buildingColor: 0x445064, accentColor: 0x8fa3c4, district: 'business', tier: 'mid' },
  downtown: { buildingColor: 0x51465c, accentColor: 0xe0559a, district: 'downtown', tier: 'urban' },
  shitamachi: { buildingColor: 0x5c4a3c, accentColor: 0xd98f4a, district: 'shitamachi', tier: 'quiet' },
  green: { buildingColor: 0x3f5540, accentColor: 0x8fce6a, district: 'green', tier: 'quiet' },
  youth: { buildingColor: 0x4a3f5c, accentColor: 0xff5da2, district: 'youth', tier: 'urban' },
  bay: { buildingColor: 0x3a4a58, accentColor: 0x5ad1e0, district: 'bay', tier: 'mid' },
}

export const STATIONS: StationDef[] = [
  { id: 'tokyo', nameEn: 'Tokyo', nameJa: '東京', nameKana: 'とうきょう', distanceToNextKm: 1.3, landmark: true, theme: THEMES.business, blurb: 'La fachada de ladrillo rojo y el corazón ferroviario de Japón.', doorSide: 'left', transferLines: ['Shinkansen', 'Chuo Line', 'Keihin-Tohoku Line', 'Tokaido Line', 'Marunouchi Subway Line'] },
  { id: 'yokohama', nameEn: 'Yokohama', nameJa: '横浜', nameKana: 'よこはま', distanceToNextKm: 1.2, landmark: false, theme: THEMES.business, blurb: 'Torres frente al puerto y la noria del muelle.', doorSide: 'left' },
  { id: 'susukino', nameEn: 'Susukino', nameJa: 'すすきの', nameKana: 'すすきの', distanceToNextKm: 1.4, landmark: true, theme: THEMES.downtown, blurb: 'El neón de Sapporo encendido bajo la nieve del norte.', doorSide: 'left', transferLines: ['Namboku Subway Line', 'Sapporo Streetcar'] },
  { id: 'nishiki', nameEn: 'Nishiki', nameJa: '錦', nameKana: 'にしき', distanceToNextKm: 0.6, landmark: false, theme: THEMES.shitamachi, blurb: 'La cocina de Kioto: un mercado estrecho que huele a té y encurtidos.', doorSide: 'right' },
  { id: 'nara', nameEn: 'Nara', nameJa: '奈良', nameKana: 'なら', distanceToNextKm: 1.1, landmark: true, theme: THEMES.green, blurb: 'Un gran parque donde los ciervos saludan entre templos.', doorSide: 'left', transferLines: ['Kintetsu Nara Line', 'Yamatoji Line'] },
  { id: 'koyasan', nameEn: 'Koyasan', nameJa: '高野山', nameKana: 'こうやさん', distanceToNextKm: 1.4, landmark: false, theme: THEMES.shitamachi, blurb: 'Monasterios en silencio entre cedros centenarios.', doorSide: 'right' },
  { id: 'kanazawa', nameEn: 'Kanazawa', nameJa: '金沢', nameKana: 'かなざわ', distanceToNextKm: 0.7, landmark: false, theme: THEMES.shitamachi, blurb: 'Callejas de casas de té y pan de oro.', doorSide: 'left' },
  { id: 'takayama', nameEn: 'Takayama', nameJa: '高山', nameKana: 'たかやま', distanceToNextKm: 1.2, landmark: false, theme: THEMES.shitamachi, blurb: 'Un mar de tejados oscuros en un pueblo de montaña.', doorSide: 'left' },
  { id: 'uji', nameEn: 'Uji', nameJa: '宇治', nameKana: 'うじ', distanceToNextKm: 1.4, landmark: false, theme: THEMES.shitamachi, blurb: 'Campos de té verde y un paso a nivel que canta.', doorSide: 'right' },
  { id: 'kiyomizu', nameEn: 'Kiyomizu', nameJa: '清水', nameKana: 'きよみず', distanceToNextKm: 1.2, landmark: false, theme: THEMES.green, blurb: 'El templo de la colina: sakura y momiji sobre el andén.', doorSide: 'right' },
  { id: 'shirakawa-go', nameEn: 'Shirakawa-go', nameJa: '白川郷', nameKana: 'しらかわごう', distanceToNextKm: 1.9, landmark: false, theme: THEMES.shitamachi, blurb: 'Las casas de tejado empinado que rezan juntas al valle.', doorSide: 'left' },
  { id: 'arashiyama', nameEn: 'Arashiyama', nameJa: '嵐山', nameKana: 'あらしやま', distanceToNextKm: 1.8, landmark: false, theme: THEMES.shitamachi, blurb: 'El tranvía Randen, el bambú y el río.', doorSide: 'right' },
  { id: 'fukuoka', nameEn: 'Fukuoka', nameJa: '福岡', nameKana: 'ふくおか', distanceToNextKm: 0.9, landmark: true, theme: THEMES.downtown, blurb: 'La torre junto a la playa y los puestos de ramen de la noche.', doorSide: 'left', transferLines: ['Kuko Subway Line', 'Nishitetsu Tenjin Line'] },
  { id: 'karuizawa', nameEn: 'Karuizawa', nameJa: '軽井沢', nameKana: 'かるいざわ', distanceToNextKm: 1.6, landmark: false, theme: THEMES.green, blurb: 'Bosques frescos donde la ciudad va a respirar.', doorSide: 'right' },
  { id: 'hiroshima', nameEn: 'Hiroshima', nameJa: '広島', nameKana: 'ひろしま', distanceToNextKm: 1.1, landmark: false, theme: THEMES.youth, blurb: 'Okonomiyaki y tranvías junto al delta.', doorSide: 'right' },
  { id: 'chukagai', nameEn: 'Chukagai', nameJa: '中華街', nameKana: 'ちゅうかがい', distanceToNextKm: 0.9, landmark: false, theme: THEMES.youth, blurb: 'El barrio chino de Yokohama: farolillos y vapor de baozi.', doorSide: 'left' },
  { id: 'nagoya', nameEn: 'Nagoya', nameJa: '名古屋', nameKana: 'なごや', distanceToNextKm: 1.4, landmark: true, theme: THEMES.downtown, blurb: 'Rascacielos sobre la estación y delfines dorados en el castillo.', doorSide: 'left', transferLines: ['Shinkansen', 'Meitetsu Line', 'Kintetsu Line', 'Higashiyama Subway Line'] },
  { id: 'sendai', nameEn: 'Sendai', nameJa: '仙台', nameKana: 'せんだい', distanceToNextKm: 1.0, landmark: false, theme: THEMES.business, blurb: 'La ciudad de los árboles: avenidas enteras bajo zelkovas.', doorSide: 'right' },
  { id: 'fushimi-inari', nameEn: 'Fushimi Inari', nameJa: '伏見稲荷', nameKana: 'ふしみいなり', distanceToNextKm: 1.4, landmark: true, theme: THEMES.youth, blurb: 'Mil torii bermellón subiendo la montaña del zorro.', doorSide: 'left', transferLines: ['Keihan Main Line', 'JR Nara Line'] },
  { id: 'dotonbori', nameEn: 'Dotonbori', nameJa: '道頓堀', nameKana: 'どうとんぼり', distanceToNextKm: 2.1, landmark: true, theme: THEMES.youth, blurb: 'Pantallas gigantes sobre el canal — y el corredor se hunde bajo la ciudad.', doorSide: 'left', transferLines: ['Midosuji Subway Line', 'Sennichimae Subway Line', 'Nankai Line'] },
  { id: 'otaru', nameEn: 'Otaru', nameJa: '小樽', nameKana: 'おたる', distanceToNextKm: 1.2, landmark: false, theme: THEMES.business, blurb: 'Almacenes de canal, lámparas de cristal y cerveza.', doorSide: 'right' },
  { id: 'yoshino', nameEn: 'Yoshino', nameJa: '吉野', nameKana: 'よしの', distanceToNextKm: 1.6, landmark: false, theme: THEMES.green, blurb: 'La montaña que se cubre entera de cerezos.', doorSide: 'right' },
  { id: 'shizuoka', nameEn: 'Shizuoka', nameJa: '静岡', nameKana: 'しずおか', distanceToNextKm: 1.6, landmark: false, theme: THEMES.business, blurb: 'Té en las laderas y el Fuji asomado sobre los tejados.', doorSide: 'left' },
  { id: 'kawasaki', nameEn: 'Kawasaki', nameJa: '川崎', nameKana: 'かわさき', distanceToNextKm: 0.9, landmark: false, theme: THEMES.business, blurb: 'Fábricas convertidas en torres de cristal.', doorSide: 'left' },
  { id: 'kamakura', nameEn: 'Kamakura', nameJa: '鎌倉', nameKana: 'かまくら', distanceToNextKm: 1.6, landmark: true, theme: THEMES.bay, blurb: 'El gran Buda a un paso y el mar al fondo del andén.', doorSide: 'right', transferLines: ['Enoden', 'Yokosuka Line', 'Shonan-Shinjuku Line'] },
  { id: 'enoshima', nameEn: 'Enoshima', nameJa: '江の島', nameKana: 'えのしま', distanceToNextKm: 1.3, landmark: false, theme: THEMES.bay, blurb: 'La isla del faro al final del puente.', doorSide: 'right' },
  { id: 'himeji', nameEn: 'Himeji', nameJa: '姫路', nameKana: 'ひめじ', distanceToNextKm: 1.5, landmark: false, theme: THEMES.business, blurb: 'La garza blanca: el castillo más bello de Japón.', doorSide: 'left' },
  { id: 'kobe', nameEn: 'Kobe', nameJa: '神戸', nameKana: 'こうべ', distanceToNextKm: 1.2, landmark: false, theme: THEMES.bay, blurb: 'La torre roja del puerto y luces subiendo la montaña.', doorSide: 'right' },
  { id: 'shinsekai', nameEn: 'Shinsekai', nameJa: '新世界', nameKana: 'しんせかい', distanceToNextKm: 1.1, landmark: false, theme: THEMES.business, blurb: 'Kushikatsu y farolillos bajo la torre Tsūtenkaku.', doorSide: 'left' },
  { id: 'ginza', nameEn: 'Ginza', nameJa: '銀座', nameKana: 'ぎんざ', distanceToNextKm: 0.9, landmark: false, theme: THEMES.business, blurb: 'Escaparates de lujo: la capital ya se anuncia.', doorSide: 'right' },
]

export const TOTAL_LOOP_KM = STATIONS.reduce((sum, s) => sum + s.distanceToNextKm, 0)

export function nextStationIndex(i: number): number {
  return (i + 1) % STATIONS.length
}

export function prevStationIndex(i: number): number {
  return (i - 1 + STATIONS.length) % STATIONS.length
}
