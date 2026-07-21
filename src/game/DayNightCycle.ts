import * as THREE from 'three'
import { makeSunTexture, makeMoonTexture } from './signage'

// One full 24h cycle every REAL_SECONDS_PER_DAY seconds of play.
const REAL_SECONDS_PER_DAY = 8 * 60

interface Keyframe {
  hour: number
  skyTop: THREE.Color
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

const KEYFRAMES: Keyframe[] = [
  { hour: 0, skyTop: C(0x03040d), skyBottom: C(0x0c1226), sunColor: C(0x33447a), sunIntensity: 0.05, ambientIntensity: 0.16, fogColor: C(0x05060f), fogNear: 70, fogFar: 1500, label: 'Madrugada' },
  { hour: 3.5, skyTop: C(0x050714), skyBottom: C(0x121a35), sunColor: C(0x33447a), sunIntensity: 0.05, ambientIntensity: 0.17, fogColor: C(0x070a18), fogNear: 70, fogFar: 1500, label: 'Madrugada' },
  { hour: 5, skyTop: C(0x142042), skyBottom: C(0x3a3560), sunColor: C(0x8a7bb8), sunIntensity: 0.25, ambientIntensity: 0.28, fogColor: C(0x241f3d), fogNear: 90, fogFar: 1450, label: 'Alba' },
  { hour: 6, skyTop: C(0x2c3a6b), skyBottom: C(0xe08a5c), sunColor: C(0xffab6b), sunIntensity: 0.9, ambientIntensity: 0.42, fogColor: C(0xe08a5c), fogNear: 110, fogFar: 1400, label: 'Amanecer' },
  { hour: 7.5, skyTop: C(0x5f8ad0), skyBottom: C(0xffd9a0), sunColor: C(0xffdcb0), sunIntensity: 1.4, ambientIntensity: 0.55, fogColor: C(0xe8d0b8), fogNear: 150, fogFar: 1300, label: 'Mañana' },
  { hour: 10, skyTop: C(0x3f7fe0), skyBottom: C(0xbfe3ff), sunColor: C(0xfff3da), sunIntensity: 1.7, ambientIntensity: 0.65, fogColor: C(0xcfe8ff), fogNear: 200, fogFar: 1500, label: 'Media mañana' },
  { hour: 13, skyTop: C(0x2f74e6), skyBottom: C(0xcdeaff), sunColor: C(0xffffff), sunIntensity: 1.85, ambientIntensity: 0.7, fogColor: C(0xd8edff), fogNear: 220, fogFar: 1600, label: 'Mediodía' },
  { hour: 16, skyTop: C(0x3d78d8), skyBottom: C(0xdcecf7), sunColor: C(0xfff0d8), sunIntensity: 1.6, ambientIntensity: 0.6, fogColor: C(0xdde8f2), fogNear: 180, fogFar: 1400, label: 'Tarde' },
  { hour: 17.5, skyTop: C(0x3a5aa8), skyBottom: C(0xf0955c), sunColor: C(0xffa860), sunIntensity: 1.2, ambientIntensity: 0.5, fogColor: C(0xf0955c), fogNear: 130, fogFar: 1200, label: 'Atardecer' },
  { hour: 18.5, skyTop: C(0x2a2f5c), skyBottom: C(0xe0603f), sunColor: C(0xff7a4a), sunIntensity: 0.7, ambientIntensity: 0.38, fogColor: C(0x8a3f45), fogNear: 90, fogFar: 1000, label: 'Crepúsculo' },
  { hour: 19.5, skyTop: C(0x141235), skyBottom: C(0x5a3a5e), sunColor: C(0x9a5aa0), sunIntensity: 0.3, ambientIntensity: 0.28, fogColor: C(0x281f3d), fogNear: 80, fogFar: 1450, label: 'Noche' },
  { hour: 21, skyTop: C(0x05071a), skyBottom: C(0x161c3a), sunColor: C(0x33447a), sunIntensity: 0.08, ambientIntensity: 0.2, fogColor: C(0x0a0d1e), fogNear: 70, fogFar: 1500, label: 'Noche cerrada' },
  { hour: 24, skyTop: C(0x03040d), skyBottom: C(0x0c1226), sunColor: C(0x33447a), sunIntensity: 0.05, ambientIntensity: 0.16, fogColor: C(0x05060f), fogNear: 70, fogFar: 1500, label: 'Madrugada' },
]

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
  return {
    hour,
    skyTop: a.skyTop.clone().lerp(b.skyTop, f),
    skyBottom: a.skyBottom.clone().lerp(b.skyBottom, f),
    sunColor: a.sunColor.clone().lerp(b.sunColor, f),
    sunIntensity: THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, f),
    ambientIntensity: THREE.MathUtils.lerp(a.ambientIntensity, b.ambientIntensity, f),
    fogColor: a.fogColor.clone().lerp(b.fogColor, f),
    fogNear: THREE.MathUtils.lerp(a.fogNear, b.fogNear, f),
    fogFar: THREE.MathUtils.lerp(a.fogFar, b.fogFar, f),
    label: f < 0.5 ? a.label : b.label,
  }
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
uniform vec3 bottomColor;
uniform float offset;
uniform float exponent;
varying vec3 vWorldPosition;
void main() {
  float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
  gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
}
`

export class DayNightCycle {
  timeOfDay = 7.5 // start at a pleasant morning
  readonly sunLight: THREE.DirectionalLight
  readonly moonLight: THREE.DirectionalLight
  readonly ambient: THREE.HemisphereLight
  readonly skyMesh: THREE.Mesh
  readonly sunSprite: THREE.Sprite
  readonly moonSprite: THREE.Sprite
  readonly stars: THREE.Points
  private starsMaterial: THREE.PointsMaterial
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

    const skyGeo = new THREE.SphereGeometry(4000, 24, 16)
    const skyMat = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x3f7fe0) },
        bottomColor: { value: new THREE.Color(0xbfe3ff) },
        offset: { value: 20 },
        exponent: { value: 0.6 },
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

    const starGeo = new THREE.BufferGeometry()
    const STAR_COUNT = 1200
    const positions = new Float32Array(STAR_COUNT * 3)
    for (let i = 0; i < STAR_COUNT; i++) {
      const r = 1800 + Math.random() * 1500
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(THREE.MathUtils.lerp(0.05, 0.95, Math.random()))
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 100
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.starsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 3.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    })
    this.stars = new THREE.Points(starGeo, this.starsMaterial)
    scene.add(this.stars)

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

  update(dt: number, focusPoint = new THREE.Vector3()) {
    if (!this.paused) {
      this.timeOfDay = (this.timeOfDay + (dt * 24) / REAL_SECONDS_PER_DAY) % 24
    }
    // Blend once per frame; getters (horizonColor, phaseLabel) serve from this cache.
    const kf = lerpKeyframes(this.timeOfDay)
    this.currentKf = kf

    const elevationDeg = this.sunElevationDeg()
    const azimuthDeg = 100 + this.timeOfDay * 2
    const elevRad = THREE.MathUtils.degToRad(elevationDeg)
    const azRad = THREE.MathUtils.degToRad(azimuthDeg)
    const sunDir = new THREE.Vector3(
      Math.cos(elevRad) * Math.cos(azRad),
      Math.sin(elevRad),
      Math.cos(elevRad) * Math.sin(azRad),
    )
    this.sunLight.target.position.copy(focusPoint)
    this.sunLight.position.copy(focusPoint).addScaledVector(sunDir, this.sunDistance)
    this.sunLight.target.updateMatrixWorld()
    this.sunLight.color.copy(kf.sunColor)
    this.sunLight.intensity = kf.sunIntensity
    this.sunLight.castShadow = elevationDeg > -2

    const moonDir = sunDir.clone().negate()
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
    mat.uniforms.bottomColor.value.copy(kf.skyBottom)

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(kf.fogColor)
      this.scene.fog.near = kf.fogNear
      this.scene.fog.far = kf.fogFar
    }

    this.sunSprite.position.copy(focusPoint).addScaledVector(sunDir, 1900)
    this.sunSprite.visible = elevationDeg > -8
    const sunMat = this.sunSprite.material as THREE.SpriteMaterial
    sunMat.opacity = THREE.MathUtils.clamp((elevationDeg + 8) / 14, 0, 1)

    this.moonSprite.position.copy(focusPoint).addScaledVector(moonDir, 1900)
    this.moonSprite.visible = elevationDeg < 8
    const moonMat = this.moonSprite.material as THREE.SpriteMaterial
    moonMat.opacity = THREE.MathUtils.clamp((-elevationDeg + 8) / 14, 0, 1) * 0.9

    this.starsMaterial.opacity = this.nightFactor * 0.85
    this.stars.position.copy(focusPoint)
    // Sky dome follows the cab so its gradient (and margins against distant
    // landmarks) stay consistent all around the enlarged loop.
    this.skyMesh.position.copy(focusPoint)
  }
}
