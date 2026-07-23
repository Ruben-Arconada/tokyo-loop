// Real Yamanote Line stations, in loop order (sotomawari / clockwise direction).
// Distances are approximate real-world inter-station distances in km, used only
// to give the loop a stylized, non-uniform rhythm — this is an artistic
// interpretation of the line, not a to-scale map of Tokyo.

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
   * Which side the doors open, read out in announcements. Real JR platforms
   * do have a fixed side per station, but we don't model two physical tracks
   * side-by-side in this stylized single-loop world, so this is an assigned
   * stylistic value rather than verified real-world platform data.
   */
  doorSide: 'left' | 'right'
  /** Real, commonly-known transfer lines — only filled in for landmark stations to avoid guessing at obscure ones. */
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
  { id: 'kanda', nameEn: 'Kanda', nameJa: '神田', nameKana: 'かんだ', distanceToNextKm: 1.2, landmark: false, theme: THEMES.business, blurb: 'Callejones de oficinistas bajo las vías elevadas.', doorSide: 'left' },
  { id: 'akihabara', nameEn: 'Akihabara', nameJa: '秋葉原', nameKana: 'あきはばら', distanceToNextKm: 1.4, landmark: true, theme: THEMES.downtown, blurb: 'Neones, anime y electrónica hasta donde alcanza la vista.', doorSide: 'left', transferLines: ['Sobu Line', 'Hibiya Subway Line', 'Tsukuba Express'] },
  { id: 'okachimachi', nameEn: 'Okachimachi', nameJa: '御徒町', nameKana: 'おかちまち', distanceToNextKm: 0.6, landmark: false, theme: THEMES.shitamachi, blurb: 'El bullicio del mercado de Ameyoko justo al lado.', doorSide: 'right' },
  { id: 'ueno', nameEn: 'Ueno', nameJa: '上野', nameKana: 'うえの', distanceToNextKm: 1.1, landmark: true, theme: THEMES.green, blurb: 'La estación puerta al gran parque y sus cerezos.', doorSide: 'left', transferLines: ['Keihin-Tohoku Line', 'Joban Line', 'Ginza Subway Line', 'Hibiya Subway Line', 'Keisei Line'] },
  { id: 'uguisudani', nameEn: 'Uguisudani', nameJa: '鶯谷', nameKana: 'うぐいすだに', distanceToNextKm: 1.4, landmark: false, theme: THEMES.shitamachi, blurb: 'Un rincón tranquilo entre templos.', doorSide: 'right' },
  { id: 'nippori', nameEn: 'Nippori', nameJa: '日暮里', nameKana: 'にっぽり', distanceToNextKm: 0.7, landmark: false, theme: THEMES.shitamachi, blurb: 'Barrio textil de calles estrechas.', doorSide: 'left' },
  { id: 'nishi-nippori', nameEn: 'Nishi-Nippori', nameJa: '西日暮里', nameKana: 'にしにっぽり', distanceToNextKm: 1.2, landmark: false, theme: THEMES.shitamachi, blurb: 'Vistas sobre un mar de tejados bajos.', doorSide: 'left' },
  { id: 'tabata', nameEn: 'Tabata', nameJa: '田端', nameKana: 'たばた', distanceToNextKm: 1.4, landmark: false, theme: THEMES.shitamachi, blurb: 'Cruce silencioso de líneas hacia el norte.', doorSide: 'right' },
  { id: 'komagome', nameEn: 'Komagome', nameJa: '駒込', nameKana: 'こまごめ', distanceToNextKm: 1.2, landmark: false, theme: THEMES.green, blurb: 'Cerca de jardines japoneses centenarios.', doorSide: 'right' },
  { id: 'sugamo', nameEn: 'Sugamo', nameJa: '巣鴨', nameKana: 'すがも', distanceToNextKm: 1.9, landmark: false, theme: THEMES.shitamachi, blurb: 'La calle comercial favorita de las abuelas de Tokio.', doorSide: 'left' },
  { id: 'otsuka', nameEn: 'Otsuka', nameJa: '大塚', nameKana: 'おおつか', distanceToNextKm: 1.8, landmark: false, theme: THEMES.shitamachi, blurb: 'Uno de los últimos tranvías de la ciudad cruza aquí.', doorSide: 'right' },
  { id: 'ikebukuro', nameEn: 'Ikebukuro', nameJa: '池袋', nameKana: 'いけぶくろ', distanceToNextKm: 0.9, landmark: true, theme: THEMES.downtown, blurb: 'Rascacielos, grandes almacenes y la torre Sunshine.', doorSide: 'left', transferLines: ['Marunouchi Subway Line', 'Yurakucho Subway Line', 'Tobu Tojo Line', 'Seibu Ikebukuro Line'] },
  { id: 'mejiro', nameEn: 'Mejiro', nameJa: '目白', nameKana: 'めじろ', distanceToNextKm: 1.6, landmark: false, theme: THEMES.green, blurb: 'Un respiro arbolado junto a un campus universitario.', doorSide: 'right' },
  { id: 'takadanobaba', nameEn: 'Takadanobaba', nameJa: '高田馬場', nameKana: 'たかだのばば', distanceToNextKm: 1.1, landmark: false, theme: THEMES.youth, blurb: 'Estudiantes y sonidos de guitarra callejera.', doorSide: 'right' },
  { id: 'shin-okubo', nameEn: 'Shin-Okubo', nameJa: '新大久保', nameKana: 'しんおおくぼ', distanceToNextKm: 0.9, landmark: false, theme: THEMES.youth, blurb: 'El barrio coreano más animado de Tokio.', doorSide: 'left' },
  { id: 'shinjuku', nameEn: 'Shinjuku', nameJa: '新宿', nameKana: 'しんじゅく', distanceToNextKm: 1.4, landmark: true, theme: THEMES.downtown, blurb: 'El nudo de trenes más transitado del planeta.', doorSide: 'left', transferLines: ['Chuo Line', 'Sobu Line', 'Odakyu Line', 'Keio Line', 'Marunouchi Subway Line'] },
  { id: 'yoyogi', nameEn: 'Yoyogi', nameJa: '代々木', nameKana: 'よよぎ', distanceToNextKm: 1.0, landmark: false, theme: THEMES.business, blurb: 'Entre el bullicio de Shinjuku y la calma del parque.', doorSide: 'right' },
  { id: 'harajuku', nameEn: 'Harajuku', nameJa: '原宿', nameKana: 'はらじゅく', distanceToNextKm: 1.4, landmark: true, theme: THEMES.youth, blurb: 'Moda excéntrica junto a la puerta del santuario Meiji.', doorSide: 'left', transferLines: ['Chiyoda Subway Line'] },
  { id: 'shibuya', nameEn: 'Shibuya', nameJa: '渋谷', nameKana: 'しぶや', distanceToNextKm: 2.1, landmark: true, theme: THEMES.youth, blurb: 'Pantallas gigantes y el cruce peatonal más famoso del mundo.', doorSide: 'left', transferLines: ['Tokyu Toyoko Line', 'Den-en-toshi Line', 'Keio Inokashira Line', 'Ginza Subway Line', 'Fukutoshin Subway Line'] },
  { id: 'ebisu', nameEn: 'Ebisu', nameJa: '恵比寿', nameKana: 'えびす', distanceToNextKm: 1.2, landmark: false, theme: THEMES.business, blurb: 'Antigua fábrica de cerveza reconvertida en barrio elegante.', doorSide: 'right' },
  { id: 'meguro', nameEn: 'Meguro', nameJa: '目黒', nameKana: 'めぐろ', distanceToNextKm: 1.6, landmark: false, theme: THEMES.green, blurb: 'Río de cerezos y calles en cuesta.', doorSide: 'right' },
  { id: 'gotanda', nameEn: 'Gotanda', nameJa: '五反田', nameKana: 'ごたんだ', distanceToNextKm: 1.6, landmark: false, theme: THEMES.business, blurb: 'Oficinas silenciosas junto al río Meguro.', doorSide: 'left' },
  { id: 'osaki', nameEn: 'Osaki', nameJa: '大崎', nameKana: 'おおさき', distanceToNextKm: 0.9, landmark: false, theme: THEMES.business, blurb: 'Torres de cristal donde antes hubo fábricas.', doorSide: 'left' },
  { id: 'shinagawa', nameEn: 'Shinagawa', nameJa: '品川', nameKana: 'しながわ', distanceToNextKm: 1.6, landmark: true, theme: THEMES.bay, blurb: 'Puerta hacia la bahía y el Shinkansen.', doorSide: 'right', transferLines: ['Shinkansen', 'Keikyu Main Line', 'Tokaido Line', 'Yokosuka Line'] },
  // "Takanawa Gateway" is a registered JR East trademark (reg. 6206454) —
  // the plain district toponym is used instead, like the other 29 stops.
  { id: 'takanawa', nameEn: 'Takanawa', nameJa: '高輪', nameKana: 'たかなわ', distanceToNextKm: 1.3, landmark: false, theme: THEMES.bay, blurb: 'La estación más joven de la línea, toda cristal y madera.', doorSide: 'right' },
  { id: 'tamachi', nameEn: 'Tamachi', nameJa: '田町', nameKana: 'たまち', distanceToNextKm: 1.5, landmark: false, theme: THEMES.business, blurb: 'Oficinas frente a la bahía de Tokio.', doorSide: 'left' },
  { id: 'hamamatsucho', nameEn: 'Hamamatsucho', nameJa: '浜松町', nameKana: 'はままつちょう', distanceToNextKm: 1.2, landmark: false, theme: THEMES.bay, blurb: 'La torre de Tokio se asoma entre los edificios.', doorSide: 'right' },
  { id: 'shimbashi', nameEn: 'Shimbashi', nameJa: '新橋', nameKana: 'しんばし', distanceToNextKm: 1.1, landmark: false, theme: THEMES.business, blurb: 'El bar bajo las vías donde los oficinistas brindan al salir.', doorSide: 'left' },
  { id: 'yurakucho', nameEn: 'Yurakucho', nameJa: '有楽町', nameKana: 'ゆうらくちょう', distanceToNextKm: 0.9, landmark: false, theme: THEMES.business, blurb: 'A un paso del Palacio Imperial y Ginza.', doorSide: 'right' },
]

export const TOTAL_LOOP_KM = STATIONS.reduce((sum, s) => sum + s.distanceToNextKm, 0)

export function nextStationIndex(i: number): number {
  return (i + 1) % STATIONS.length
}

export function prevStationIndex(i: number): number {
  return (i - 1 + STATIONS.length) % STATIONS.length
}
