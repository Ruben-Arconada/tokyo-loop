import * as THREE from 'three'
import type { Track } from './Track'
import { STATIONS, prevStationIndex } from '../data/stations'
import { PLATFORM_GEOM } from './City'
import { DOOR_ZS } from './TrainConsist'
import { HybridPassengers021, type HybridPassengerReport } from './HybridPassengers021'

// ————————————————————————————————————————————————————————————————
// Sprite passengers: little hand-drawn commuters generated entirely in
// code (a canvas sprite sheet, no external assets), rendered as one
// instanced billboard draw call for every platform on the loop. They idle
// on the platforms, and when the player opens the doors at a station they
// actually walk to the train and board — the first brick of the long-term
// "walkable world" dream (see memory: characters need real ground rules).
// ————————————————————————————————————————————————————————————————

const SPRITE_COLS = 6 // frames per row: 2 idle + 4 walk (staff row: fixed poses)
const SPRITE_ROWS = 9 // 8 commuter archetypes + the station attendant
const CELL_W = 128
const CELL_H = 192
/** World height of a standing sprite (before per-instance stature jitter). */
const SPRITE_H = 1.72
const SPRITE_W = SPRITE_H * (CELL_W / CELL_H)

/**
 * Sprites reserved per platform. They are a VIEW of PassengerFlow's numbers,
 * not the numbers themselves: a rush-hour platform holds hundreds, and what
 * these do is show the queue getting deeper as it fills.
 */
const WAITING_PER_STATION = 18
const ALIGHT_POOL = 10
const N = STATIONS.length
/** One attendant per station, standing where the cab comes to rest. */
const STAFF_BASE = N * WAITING_PER_STATION + ALIGHT_POOL
const TOTAL = STAFF_BASE + N
/** Sprite-sheet row holding the attendant's poses. */
const STAFF_ROW = 8
/** Fixed frames within that row. */
const POSE_STAND = 0
const POSE_POINT = 2
const POSE_BOW = 3
const POSE_POINT_UP = 4

// The queue: two files flanking each doorway, growing away from the edge —
// the shape any Japanese platform takes without anyone being told.
const QUEUE_FILES = [-1, 1]
const QUEUE_ROWS = 3
/** Lateral gap from the platform edge to the head of a queue. */
const QUEUE_X0 = 1.75
const QUEUE_X_STEP = 0.78
/** How far each file stands to the side of its doorway's centre line. */
const QUEUE_Z_SPREAD = 1.15
/** Where the attendant stands: beside the stopping mark, at the leading end. */
const STAFF_Z = 29.5

/** Ambient visibility only re-rolls this often — cheap, and pops hide inside the crowd churn. */
const DENSITY_REFRESH_SECONDS = 1.6
const WALK_SPEED = 1.5

// aData.y modes, mirrored in the vertex shader.
const MODE_IDLE = 0
const MODE_WALK = 1
const MODE_HIDDEN = 2
/** Holds a single fixed frame (aData.z picks it) — how the attendant poses. */
const MODE_POSE = 3

type SlotState = 'ambient' | 'boarding' | 'boarded'

interface WaitingSlot {
  station: number
  /** Current local position: x lateral (side-signed), y along-platform Z. */
  local: THREE.Vector2
  roll: number
  state: SlotState
  /** Which doorway this person is queuing for. */
  doorIdx: number
  /** Position within that queue — decides who steps aboard first. */
  order: number
}

interface Walker {
  index: number
  station: number
  local: THREE.Vector2
  waypoints: THREE.Vector2[]
  wp: number
  delay: number
  speed: number
  /** Waiting slot being consumed — set for boarders, undefined for alighters. */
  slot?: WaitingSlot
}

/** What the platform needs to know about the train to stage its people. */
export interface PassengerContext {
  targetStation: number
  /** World units to the station being approached. */
  distanceToTarget: number
  /** World units since leaving the previous one. */
  distanceBehind: number
  stopped: boolean
  doorsOpen: number
  speed01: number
}

interface StationFrame {
  matrix: THREE.Matrix4
  origin: THREE.Vector3
  xAxis: THREE.Vector3
  zAxis: THREE.Vector3
  side: number
}

// ————— Sprite sheet drawing —————

interface Variant {
  skin: string
  hair: string
  hairStyle: 'short' | 'bob' | 'bun' | 'cap' | 'gray' | 'ponytail'
  capColor?: string
  top: string
  topShade: string
  /** 0 = jacket to the hip, 1 = long coat over the thigh. */
  longCoat?: boolean
  collar?: string
  bottom: string
  bottomStyle: 'pants' | 'skirt'
  /** Leg color under a skirt (tights/socks). */
  legWear?: string
  bag: 'briefcase' | 'satchel' | 'backpack' | 'tote' | 'none'
  bagColor?: string
  build: number
  stature: number
  /** Elderly forward lean, radians-ish factor for the side pose. */
  hunch?: number
  /**
   * Canopy color of the FURLED umbrella this commuter carries on wet days.
   * Furled on purpose: the platform has a roof, and nobody in Japan opens
   * an umbrella under the canopy — you carry it rolled until the street.
   * Absent = this archetype just gets wet (the backpack kids always do).
   */
  umbrella?: string
}

