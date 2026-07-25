import * as THREE from 'three'
import { makeSunTexture, makeMoonTexture } from './signage'

// One full 24h cycle every REAL_SECONDS_PER_DAY seconds of play.
const REAL_SECONDS_PER_DAY = 8 * 60

interface Keyframe {
  hour: number
  skyTop: THREE.Color
  /** Mid-altitude band — gives the gradient a third stop so dawn/dusk get their color banding. */
  skyMid: THREE.Color
  skyBottom: THREE.Color
  sunColor: THREE.Color
  sunIntensity: number
  ambientIntensity: number
  fogColor: THREE.Color
  fogNear: number
  fogFar: number
  label: string
}

const C = (hex: number) => new THREE.Color(hex)
/** Sheet-lightning white — very slightly blue, the way a discharge reads through cloud. */
const FLASH_COLOR = new THREE.Color(0xdfe8ff)
const SUN_DIR_SCRATCH = new THREE.Vector3()
const MOON_DIR_SCRATCH = new THREE.Vector3()

const KEYFRAMES: Keyframe[] = [
  { hour: 0, skyTop: C(0x03040d), skyMid: C(0x070a18), skyBottom: C(0x0c1226), sunColor: C(0x33447a), sunIntensity: 0.05, ambientIntensity: 0.16, fogColor: C(0x05060f), fogNear: 70, fogFar: 1500, label: 'Madrugada' },
  { hour: 3.5, skyTop: C(0x050714), skyMid: C(0x0b1024), skyBottom: C(0x121a35), sunColor: C(0x33447a), sunIntensity: 0.05, ambientIntensity: 0.17, fogColor: C(0x070a18), fogNear: 70, fogFar: 1500, label: 'Madrugada' },
  { hour: 5, skyTop: C(0x142042), skyMid: C(0x2b2a58), skyBottom: C(0x3a3560), sunColor: C(0x8a7bb8), sunIntensity: 0.25, ambientIntensity: 0.28, fogColor: C(0x241f3d), fogNear: 90, fogFar: 1450, label: 'Alba' },
  { hour: 6, skyTop: C(0x2c3a6b), skyMid: C(0x8a5e78), skyBottom: C(0xe08a5c), sunColor: C(0xffab6b), sunIntensity: 0.9, ambientIntensity: 0.42, fogColor: C(0xe08a5c), fogNear: 110, fogFar: 1400, label: 'Amanecer' },
  { hour: 7.5, skyTop: C(0x5f8ad0), skyMid: C(0xa9b6da), skyBottom: C(0xffd9a0), sunColor: C(0xffdcb0), sunIntensity: 1.4, ambientIntensity: 0.55, fogColor: C(0xe8d0b8), fogNear: 150, fogFar: 1300, label: 'Mañana' },
  { hour: 10, skyTop: C(0x3f7fe0), skyMid: C(0x7fb2ef), skyBottom: C(0xbfe3ff), sunColor: C(0xfff3da), sunIntensity: 1.7, ambientIntensity: 0.65, fogColor: C(0xcfe8ff), fogNear: 200, fogFar: 1500, label: 'Media mañana' },
  { hour: 13, skyTop: C(0x2f74e6), skyMid: C(0x78b0f4), skyBottom: C(0xcdeaff), sunColor: C(0xffffff), sunIntensity: 1.85, ambientIntensity: 0.7, fogColor: C(0xd8edff), fogNear: 220, fogFar: 1600, label: 'Mediodía' },
  { hour: 16, skyTop: C(0x3d78d8), skyMid: C(0x90b5e8), skyBottom: C(0xdcecf7), sunColor: C(0xfff0d8), sunIntensity: 1.6, ambientIntensity: 0.6, fogColor: C(0xdde8f2), fogNear: 180, fogFar: 1400, label: 'Tarde' },
  { hour: 17.5, skyTop: C(0x3a5aa8), skyMid: C(0xa07890), skyBottom: C(0xf0955c), sunColor: C(0xffa860), sunIntensity: 1.2, ambientIntensity: 0.5, fogColor: C(0xf0955c), fogNear: 130, fogFar: 1200, label: 'Atardecer' },
  { hour: 18.5, skyTop: C(0x2a2f5c), skyMid: C(0x8f4260), skyBottom: C(0xe0603f), sunColor: C(0xff7a4a), sunIntensity: 0.7, ambientIntensity: 0.38, fogColor: C(0x8a3f45), fogNear: 90, fogFar: 1000, label: 'Crepúsculo' },
  { hour: 19.5, skyTop: C(0x141235), skyMid: C(0x35264e), skyBottom: C(0x5a3a5e), sunColor: C(0x9a5aa0), sunIntensity: 0.3, ambientIntensity: 0.28, fogColor: C(0x281f3d), fogNear: 80, fogFar: 1450, label: 'Noche' },
  { hour: 21, skyTop: C(0x05071a), skyMid: C(0x0d112a), skyBottom: C(0x161c3a), sunColor: C(0x33447a), sunIntensity: 0.08, ambientIntensity: 0.2, fogColor: C(0x0a0d1e), fogNear: 70, fogFar: 1500, label: 'Noche cerrada' },
  { hour: 24, skyTop: C(0x03040d), skyMid: C(0x070a18), skyBottom: C(0x0c1226), sunColor: C(0x33447a), sunIntensity: 0.05, ambientIntensity: 0.16, fogColor: C(0x05060f), fogNear: 70, fogFar: 1500, label: 'Madrugada' },
]