const VARIANTS: Variant[] = [
  // salaryman — navy suit, briefcase
  { skin: '#f0c8a8', hair: '#26221f', hairStyle: 'short', top: '#2c3444', topShade: '#232a38', collar: '#f2f2ec', bottom: '#2c3444', bottomStyle: 'pants', bag: 'briefcase', bagColor: '#4a3527', build: 1.0, stature: 1.0, umbrella: '#1d2738' },
  // office worker — gray blazer, tote
  { skin: '#f2cbab', hair: '#3b2d24', hairStyle: 'bob', top: '#6b7280', topShade: '#59616e', collar: '#e8e6df', bottom: '#4b5563', bottomStyle: 'skirt', legWear: '#3a3a42', bag: 'tote', bagColor: '#8a4a4a', build: 0.9, stature: 0.94, umbrella: '#7a3040' },
  // high-school girl — sailor uniform, satchel
  { skin: '#f2cbab', hair: '#2a2018', hairStyle: 'ponytail', top: '#f5f5f0', topShade: '#e2e2da', collar: '#27324a', bottom: '#27324a', bottomStyle: 'skirt', legWear: '#2b2b33', bag: 'satchel', bagColor: '#6d4a2f', build: 0.85, stature: 0.88, umbrella: '#cfd8e2' },
  // high-school boy — white shirt, backpack
  { skin: '#edc4a0', hair: '#1e1a16', hairStyle: 'short', top: '#f2f2ec', topShade: '#dddbd2', bottom: '#2b2f3a', bottomStyle: 'pants', bag: 'backpack', bagColor: '#3f5a63', build: 0.9, stature: 0.9 },
  // elderly man — earth-tone vest, gentle stoop
  { skin: '#e8bc9a', hair: '#b9b4ac', hairStyle: 'gray', top: '#5d4f3f', topShade: '#4c4034', collar: '#cfc8b8', bottom: '#57544c', bottomStyle: 'pants', bag: 'none', build: 0.95, stature: 0.9, hunch: 1, umbrella: '#3b4034' },
  // youth — warm hoodie
  { skin: '#edc4a0', hair: '#3a2b20', hairStyle: 'short', top: '#b3432e', topShade: '#93392a', bottom: '#33383f', bottomStyle: 'pants', bag: 'none', build: 1.0, stature: 0.97 },
  // woman in a long coat — bun, tote
  { skin: '#f2cbab', hair: '#443128', hairStyle: 'bun', top: '#7d5a68', topShade: '#6b4c59', longCoat: true, bottom: '#3f3a44', bottomStyle: 'pants', bag: 'tote', bagColor: '#8a6a42', build: 0.92, stature: 0.96, umbrella: '#5a4a66' },
  // traveler — cap and backpack
  { skin: '#eec6a6', hair: '#57422e', hairStyle: 'cap', capColor: '#3c6e51', top: '#d9d3c6', topShade: '#c7c1b3', bottom: '#56606a', bottomStyle: 'pants', bag: 'backpack', bagColor: '#a34d3f', build: 1.05, stature: 1.0, umbrella: '#274a3f' },
]

const SHOE = '#1c1a18'

/**
 * A furled umbrella hanging from a hand at (hx, hy): shaft, wrapped canopy
 * tapering to the ferrule, and a little J-handle above the grip. Small
 * enough to read at sprite scale, colored enough to read as "rainy day".
 */
function drawFurledUmbrella(ctx: CanvasRenderingContext2D, color: string, hx: number, hy: number) {
  ctx.strokeStyle = '#2a2c30'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(hx, hy - 7)
  ctx.lineTo(hx, hy + 34)
  ctx.stroke()
  // J-handle above the grip.
  ctx.beginPath()
  ctx.arc(hx - 3, hy - 7, 3, 0, Math.PI, true)
  ctx.stroke()
  // Wrapped canopy: a slim teardrop down the shaft.
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(hx - 3.2, hy + 4)
  ctx.quadraticCurveTo(hx - 2.2, hy + 22, hx, hy + 30)
  ctx.quadraticCurveTo(hx + 2.2, hy + 22, hx + 3.2, hy + 4)
  ctx.quadraticCurveTo(hx, hy + 1, hx - 3.2, hy + 4)
  ctx.fill()
  // Ferrule tip.
  ctx.fillStyle = '#8f9399'
  ctx.fillRect(hx - 1, hy + 30, 2, 4)
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fill()
}

/** Head + hair, shared by both poses. `dir` 0 = facing viewer, 1 = profile facing +x. */
function drawHead(ctx: CanvasRenderingContext2D, v: Variant, cx: number, cy: number, r: number, dir: number) {
  ctx.fillStyle = v.skin
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = v.hairStyle === 'cap' ? v.capColor! : v.hair
  const capBrim = v.hairStyle === 'cap'
  ctx.beginPath()
  if (dir === 0) {
    // Cap of the skull plus temples, tighter for a cap.
    ctx.arc(cx, cy - (capBrim ? 1 : 0), r + 1.5, Math.PI * (capBrim ? 1.05 : 0.95), Math.PI * (capBrim ? 1.95 : 2.05))
    ctx.lineTo(cx + r * 0.95, cy + (capBrim ? -r * 0.35 : r * 0.15))
    ctx.lineTo(cx - r * 0.95, cy + (capBrim ? -r * 0.35 : r * 0.15))
  } else {
    // Profile: hair hugs the back of the skull.
    ctx.arc(cx - 1, cy - 1, r + 1.5, Math.PI * 0.75, Math.PI * 1.9)
    ctx.lineTo(cx + r * 0.55, cy - r * 0.55)
    ctx.lineTo(cx - r * 0.9, cy + r * 0.35)
  }
  ctx.closePath()
  ctx.fill()
  if (capBrim) {
    ctx.fillStyle = v.capColor!
    if (dir === 0) rr(ctx, cx - r - 2, cy - r * 0.5, (r + 2) * 2, 4, 2)
    else rr(ctx, cx, cy - r * 0.55, r + 8, 4, 2)
  }
  if (v.hairStyle === 'bob') {
    ctx.fillStyle = v.hair
    if (dir === 0) {
      rr(ctx, cx - r - 2.5, cy - r * 0.6, 5, r * 1.35, 2.5)
      rr(ctx, cx + r - 2.5, cy - r * 0.6, 5, r * 1.35, 2.5)
    } else {
      rr(ctx, cx - r - 2.5, cy - r * 0.6, 7, r * 1.45, 3)
    }
  }
  if (v.hairStyle === 'bun') {
    ctx.fillStyle = v.hair
    ctx.beginPath()
    ctx.arc(dir === 0 ? cx : cx - r * 0.9, cy - r * 0.9, 4.5, 0, Math.PI * 2)
    ctx.fill()
  }
  if (v.hairStyle === 'ponytail') {
    ctx.fillStyle = v.hair
    if (dir === 0) rr(ctx, cx - 3, cy - r - 4, 6, 5, 2.5)
    else rr(ctx, cx - r - 6, cy - r * 0.4, 6, r * 1.6, 3)
  }
}