// Written into per call rather than allocated: lerpKeyframes runs every
// frame, and the fresh object + five Color.clone()s it used to make were
// the render loop's biggest steady garbage source.
const KF_SCRATCH: Keyframe = {
  hour: 0,
  skyTop: new THREE.Color(),
  skyMid: new THREE.Color(),
  skyBottom: new THREE.Color(),
  sunColor: new THREE.Color(),
  sunIntensity: 1,
  ambientIntensity: 0.5,
  fogColor: new THREE.Color(),
  fogNear: 200,
  fogFar: 1500,
  label: '',
}

function lerpKeyframes(hour: number): Keyframe {
  let a = KEYFRAMES[0]
  let b = KEYFRAMES[KEYFRAMES.length - 1]
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (hour >= KEYFRAMES[i].hour && hour <= KEYFRAMES[i + 1].hour) {
      a = KEYFRAMES[i]
      b = KEYFRAMES[i + 1]
      break
    }
  }
  const span = b.hour - a.hour || 1
  const f = (hour - a.hour) / span
  const out = KF_SCRATCH
  out.hour = hour
  out.skyTop.copy(a.skyTop).lerp(b.skyTop, f)
  out.skyMid.copy(a.skyMid).lerp(b.skyMid, f)
  out.skyBottom.copy(a.skyBottom).lerp(b.skyBottom, f)
  out.sunColor.copy(a.sunColor).lerp(b.sunColor, f)
  out.sunIntensity = THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, f)
  out.ambientIntensity = THREE.MathUtils.lerp(a.ambientIntensity, b.ambientIntensity, f)
  out.fogColor.copy(a.fogColor).lerp(b.fogColor, f)
  out.fogNear = THREE.MathUtils.lerp(a.fogNear, b.fogNear, f)
  out.fogFar = THREE.MathUtils.lerp(a.fogFar, b.fogFar, f)
  out.label = f < 0.5 ? a.label : b.label
  return out
}

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const SKY_FRAGMENT = /* glsl */ `
uniform vec3 topColor;
uniform vec3 midColor;
uniform vec3 bottomColor;
uniform vec3 sunDir;
uniform vec3 glowColor;
uniform float glowStrength;
varying vec3 vWorldPosition;
void main() {
  // Sky dome follows the camera, so the view direction is just the vector
  // from the camera to this fragment.
  vec3 dir = normalize(vWorldPosition - cameraPosition);
  float h = dir.y;
  // Three-stop gradient: horizon band -> mid band -> zenith.
  vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.22, h));
  col = mix(col, topColor, smoothstep(0.18, 0.62, h));
  // Warm halo around the sun, hugging the horizon — the "HDR sky" feel.
  float sunAmt = pow(max(dot(dir, sunDir), 0.0), 9.0);
  float horizonBoost = 1.0 - smoothstep(0.0, 0.38, abs(h));
  col += glowColor * sunAmt * glowStrength * (0.3 + 0.7 * horizonBoost);
  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * Blends a sky/fog color toward overcast gray, in place. `grayLevel` is the
 * luminance the overcast should sit at — a real closed sky is a FLAT BRIGHT
 * gray by day (deep blue skies have low luma, so collapsing toward their own
 * luminance wrongly turned noon into dusk) and near-black at night.
 */
function overcastTint(c: THREE.Color, o: number, grayLevel: number) {
  c.r = THREE.MathUtils.lerp(c.r, grayLevel * 0.96, 0.8 * o)
  c.g = THREE.MathUtils.lerp(c.g, grayLevel * 0.98, 0.8 * o)
  c.b = THREE.MathUtils.lerp(c.b, grayLevel * 1.0, 0.8 * o)
}

export class DayNightCycle {
  timeOfDay = 7.5 // start at a pleasant morning
  /** Where the weather wants the sky: 0 = clear, 1 = fully overcast. The cycle eases toward it. */
  overcastGoal = 0
  /** Current eased overcast amount — Scenery reads this to darken the clouds. */
  overcast = 0
  /** Storms throw lightning on their own schedule while this is set. */
  stormy = false
  /** 0..1 sky flash for the current frame — sheet lightning, not a bolt sprite: the whole overcast lid lights up, which is what a storm looks like from inside a train. */
  flash = 0
  /** Fired at each strike with (secondsUntilThunder, strength) — sound travels, so a distant flash gets its clap seconds later. */
  onLightning: ((delay: number, strength: number) => void) | null = null
  private strikeTimer = 6
  /** Second (and third) flicker of the same strike — real lightning almost never flashes once. */
  private reflashIn = -1
  private reflashAmount = 0
  readonly sunLight: THREE.DirectionalLight
  readonly moonLight: THREE.DirectionalLight
  readonly ambient: THREE.HemisphereLight
  readonly skyMesh: THREE.Mesh
  readonly sunSprite: THREE.Sprite
  readonly moonSprite: THREE.Sprite
  readonly stars: THREE.Points
  private starsMaterial: THREE.PointsMaterial
  private starsBright!: THREE.Points
  private starsBrightMaterial!: THREE.PointsMaterial
  private scene: THREE.Scene
  private sunDistance = 2000
  /** Keyframe blend for the current frame — computed once per update() so per-frame getters allocate nothing. */
  private currentKf: Keyframe = lerpKeyframes(7.5)
  paused = false

  constructor(scene: THREE.Scene) {
    this.scene = scene

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1)
    this.sunLight.castShadow = true
    this.sunLight.shadow.mapSize.set(1024, 1024)
    this.sunLight.shadow.camera.left = -300
    this.sunLight.shadow.camera.right = 300
    this.sunLight.shadow.camera.top = 300
    this.sunLight.shadow.camera.bottom = -300
    this.sunLight.shadow.camera.far = 3000
    this.sunLight.shadow.bias = -0.0015
    scene.add(this.sunLight)
    scene.add(this.sunLight.target)

    this.moonLight = new THREE.DirectionalLight(0x8fa0ff, 0)
    scene.add(this.moonLight)
    scene.add(this.moonLight.target)

    this.ambient = new THREE.HemisphereLight(0x88aaff, 0x201510, 0.5)
    scene.add(this.ambient)

    const skyGeo = new THREE.SphereGeometry(4000, 32, 24)
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x3f7fe0) },
        midColor: { value: new THREE.Color(0x7fb2ef) },
        bottomColor: { value: new THREE.Color(0xbfe3ff) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        glowColor: { value: new THREE.Color(0xfff3da) },
        glowStrength: { value: 0 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat)
    scene.add(this.skyMesh)

    this.sunSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeSunTexture(), color: 0xffffff, transparent: true, depthWrite: false, fog: false }),
    )
    this.sunSprite.scale.setScalar(260)
    scene.add(this.sunSprite)

    this.moonSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: makeMoonTexture(), color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
    )
    this.moonSprite.scale.setScalar(110)
    scene.add(this.moonSprite)

    // Two layers: a dense field of fine stars plus a sparse handful of
    // brighter ones — reads as a real night sky instead of oversized dots.
    const makeStarLayer = (count: number, size: number) => {
      const geo = new THREE.BufferGeometry()
      const positions = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        const r = 1800 + Math.random() * 1500
        const theta = Math.random() * Math.PI * 2
        const phi = Math.acos(THREE.MathUtils.lerp(0.05, 0.95, Math.random()))
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
        positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 100
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
      }
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const mat = new THREE.PointsMaterial({
        color: 0xffffff,
        // sizeAttenuation:false works in PHYSICAL pixels — scale by the same
        // DPR cap the renderer uses, or fine stars vanish on mobile screens.
        size: size * Math.min(window.devicePixelRatio, 2),
        sizeAttenuation: false,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: false,
      })
      return new THREE.Points(geo, mat)
    }
    this.stars = makeStarLayer(2600, 1.5)
    this.starsMaterial = this.stars.material as THREE.PointsMaterial
    this.starsBright = makeStarLayer(420, 2.4)
    this.starsBrightMaterial = this.starsBright.material as THREE.PointsMaterial
    scene.add(this.stars, this.starsBright)

    scene.fog = new THREE.Fog(0xcfe8ff, 200, 1500)
  }

  get nightFactor(): number {
    // 0 = broad daylight, 1 = full night. Derived from sun elevation for a
    // smooth, physically-plausible twilight band.
    const elevation = this.sunElevationDeg()
    return THREE.MathUtils.clamp(1 - (elevation + 6) / 16, 0, 1)
  }

  /** Current sky color at the horizon — lets scenery (Fuji, clouds) tint itself to sit naturally against the sky. Do not mutate. */
  get horizonColor(): THREE.Color {
    return this.currentKf.skyBottom
  }

  get phaseLabel(): string {
    return this.currentKf.label
  }

  private sunElevationDeg(): number {
    return Math.sin(((this.timeOfDay - 6) / 12) * Math.PI) * 90
  }

  /**
   * Lightning bookkeeping: decay the current flash, run the countdown to the
   * next strike, and fire the thunder callback with the delay its distance
   * implies. Strength doubles as distance — a weak flash is a far one, so it
   * gets a late, long rumble; a strong one cracks almost immediately.
   */
  private updateLightning(dt: number) {
    this.flash = Math.max(0, this.flash - dt * (5 + this.flash * 6))
    if (this.reflashIn > 0) {
      this.reflashIn -= dt
      if (this.reflashIn <= 0) {
        this.flash = Math.max(this.flash, this.reflashAmount)
        this.reflashIn = -1
      }
    }
    if (!this.stormy) {
      this.strikeTimer = 4 + Math.random() * 6
      return
    }
    this.strikeTimer -= dt
    if (this.strikeTimer > 0) return
    this.strikeTimer = 5 + Math.random() * 12
    const strength = 0.3 + Math.random() * 0.7
    this.flash = strength
    this.reflashIn = 0.09 + Math.random() * 0.13
    this.reflashAmount = strength * (0.45 + Math.random() * 0.4)
    this.onLightning?.(0.4 + (1 - strength) * 6, strength)
  }

  update(dt: number, focusPoint = new THREE.Vector3()) {
    if (!this.paused) {
      this.timeOfDay = (this.timeOfDay + (dt * 24) / REAL_SECONDS_PER_DAY) % 24
    }
    // Blend once per frame; getters (horizonColor, phaseLabel) serve from this cache.
    const kf = lerpKeyframes(this.timeOfDay)
    this.currentKf = kf

    // Weather sits on top of the hour: overcast eases in/out over a couple
    // of seconds and flattens light, sky and fog toward gray. kf is a fresh
    // per-frame blend, so mutating it here never corrupts the keyframes.
    this.overcast += (this.overcastGoal - this.overcast) * Math.min(1, dt * 0.9)
    const o = this.overcast
    if (o > 0.001) {
      // How bright the flat gray lid should be right now, from the sun's
      // unmodified strength: luminous pearl at noon, charcoal at night.
      const dayLevel = THREE.MathUtils.clamp(kf.sunIntensity / 1.85, 0, 1) * 0.72 + 0.05
      overcastTint(kf.skyTop, o, dayLevel * 0.82)
      overcastTint(kf.skyMid, o, dayLevel * 0.94)
      overcastTint(kf.skyBottom, o, dayLevel)
      overcastTint(kf.fogColor, o, dayLevel * 0.96)
      overcastTint(kf.sunColor, o * 0.7, dayLevel)
      kf.sunIntensity *= 1 - 0.62 * o
      // Diffuse skylight actually RISES a touch under cloud relative to the
      // lost direct sun — this is what keeps an overcast noon bright.
      kf.ambientIntensity *= 1 + 0.22 * o * THREE.MathUtils.clamp(kf.sunIntensity, 0, 1)
      kf.fogNear *= 1 - 0.52 * o
      kf.fogFar *= 1 - 0.38 * o
    }

    // Lightning rides on top of everything: the cloud lid itself becomes the
    // light source for a few frames, so sky, fog and ambient all jump
    // together (a directional flash would cast impossible hard shadows).
    this.updateLightning(dt)
    if (this.flash > 0.001) {
      const f = Math.min(1, this.flash)
      kf.skyTop.lerp(FLASH_COLOR, f * 0.5)
      kf.skyMid.lerp(FLASH_COLOR, f * 0.62)
      kf.skyBottom.lerp(FLASH_COLOR, f * 0.7)
      kf.fogColor.lerp(FLASH_COLOR, f * 0.55)
      kf.ambientIntensity += f * 1.5
    }

    const elevationDeg = this.sunElevationDeg()
    // A storm asks for MORE than a full lid (see overcastTarget), so the
    // complement is clamped before anything multiplies by it — a negative
    // opacity paints stars back in.
    const clearAmount = Math.max(0, 1 - o)
    const azimuthDeg = 100 + this.timeOfDay * 2
    const elevRad = THREE.MathUtils.degToRad(elevationDeg)
    const azRad = THREE.MathUtils.degToRad(azimuthDeg)
    const sunDir = SUN_DIR_SCRATCH.set(
      Math.cos(elevRad) * Math.cos(azRad),
      Math.sin(elevRad),
      Math.cos(elevRad) * Math.sin(azRad),
    )
    this.sunLight.target.position.copy(focusPoint)
    this.sunLight.position.copy(focusPoint).addScaledVector(sunDir, this.sunDistance)
    this.sunLight.target.updateMatrixWorld()
    this.sunLight.color.copy(kf.sunColor)
    this.sunLight.intensity = kf.sunIntensity
    // Hard shadows die under a closed sky — everything goes soft-lit.
    this.sunLight.castShadow = elevationDeg > -2 && o < 0.55

    const moonDir = MOON_DIR_SCRATCH.copy(sunDir).negate()
    this.moonLight.target.position.copy(focusPoint)
    this.moonLight.position.copy(focusPoint).addScaledVector(moonDir, this.sunDistance)
    this.moonLight.target.updateMatrixWorld()
    this.moonLight.intensity = this.nightFactor * 0.25

    this.ambient.color.copy(kf.skyTop)
    // Ground bounce follows daylight so canopy/roof undersides aren't pure
    // black at noon but still go dark at night.
    this.ambient.groundColor.set(0x352f28).multiplyScalar(THREE.MathUtils.clamp(kf.sunIntensity, 0.25, 1))
    this.ambient.intensity = kf.ambientIntensity

    const mat = this.skyMesh.material as THREE.ShaderMaterial
    mat.uniforms.topColor.value.copy(kf.skyTop)
    mat.uniforms.midColor.value.copy(kf.skyMid)
    mat.uniforms.bottomColor.value.copy(kf.skyBottom)
    mat.uniforms.sunDir.value.copy(sunDir)
    mat.uniforms.glowColor.value.copy(kf.sunColor)
    // Halo strongest when the sun rides low with real intensity behind it —
    // sunrise/sunset blaze, gentle by day, none at night.
    const lowSun = 1 - THREE.MathUtils.clamp(Math.abs(elevationDeg) / 28, 0, 1)
    mat.uniforms.glowStrength.value = THREE.MathUtils.clamp(kf.sunIntensity, 0, 1.6) * (0.22 + lowSun * 0.55) * (1 - 0.85 * o)

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(kf.fogColor)
      this.scene.fog.near = kf.fogNear
      this.scene.fog.far = kf.fogFar
    }

    this.sunSprite.position.copy(focusPoint).addScaledVector(sunDir, 1900)
    this.sunSprite.visible = elevationDeg > -8
    const sunMat = this.sunSprite.material as THREE.SpriteMaterial
    sunMat.opacity = THREE.MathUtils.clamp((elevationDeg + 8) / 14, 0, 1) * clearAmount

    this.moonSprite.position.copy(focusPoint).addScaledVector(moonDir, 1900)
    this.moonSprite.visible = elevationDeg < 8
    const moonMat = this.moonSprite.material as THREE.SpriteMaterial
    moonMat.opacity = THREE.MathUtils.clamp((-elevationDeg + 8) / 14, 0, 1) * 0.9 * clearAmount

    // A closed sky hides the stars long before it hides the city glow.
    this.starsMaterial.opacity = this.nightFactor * 0.75 * clearAmount
    this.starsBrightMaterial.opacity = this.nightFactor * 0.95 * clearAmount
    this.stars.position.copy(focusPoint)
    this.starsBright.position.copy(focusPoint)
    // Sky dome follows the cab so its gradient (and margins against distant
    // landmarks) stay consistent all around the enlarged loop.
    this.skyMesh.position.copy(focusPoint)
  }
}