/** Front-facing standing pose. `alt` adds a lazy weight shift so a crowd never stands in lockstep. */
function drawFront(ctx: CanvasRenderingContext2D, v: Variant, alt: number, wet = false) {
  const feet = 182
  const H = 156 * v.stature
  const headR = 16
  const headCy = feet - H + headR
  const sway = alt ? 2 : 0
  const cx = 64 + sway
  const shoulderY = headCy + headR + 4
  const torsoW = 40 * v.build
  const hipY = feet - H * 0.4
  const coatHem = v.longCoat ? hipY + H * 0.14 : hipY + 2

  // Legs (behind the torso hem).
  const legW = 12 * v.build
  const legGap = 5
  const drawLeg = (lx: number, lift: number) => {
    ctx.fillStyle = v.bottomStyle === 'pants' ? v.bottom : v.legWear ?? v.skin
    rr(ctx, lx, hipY, legW, feet - hipY - 4 - lift, legW * 0.35)
    ctx.fillStyle = SHOE
    rr(ctx, lx - 1, feet - 7 - lift, legW + 2, 7, 3)
  }
  drawLeg(cx - legW - legGap / 2, 0)
  drawLeg(cx + legGap / 2, alt ? 1.5 : 0)

  // Skirt over the legs.
  if (v.bottomStyle === 'skirt') {
    ctx.fillStyle = v.bottom
    ctx.beginPath()
    ctx.moveTo(cx - torsoW / 2, hipY - 4)
    ctx.lineTo(cx + torsoW / 2, hipY - 4)
    ctx.lineTo(cx + torsoW * 0.68, hipY + H * 0.12)
    ctx.lineTo(cx - torsoW * 0.68, hipY + H * 0.12)
    ctx.closePath()
    ctx.fill()
  }

  // Arms behind the torso silhouette edge (sleeves).
  const armW = 9 * v.build
  const armLen = hipY - shoulderY - 4
  ctx.fillStyle = v.topShade
  rr(ctx, cx - torsoW / 2 - armW + 2, shoulderY + 3, armW, armLen, armW / 2)
  rr(ctx, cx + torsoW / 2 - 2, shoulderY + 3, armW, armLen, armW / 2)
  // Hands.
  ctx.fillStyle = v.skin
  ctx.beginPath()
  ctx.arc(cx - torsoW / 2 - armW / 2 + 2, shoulderY + armLen + 5, 3.6, 0, Math.PI * 2)
  ctx.arc(cx + torsoW / 2 + armW / 2 - 2, shoulderY + armLen + 5, 3.6, 0, Math.PI * 2)
  ctx.fill()

  // Torso.
  ctx.fillStyle = v.top
  rr(ctx, cx - torsoW / 2, shoulderY, torsoW, coatHem - shoulderY, 7)
  // Collar / sailor kerchief.
  if (v.collar) {
    ctx.fillStyle = v.collar
    ctx.beginPath()
    ctx.moveTo(cx - torsoW * 0.28, shoulderY)
    ctx.lineTo(cx + torsoW * 0.28, shoulderY)
    ctx.lineTo(cx, shoulderY + 10)
    ctx.closePath()
    ctx.fill()
  }

  // Bags.
  if (v.bag === 'briefcase') {
    ctx.fillStyle = v.bagColor!
    rr(ctx, cx + torsoW / 2 + armW - 6, shoulderY + armLen + 6, 17, 13, 2.5)
  } else if (v.bag === 'tote') {
    ctx.fillStyle = v.bagColor!
    rr(ctx, cx - torsoW / 2 - armW - 6, shoulderY + armLen - 4, 15, 16, 3)
  } else if (v.bag === 'satchel') {
    ctx.strokeStyle = v.bagColor!
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.moveTo(cx - torsoW * 0.3, shoulderY + 1)
    ctx.lineTo(cx + torsoW / 2 + 2, hipY - 8)
    ctx.stroke()
    ctx.fillStyle = v.bagColor!
    rr(ctx, cx + torsoW / 2 - 4, hipY - 10, 15, 12, 2.5)
  } else if (v.bag === 'backpack') {
    // Straps only — the pack itself is behind the body.
    ctx.strokeStyle = v.bagColor!
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(cx - torsoW * 0.28, shoulderY + 1)
    ctx.lineTo(cx - torsoW * 0.28, hipY - 8)
    ctx.moveTo(cx + torsoW * 0.28, shoulderY + 1)
    ctx.lineTo(cx + torsoW * 0.28, hipY - 8)
    ctx.stroke()
  }

  // Rainy days put a furled umbrella in the free hand (bags keep their side).
  if (wet && v.umbrella) {
    const freeSide = v.bag === 'briefcase' || v.bag === 'satchel' ? -1 : 1
    drawFurledUmbrella(ctx, v.umbrella, cx + freeSide * (torsoW / 2 + armW / 2 + 1), shoulderY + armLen + 5)
  }

  drawHead(ctx, v, cx, headCy, headR, 0)
}

/** Profile walking pose facing +x. `wf` 0..3 = contact, pass, contact (other leg), pass. */
function drawSide(ctx: CanvasRenderingContext2D, v: Variant, wf: number, wet = false) {
  const feet = 182
  const H = 156 * v.stature
  const headR = 16
  const bob = wf % 2 === 1 ? 3 : 0
  const hipY = feet - H * 0.4 - bob
  const headCy = feet - H + headR - bob
  const cx = 64
  const hunch = v.hunch ? 1 : 0
  const torsoW = 27 * v.build
  const shoulderY = headCy + headR + 4
  const coatHem = v.longCoat ? hipY + H * 0.14 : hipY + 2
  const legW = 12 * v.build
  const legLen = feet - hipY
  // Swing pairs per frame: [front leg, back leg, near arm, far arm] in radians.
  const POSES = [
    [0.42, -0.38, -0.34, 0.3],
    [0.1, -0.06, -0.08, 0.05],
    [-0.38, 0.42, 0.3, -0.34],
    [-0.06, 0.1, 0.05, -0.08],
  ][wf]
  const [legA, legB, armNear, armFar] = POSES

  const limb = (angle: number, w: number, len: number, color: string, isLeg: boolean, shoe: boolean) => {
    ctx.save()
    ctx.translate(cx, isLeg ? hipY : shoulderY + 4)
    ctx.rotate(angle)
    ctx.fillStyle = color
    rr(ctx, -w / 2, 0, w, len, w * 0.4)
    if (shoe) {
      ctx.fillStyle = SHOE
      rr(ctx, -w / 2 - 1, len - 7, w + 5, 7, 3)
    } else if (!isLeg) {
      ctx.fillStyle = v.skin
      ctx.beginPath()
      ctx.arc(0, len + 2, 3.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  const legColor = v.bottomStyle === 'pants' ? v.bottom : v.legWear ?? v.skin
  const shade = (c: string) => {
    // Push the far limb a step darker so the two legs never fuse.
    const n = parseInt(c.slice(1), 16)
    const dim = (x: number) => Math.max(0, Math.round(x * 0.72))
    return `rgb(${dim(n >> 16)},${dim((n >> 8) & 255)},${dim(n & 255)})`
  }

  // Far side first: far arm, far (back) leg.
  limb(armFar, 8 * v.build, hipY - shoulderY - 8, shade(v.topShade), false, false)
  limb(legB, legW, legLen - 3, shade(legColor), true, true)
  // Backpack rides the back (-x when facing +x).
  if (v.bag === 'backpack') {
    ctx.fillStyle = v.bagColor!
    rr(ctx, cx - torsoW / 2 - 13, shoulderY + 6, 14, (hipY - shoulderY) * 0.62, 5)
  }
  // Near (front) leg.
  limb(legA, legW, legLen - 3, legColor, true, true)
  // Skirt sits over the hips after the legs.
  if (v.bottomStyle === 'skirt') {
    ctx.fillStyle = v.bottom
    ctx.beginPath()
    ctx.moveTo(cx - torsoW * 0.62, hipY - 6)
    ctx.lineTo(cx + torsoW * 0.62, hipY - 6)
    ctx.lineTo(cx + torsoW * 0.85, hipY + H * 0.1)
    ctx.lineTo(cx - torsoW * 0.85, hipY + H * 0.1)
    ctx.closePath()
    ctx.fill()
  }
  // Torso with a touch of forward lean (more if hunched).
  ctx.save()
  ctx.translate(cx, hipY)
  ctx.rotate(0.05 + hunch * 0.12)
  ctx.fillStyle = v.top
  rr(ctx, -torsoW / 2, -(hipY - shoulderY), torsoW, coatHem - shoulderY, 7)
  ctx.restore()
  // Near arm over the torso.
  limb(armNear, 8 * v.build, hipY - shoulderY - 8, v.topShade, false, false)
  // Hand luggage swings with the near arm.
  if (v.bag === 'briefcase' || v.bag === 'tote') {
    const armLen = hipY - shoulderY - 8
    const hx = cx + Math.sin(armNear) * armLen
    const hy = shoulderY + 4 + Math.cos(armNear) * armLen
    ctx.fillStyle = v.bagColor!
    rr(ctx, hx - 8, hy + 2, v.bag === 'briefcase' ? 17 : 15, v.bag === 'briefcase' ? 13 : 16, 2.5)
  } else if (v.bag === 'satchel') {
    ctx.fillStyle = v.bagColor!
    rr(ctx, cx - torsoW / 2 - 4, hipY - 12, 14, 12, 2.5)
  }
  // The umbrella swings with the near arm, tip trailing.
  if (wet && v.umbrella) {
    const armLen2 = hipY - shoulderY - 8
    drawFurledUmbrella(ctx, v.umbrella, cx + Math.sin(armNear) * armLen2 + 5, shoulderY + 4 + Math.cos(armNear) * armLen2)
  }
  drawHead(ctx, v, cx + 2 + hunch * 4, headCy + hunch * 3, headR, 1)
}

/**
 * The station attendant. Not another commuter with a different shirt: the
 * poses ARE the character — pointing at the arriving train and bowing are the
 * two gestures you actually see on a Japanese platform, so they get their own
 * frames instead of an idle cycle.
 */
function drawAttendant(ctx: CanvasRenderingContext2D, pose: number) {
  const feet = 182
  const H = 156
  const headR = 15.5
  const NAVY = '#1e2a44'
  const NAVY_DARK = '#172034'
  const SKIN = '#f0c8a8'
  const GLOVE = '#f7f7f2'
  const bow = pose === POSE_BOW
  const lean = bow ? 0.62 : 0
  const cx = 64
  const hipY = feet - H * 0.4
  const shoulderY = feet - H + headR * 2 + 4
  const torsoW = 26

  // Legs first — they stay put through every pose.
  ctx.fillStyle = NAVY
  rr(ctx, cx - 12, hipY, 11, feet - hipY - 4, 4)
  rr(ctx, cx + 1, hipY, 11, feet - hipY - 4, 4)
  ctx.fillStyle = SHOE
  rr(ctx, cx - 13, feet - 7, 13, 7, 3)
  rr(ctx, cx, feet - 7, 13, 7, 3)

  // Torso pivots at the hip so a bow is a real bow, not a slouch.
  ctx.save()
  ctx.translate(cx, hipY)
  ctx.rotate(lean)
  ctx.fillStyle = NAVY
  rr(ctx, -torsoW / 2, -(hipY - shoulderY), torsoW, hipY - shoulderY + 4, 6)
  // White shirt and dark tie in the jacket's gap.
  ctx.fillStyle = '#eef0ee'
  rr(ctx, -5, -(hipY - shoulderY) + 4, 10, 22, 2)
  ctx.fillStyle = '#8d2f2f'
  rr(ctx, -2, -(hipY - shoulderY) + 8, 4, 16, 1.5)

  const armLen = hipY - shoulderY - 6
  const arm = (angle: number) => {
    ctx.save()
    ctx.translate(0, -(hipY - shoulderY) + 6)
    ctx.rotate(angle)
    ctx.fillStyle = NAVY_DARK
    rr(ctx, -3.5, 0, 7, armLen, 3)
    // White glove — the thing that makes the gesture read at a distance.
    ctx.fillStyle = GLOVE
    ctx.beginPath()
    ctx.arc(0, armLen + 3, 4.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  if (pose === POSE_POINT) {
    arm(-Math.PI / 2 + 0.12) // straight ahead, the classic point-and-call
    arm(0.12)
  } else if (pose === POSE_POINT_UP) {
    arm(-Math.PI / 2 - 0.55) // raised, signalling the all-clear
    arm(0.1)
  } else if (bow) {
    arm(-0.12)
    arm(0.12)
  } else {
    arm(0.06)
    arm(-0.06)
  }
  ctx.restore()

  // Head rides the lean, cap on top.
  const hx = cx + Math.sin(lean) * (hipY - (feet - H + headR))
  const hy = feet - H + headR + (1 - Math.cos(lean)) * (hipY - (feet - H + headR))
  ctx.fillStyle = SKIN
  ctx.beginPath()
  ctx.arc(hx, hy, headR, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = NAVY
  ctx.beginPath()
  ctx.arc(hx, hy - 2, headR + 1.5, Math.PI * 1.02, Math.PI * 1.98)
  ctx.closePath()
  ctx.fill()
  rr(ctx, hx - headR - 3, hy - headR * 0.55, (headR + 3) * 2, 4.5, 2)
  // Cap badge.
  ctx.fillStyle = '#d8b34a'
  rr(ctx, hx - 2.5, hy - headR * 0.95, 5, 3.5, 1)
}

function makePassengerSheet(wet = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = SPRITE_COLS * CELL_W
  canvas.height = SPRITE_ROWS * CELL_H
  const ctx = canvas.getContext('2d')!
  for (let row = 0; row < SPRITE_ROWS; row++) {
    for (let col = 0; col < SPRITE_COLS; col++) {
      ctx.save()
      ctx.translate(col * CELL_W, row * CELL_H)
      if (row === STAFF_ROW) {
        drawAttendant(ctx, col)
      } else {
        const v = VARIANTS[row]
        if (col < 2) drawFront(ctx, v, col, wet)
        else drawSide(ctx, v, col - 2, wet)
      }
      ctx.restore()
    }
  }
  if (import.meta.env.DEV) (window as any).__passengerSheet = canvas
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// ————— The instanced billboard system —————

export class Passengers {
  private camera: THREE.Camera
  private uniforms = {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uMap: { value: null as THREE.Texture | null },
  }
  private shadowUniforms = { uNight: { value: 0 } }
  private aOffset!: THREE.InstancedBufferAttribute
  private aData!: THREE.InstancedBufferAttribute
  private aMisc!: THREE.InstancedBufferAttribute
  private aModel!: THREE.InstancedBufferAttribute
  private hybrid!: HybridPassengers021
  private slots: WaitingSlot[] = []
  private staffPose: number[] = []
  private staffTimer: number[] = []
  private staffSituation: number[] = new Array(N).fill(-1)
  /** Visible queue length per station, driven by PassengerFlow's real counts. */
  private visibleWaiting = new Int32Array(N)
  private frames: StationFrame[] = []
  private walkers: Walker[] = []
  private boardingStation = -1
  /** Guards releaseQueue against being run twice for the same stop. */
  private queueReleased = -1
  private lastBoardedStation = -1
  private densityAccum = DENSITY_REFRESH_SECONDS // primed: first update() paints the crowd
  private readonly tmpV3 = new THREE.Vector3()
  private readonly tmpDir = new THREE.Vector3()
  /** Dry sheet built at startup; the rainy-day one (furled umbrellas) bakes lazily on the first wet frame. */
  private sheetDry: THREE.CanvasTexture
  private sheetWet: THREE.CanvasTexture | null = null
  private wet = false

  constructor(scene: THREE.Scene, track: Track, camera: THREE.Camera) {
    this.camera = camera
    this.sheetDry = makePassengerSheet()
    this.uniforms.uMap.value = this.sheetDry

    for (let s = 0; s < N; s++) {
      const marker = track.markerFor(s)
      const point = track.pointAt(marker.tFraction)
      const tangent = track.tangentAt(marker.tFraction)
      const obj = new THREE.Object3D()
      obj.position.copy(point)
      obj.lookAt(point.clone().add(tangent))
      obj.updateMatrixWorld(true)
      const xAxis = new THREE.Vector3().setFromMatrixColumn(obj.matrixWorld, 0)
      const zAxis = new THREE.Vector3().setFromMatrixColumn(obj.matrixWorld, 2)
      this.frames.push({
        matrix: obj.matrixWorld.clone(),
        origin: point.clone(),
        xAxis,
        zAxis,
        side: STATIONS[s].doorSide === 'left' ? 1 : -1,
      })
    }

    const offsets = new Float32Array(TOTAL * 3)
    const data = new Float32Array(TOTAL * 3)
    const misc = new Float32Array(TOTAL * 2)
    this.aOffset = new THREE.InstancedBufferAttribute(offsets, 3)
    this.aData = new THREE.InstancedBufferAttribute(data, 3)
    this.aMisc = new THREE.InstancedBufferAttribute(misc, 2)

    // Queue slots, door-major: filling them in order grows every door's pair
    // of files at the same rate, which is what a platform actually looks like.
    for (let s = 0; s < N; s++) {
      const side = this.frames[s].side
      for (let p = 0; p < WAITING_PER_STATION; p++) {
        const i = s * WAITING_PER_STATION + p
        const doorIdx = p % DOOR_ZS.length
        const file = QUEUE_FILES[Math.floor(p / DOOR_ZS.length) % QUEUE_FILES.length]
        const row = Math.floor(p / (DOOR_ZS.length * QUEUE_FILES.length)) % QUEUE_ROWS
        const local = new THREE.Vector2(
          side * (PLATFORM_GEOM.inner + QUEUE_X0 + row * QUEUE_X_STEP + (Math.random() - 0.5) * 0.16),
          DOOR_ZS[doorIdx] + file * QUEUE_Z_SPREAD + (Math.random() - 0.5) * 0.3,
        )
        this.slots.push({ station: s, local, roll: p / WAITING_PER_STATION, state: 'ambient', doorIdx, order: row * 2 + (file > 0 ? 1 : 0) })
        data[i * 3 + 0] = Math.floor(Math.random() * STAFF_ROW)
        data[i * 3 + 1] = MODE_HIDDEN
        data[i * 3 + 2] = Math.random() * 8
        misc[i * 2 + 0] = 0.92 + Math.random() * 0.14
        misc[i * 2 + 1] = 1
        this.writeLocal(i, s, local.x, local.y)
      }
    }

    // One attendant per platform, standing where the cab will come to rest —
    // close enough that the driver sees the bow through the side window.
    for (let s = 0; s < N; s++) {
      const i = STAFF_BASE + s
      const side = this.frames[s].side
      data[i * 3 + 0] = STAFF_ROW
      data[i * 3 + 1] = MODE_POSE
      data[i * 3 + 2] = POSE_STAND
      misc[i * 2 + 0] = 1.0
      misc[i * 2 + 1] = 1
      this.writeLocal(i, s, side * (PLATFORM_GEOM.inner + 1.7), STAFF_Z)
      this.staffPose.push(POSE_STAND)
      this.staffTimer.push(0)
    }
    for (let a = 0; a < ALIGHT_POOL; a++) {
      const i = N * WAITING_PER_STATION + a
      data[i * 3 + 1] = MODE_HIDDEN
      misc[i * 2 + 0] = 0.94 + Math.random() * 0.1
      misc[i * 2 + 1] = 1
    }

    this.hybrid = new HybridPassengers021(
      scene,
      camera,
      TOTAL,
      WAITING_PER_STATION,
      STAFF_BASE,
      this.aOffset,
      this.aData,
      this.aMisc,
      this.frames,
    )
    this.aModel = new THREE.InstancedBufferAttribute(this.hybrid.representation, 1)

    const makeInstancedGeo = (base: THREE.BufferGeometry) => {
      const geo = new THREE.InstancedBufferGeometry()
      geo.index = base.index
      geo.attributes.position = base.attributes.position
      geo.attributes.uv = base.attributes.uv
      geo.setAttribute('aOffset', this.aOffset)
      geo.setAttribute('aData', this.aData)
      geo.setAttribute('aMisc', this.aMisc)
      geo.setAttribute('aModel', this.aModel)
      geo.instanceCount = TOTAL
      return geo
    }

    const plane = new THREE.PlaneGeometry(SPRITE_W, SPRITE_H)
    plane.translate(0, SPRITE_H / 2, 0) // pivot at the feet
    const spriteMat = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec3 aData; // row, mode, phase
        attribute vec2 aMisc; // scale, flip
        attribute float aModel; // 1 = represented by the close-range 3D kit
        uniform float uTime;
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          float mode = aData.y;
          // Mode 2 is "not here"; mode 3 (posed) is visible like the rest.
          float scale = aMisc.x * (abs(mode - 2.0) < 0.5 ? 0.0 : 1.0) * (1.0 - aModel);
          // Idle shuffles between 2 frames; walking runs the 4-frame cycle.
          // Idle shuffles 2 frames, walking runs the 4-frame cycle, and a
          // posed sprite (the attendant) holds whatever frame aData.z names.
          float frame = mode > 2.5
            ? aData.z
            : (mode < 0.5
              ? mod(floor(uTime * 1.7 + aData.z), 2.0)
              : 2.0 + mod(floor(uTime * 7.5 + aData.z * 7.0), 4.0));
          float u = uv.x;
          if (mode >= 0.5 && aMisc.y < 0.0) u = 1.0 - u;
          vUv = vec2((frame + u) / ${SPRITE_COLS}.0, (${SPRITE_ROWS - 1}.0 - aData.x + uv.y) / ${SPRITE_ROWS}.0);
          // Cylindrical billboard: face the camera plane around Y only, so
          // people stay planted upright on the platform. Built from
          // viewMatrix (its rotation rows are the camera axes) rather than
          // cameraPosition, which is not refreshed reliably for custom
          // ShaderMaterials — sprites built on it simply never appeared.
          vec3 camRight = vec3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
          vec2 right = normalize(vec2(camRight.x, camRight.z));
          vec3 world = vec3(
            aOffset.x + right.x * position.x * scale,
            aOffset.y + position.y * scale,
            aOffset.z + right.y * position.x * scale
          );
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uNight;
        varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() {
          vec4 c = texture2D(uMap, vUv);
          if (c.a < 0.55) discard;
          // Hand-dimmed at night (unlit material) — platform lamps keep them readable.
          gl_FragColor = vec4(c.rgb * mix(1.0, 0.42, uNight), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
      fog: true,
    })
    const sprites = new THREE.Mesh(makeInstancedGeo(plane), spriteMat)
    sprites.frustumCulled = false // instances span the whole loop
    // Dynamic: passengers are placed by live flow, not by the world seed —
    // tagged so the determinism fingerprint reports them apart (see worldHash).
    sprites.userData.dynamic = true
    scene.add(sprites)

    // Contact-shadow blobs: billboards cast no real shadows, and without a
    // dark anchor at the feet everyone looks pasted on. Same trick as the
    // sleeper AO pads.
    const shadowPlane = new THREE.PlaneGeometry(0.78, 0.42)
    shadowPlane.rotateX(-Math.PI / 2)
    const shadowMat = new THREE.ShaderMaterial({
      uniforms: { ...this.shadowUniforms, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec3 aData;
        attribute vec2 aMisc;
        varying vec2 vUv;
        varying float vFogDepth;
        void main() {
          float scale = aMisc.x * (abs(aData.y - 2.0) < 0.5 ? 0.0 : 1.0);
          vUv = uv;
          vec3 world = aOffset + position * scale + vec3(0.0, 0.015, 0.0);
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          vFogDepth = -mvPosition.z;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        uniform float fogNear;
        uniform float fogFar;
        varying vec2 vUv;
        varying float vFogDepth;
        void main() {
          float d = length((vUv - 0.5) * 2.0);
          float a = smoothstep(1.0, 0.2, d) * 0.34;
          // Softer at night (no hard sun), and gone into the fog — a fogged
          // dark blob would read as a stain on the platform.
          a *= mix(1.0, 0.45, uNight);
          a *= 1.0 - smoothstep(fogNear, fogFar * 0.5, vFogDepth);
          gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      // Not for fog COLOR (the blob fades out instead) but so the renderer
      // keeps this material's fogNear/fogFar uniforms fresh each frame.
      fog: true,
    })
    const shadows = new THREE.Mesh(makeInstancedGeo(shadowPlane), shadowMat)
    shadows.frustumCulled = false
    shadows.userData.dynamic = true
    scene.add(shadows)

    this.refreshAmbient()
  }

  get hybridReport(): HybridPassengerReport {
    return this.hybrid.report
  }

  private updateHybrid(dt: number) {
    this.hybrid.update(dt)
    if (this.hybrid.consumeRepresentationDirty()) this.aModel.needsUpdate = true
  }

  /**
   * Weather wardrobe: on wet days most commuters carry a furled umbrella.
   * One texture swap for every platform on the loop — the wet sheet is baked
   * once on first use and cached, so flipping weather costs nothing after.
   */
  setWet(wet: boolean) {
    if (wet === this.wet) return
    this.wet = wet
    if (wet && !this.sheetWet) this.sheetWet = makePassengerSheet(true)
    this.uniforms.uMap.value = wet ? this.sheetWet! : this.sheetDry
  }

  /** Bakes the wet sheet ahead of time (idle callback after start), so a mid-drive weather front never pays for the canvas bake + texture upload. */
  prebakeWet() {
    if (!this.sheetWet) this.sheetWet = makePassengerSheet(true)
  }

  /** Writes a slot's local-platform position into the world-space offset attribute. */
  private writeLocal(index: number, station: number, lx: number, lz: number) {
    this.tmpV3.set(lx, PLATFORM_GEOM.top + 0.02, lz).applyMatrix4(this.frames[station].matrix)
    this.aOffset.setXYZ(index, this.tmpV3.x, this.tmpV3.y, this.tmpV3.z)
    this.aOffset.needsUpdate = true
  }

  private setMode(index: number, mode: number) {
    this.aData.setY(index, mode)
    this.aData.needsUpdate = true
  }

  /**
   * How long each queue looks. `counts` are PassengerFlow's real numbers, so a
   * hub in the rush shows every door with a full pair of files while a quiet
   * platform at midnight shows one person — and skipping a station visibly
   * lengthens the queue you will find next lap.
   */
  setWaitingCounts(counts: Float64Array) {
    for (let s = 0; s < N; s++) {
      // ~8 real people per sprite: the platform reads as busy long before the
      // 420-person cap, and the queue still visibly deepens all the way up.
      this.visibleWaiting[s] = Math.min(WAITING_PER_STATION, Math.round(counts[s] / 8))
    }
    this.refreshAmbient()
  }

  /** Applies the visible-queue length to the slots. */
  private refreshAmbient() {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]
      if (slot.state !== 'ambient' || slot.station === this.boardingStation) continue
      const rank = i - slot.station * WAITING_PER_STATION
      this.setMode(i, rank < this.visibleWaiting[slot.station] ? MODE_IDLE : MODE_HIDDEN)
    }
  }

  /**
   * The doors just opened at `station`: everyone visible there walks to the
   * nearest (implied) train door and boards within `seconds`; a few riders
   * step off first and drift toward the back of the platform.
   */
  /**
   * Doors open: the riders getting off step out, straight down the middle of
   * the doorway. The two waiting files stand aside precisely so this lane
   * stays clear — nobody boards until releaseQueue() says the door is free.
   */
  beginAlighting(station: number, alighting = 4) {
    this.endBoarding()
    this.boardingStation = station
    const frame = this.frames[station]
    const doorX = frame.side * (PLATFORM_GEOM.inner + 0.55)
    const shown = Math.min(ALIGHT_POOL, Math.max(0, alighting))
    const doorPick = [...DOOR_ZS].sort(() => Math.random() - 0.5)
    for (let a = 0; a < shown; a++) {
      const i = N * WAITING_PER_STATION + a
      const doorZ = doorPick[a % doorPick.length]
      const local = new THREE.Vector2(doorX, doorZ)
      // Straight out of the door first (the gap between the files), and only
      // then off along the platform — never diagonally through the queue.
      const clear = new THREE.Vector2(frame.side * (PLATFORM_GEOM.inner + QUEUE_X0 + QUEUE_X_STEP * QUEUE_ROWS + 0.6), doorZ)
      const exit = new THREE.Vector2(
        frame.side * (PLATFORM_GEOM.outer - 1.3 - Math.random() * 2),
        THREE.MathUtils.clamp(doorZ + (Math.random() - 0.5) * 16, -PLATFORM_GEOM.len / 2 + 3, PLATFORM_GEOM.len / 2 - 3),
      )
      this.aData.setX(i, Math.floor(Math.random() * STAFF_ROW))
      this.writeLocal(i, station, local.x, local.y)
      this.walkers.push({
        index: i,
        station,
        local,
        waypoints: [clear, exit],
        wp: 0,
        delay: 0.25 + a * 0.16 + Math.random() * 0.3,
        speed: WALK_SPEED * (0.95 + Math.random() * 0.3),
      })
    }

    this.aData.needsUpdate = true
  }

  /**
   * The doorway is clear: the files may step in, head of the queue first and
   * one at a time per door. Called by the transfer once the alighters are out,
   * so the visible order always matches the counters.
   */
  releaseQueue(station: number, seconds: number) {
    if (this.queueReleased === station) return
    this.queueReleased = station
    const frame = this.frames[station]
    const doorX = frame.side * (PLATFORM_GEOM.inner + 0.55)
    const clearAt = 0.15
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]
      if (slot.station !== station || slot.state !== 'ambient') continue
      if (this.aData.getY(i) !== MODE_IDLE) continue // not shown → nobody there
      slot.state = 'boarding'
      const doorZ = DOOR_ZS[slot.doorIdx]
      const speed = WALK_SPEED * (0.92 + Math.random() * 0.2)
      // Step to the doorway's centre line, then walk in. Two waypoints, so
      // the file visibly turns the corner instead of drifting diagonally.
      const delay = clearAt + slot.order * 0.62 + Math.random() * 0.12
      const late = delay + 1.4 > seconds
      this.walkers.push({
        index: i,
        station,
        local: slot.local,
        waypoints: [new THREE.Vector2(slot.local.x, doorZ), new THREE.Vector2(doorX, doorZ)],
        wp: 0,
        delay: Math.min(delay, Math.max(0.2, seconds - 1.2)),
        // Anyone who would otherwise miss the doors hurries — the shuffle-run
        // of someone who can see the train they are about to lose.
        speed: late ? speed * 1.45 : speed,
        slot,
      })
    }
    this.aData.needsUpdate = true
  }

  /**
   * Doors closing. Anyone who reached the doorway is aboard; anyone still in
   * the queue goes back to standing there, because they did not make it and
   * the counters have not counted them.
   */
  endBoarding() {
    for (const w of this.walkers) {
      const reachedDoor = w.wp >= w.waypoints.length - 1
      if (w.slot && reachedDoor) {
        this.setMode(w.index, MODE_HIDDEN)
        w.slot.state = 'boarded'
        this.lastBoardedStation = w.station
      } else if (w.slot) {
        // Back to the platform: still waiting, still counted as waiting.
        w.slot.state = 'ambient'
        w.local.copy(w.slot.local)
        this.setMode(w.index, MODE_IDLE)
      } else {
        this.setMode(w.index, MODE_HIDDEN)
      }
    }
    this.walkers.length = 0
    this.boardingStation = -1
    this.queueReleased = -1
  }

  /**
   * The attendant's shift, in three gestures. Pointing at the incoming train
   * (指差喚呼 — point and call) is a real safety procedure, not decoration:
   * the arm goes out as the train appears, the bow greets the driver at a
   * stand, and the raised arm signals the platform clear on departure.
   */
  private updateStaff(dt: number, ctx: PassengerContext) {
    const set = (s: number, situation: number, pose: number) => {
      const i = STAFF_BASE + s
      if (this.staffSituation[s] !== situation) {
        this.staffSituation[s] = situation
        this.staffTimer[s] = 0
      } else {
        this.staffTimer[s] += dt
      }
      const held = this.staffTimer[s]
      // Poses that are gestures, not stances, decay back to standing.
      let frame = pose
      if (pose === POSE_BOW && held > 2.4) frame = POSE_STAND
      if (pose === POSE_POINT_UP && held > 2.8) frame = held < 5.0 ? POSE_BOW : POSE_STAND
      if (this.staffPose[s] !== frame) {
        this.staffPose[s] = frame
        this.aData.setZ(i, frame)
        this.aData.needsUpdate = true
      }
    }

    const t = ctx.targetStation
    if (ctx.doorsOpen > 0.05 || ctx.stopped) set(t, 2, POSE_BOW)
    else if (ctx.distanceToTarget < 165) set(t, 1, POSE_POINT)
    else set(t, 0, POSE_STAND)

    // The platform just left gets the departure half of the ritual.
    const p = prevStationIndex(t)
    if (p !== t) {
      if (ctx.speed01 > 0.02 && ctx.distanceBehind < 150) set(p, 3, POSE_POINT_UP)
      else set(p, 0, POSE_STAND)
    }
  }

  update(dt: number, nightFactor: number, ctx: PassengerContext) {
    const targetStationIndex = ctx.targetStation
    this.updateStaff(dt, ctx)
    this.uniforms.uTime.value += dt
    this.uniforms.uNight.value = nightFactor
    this.shadowUniforms.uNight.value = nightFactor

    this.densityAccum += dt
    if (this.densityAccum >= DENSITY_REFRESH_SECONDS) {
      this.densityAccum = 0
      this.refreshAmbient()
      // Boarded slots stay empty while their platform is still in sight;
      // once the train is past the NEXT station they quietly restock.
      if (this.lastBoardedStation >= 0 && this.lastBoardedStation !== targetStationIndex && this.lastBoardedStation !== prevStationIndex(targetStationIndex)) {
        for (let i = 0; i < this.slots.length; i++) {
          const slot = this.slots[i]
          if (slot.station !== this.lastBoardedStation || slot.state !== 'boarded') continue
          slot.state = 'ambient'
          slot.roll = Math.random()
        }
        this.lastBoardedStation = -1
      }
    }

    if (this.walkers.length === 0) {
      this.updateHybrid(dt)
      return
    }

    // Camera right (XZ), for choosing which way profile sprites face.
    this.tmpDir.setFromMatrixColumn((this.camera as THREE.PerspectiveCamera).matrixWorld, 0)
    const camRX = this.tmpDir.x
    const camRZ = this.tmpDir.z

    const frame = this.frames[this.boardingStation >= 0 ? this.boardingStation : this.walkers[0].station]
    for (let wi = this.walkers.length - 1; wi >= 0; wi--) {
      const w = this.walkers[wi]
      if (w.delay > 0) {
        w.delay -= dt
        continue
      }
      const target = w.waypoints[w.wp]
      const dx = target.x - w.local.x
      const dz = target.y - w.local.y
      const dist = Math.hypot(dx, dz)
      const step = w.speed * dt
      if (dist <= step) {
        w.local.copy(target)
        w.wp++
        if (w.wp >= w.waypoints.length) {
          this.setMode(w.index, MODE_HIDDEN)
          if (w.slot) {
            w.slot.state = 'boarded'
            this.lastBoardedStation = w.station
          }
          this.walkers.splice(wi, 1)
          continue
        }
      } else {
        w.local.x += (dx / dist) * step
        w.local.y += (dz / dist) * step
        this.setMode(w.index, MODE_WALK)
        // World-space walk direction → mirror the profile when heading
        // against camera-right. Hysteresis: only flip on a clear reading.
        const wdx = frame.xAxis.x * dx + frame.zAxis.x * dz
        const wdz = frame.xAxis.z * dx + frame.zAxis.z * dz
        const dot = (camRX * wdx + camRZ * wdz) / (dist || 1)
        if (Math.abs(dot) > 0.25) {
          const flip = dot >= 0 ? 1 : -1
          if (this.aMisc.getY(w.index) !== flip) {
            this.aMisc.setY(w.index, flip)
            this.aMisc.needsUpdate = true
          }
        }
      }
      this.writeLocal(w.index, w.station, w.local.x, w.local.y)
    }
    this.updateHybrid(dt)
  }
}
