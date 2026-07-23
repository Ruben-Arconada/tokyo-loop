import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Track, TrackOffsetCurve, CatenaryCurve } from './Track'
import { Train, notchLabel, MIN_NOTCH, MAX_NOTCH } from './Train'
import { City } from './City'
import { Scenery } from './Scenery'
import { DayNightCycle } from './DayNightCycle'
import { audio } from '../audio/AudioEngine'
import { Controls } from '../ui/Controls'
import { UI } from '../ui/UI'
import { STATIONS } from '../data/stations'
import { getStationMelody, DOOR_CHIME_OPEN, DOOR_CHIME_CLOSE } from '../data/melodies'
import { makeBallastTexture, makeScuffedPanelTexture, makeDestinationTexture, makeGroundTexture, makeTracksideWearTexture, WINDOW_DUSK_UNIFORM } from './signage'

const LOOK_YAW_LIMIT = 1.7 // ~97°, enough to look out the side windows
const LOOK_PITCH_LIMIT = 0.55

// Fixed-timestep physics: train integration/scoring must be identical
// regardless of device frame rate. FIXED_DT matches the original ~60Hz
// tuning (notch accel/brake tables, stop-zone width) so play feel doesn't
// shift; MAX_FRAME_DT/MAX_CATCHUP_STEPS bound how much simulated time a
// single stall (GC pause, tab hitch) can demand, so a long stall spreads
// its catch-up over a couple of frames instead of freezing the render loop.
const FIXED_DT = 1 / 60
const MAX_FRAME_DT = 0.25
const MAX_CATCHUP_STEPS = 15

/** Door-side wording per language, so every announcement really states the side. */
function doorSidePhrases(side: 'left' | 'right'): { ja: string; en: string; es: string } {
  return side === 'left'
    ? { ja: '左側', en: 'left', es: 'izquierdo' }
    : { ja: '右側', en: 'right', es: 'derecho' }
}

const BEST_SCORE_KEY = 'yamanote-best-score'
/** Arcade scoring per stop grade; perfects chain into a streak bonus. */
const GRADE_POINTS: Record<string, number> = { perfect: 100, good: 60, ok: 30 }
const STREAK_BONUS = 25
const STREAK_BONUS_CAP = 200

export class Game {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private track: Track
  private train: Train
  private city: City
  private scenery: Scenery
  private dayNight: DayNightCycle
  private headlight!: THREE.SpotLight
  private cabLight!: THREE.PointLight
  private controls: Controls
  private ui: UI
  private clock = new THREE.Clock()
  private started = false
  /** Whether the WebGL animation loop is actually spinning (false = single static frame, no rAF). */
  private running = false
  /** Leftover real time not yet consumed by a fixed physics step. */
  private physicsAccumulator = 0
  private timeScale = 1
  private lookYaw = 0
  private lookPitch = 0
  private leverPivot!: THREE.Object3D
  private destinationMat!: THREE.MeshBasicMaterial
  private lastDestinationIdx = -1
  private lastCrossingPhase = false
  private perfEl: HTMLDivElement | null = null
  private score = 0
  private perfectStreak = 0
  private bestScore = Number(localStorage.getItem(BEST_SCORE_KEY) ?? 0)

  constructor(mount: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.domElement.classList.add('game-canvas')
    mount.prepend(this.renderer.domElement)

    // A single generic, soft-lit environment map so metallic materials (rails,
    // signage frames, towers) pick up plausible reflections instead of
    // flat black — generated once, never regenerated per Marco's perf budget.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.15
    pmrem.dispose()

    // Near plane at 0.3 (nearest cab prop sits ~0.5 away): 3x the depth
    // precision of the old 0.1, which is what made distant geometry shimmer.
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.3, 9000)
    this.scene.add(this.camera)

    this.track = new Track()
    this.train = new Train(this.track, {
      onDepartAnnounce: (_cur, next) => this.handleDepartAnnounce(next),
      onArrivingAnnounce: (idx) => this.handleArrivingAnnounce(idx),
      onStopped: (idx, result) => {
        const gained = this.applyScore(result.grade)
        this.ui.showStopToast(idx, result, gained)
        this.ui.setStationResult(idx, result.grade)
      },
      onMissed: (idx) => {
        this.perfectStreak = 0
        this.ui.showMissedToast(idx)
        this.ui.setStationResult(idx, 'missed')
      },
      onDoorsOpen: (idx) => this.handleDoorsOpen(idx),
      onDoorsClose: () => this.handleDoorsClose(),
      onDoorsClosingWarning: () => this.handleDoorsClosingWarning(),
    })
    this.city = new City(this.scene, this.track)
    this.scenery = new Scenery(this.scene, this.track)
    this.dayNight = new DayNightCycle(this.scene)
    this.buildTrackVisual()
    this.buildCabRig()
    this.buildHeadlight()

    this.controls = new Controls(mount, {
      onNotchChange: (n) => this.train.setNotch(n),
      onLook: (dx, dy) => this.handleLook(dx, dy),
    })
    this.ui = new UI(mount, {
      onStart: () => this.start(),
      onPauseToggle: (p) => this.setPaused(p),
      onTimeScaleChange: (s) => (this.timeScale = s),
      onTimeSet: (hour) => (this.dayNight.timeOfDay = hour),
    })

    window.addEventListener('resize', () => this.onResize())
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') this.togglePerfOverlay(mount)
    })
    // The render loop freezes on its own when the tab hides, but audio does
    // not — silence everything in the background and pick back up on return.
    document.addEventListener('visibilitychange', () => {
      audio.setBackgrounded(document.hidden)
    })
    this.onResize()
    this.updateCameraFromTrain()
    // No animation loop yet: the start screen is a single static render, not
    // a spinning render loop burning battery behind the overlay. tick()
    // proper only starts once the player actually taps "start".
    this.renderOnce()
  }

  /** Hidden dev overlay (press "P") — FPS + draw calls/triangles, so the mobile perf budget can be spot-checked without shipping a permanent HUD element. */
  private togglePerfOverlay(mount: HTMLElement) {
    if (this.perfEl) {
      this.perfEl.remove()
      this.perfEl = null
      return
    }
    this.perfEl = document.createElement('div')
    this.perfEl.style.cssText =
      'position:absolute;left:8px;bottom:8px;padding:6px 10px;background:rgba(0,0,0,0.7);color:#7bffb0;font:11px ui-monospace,monospace;border-radius:6px;pointer-events:none;z-index:30;white-space:pre;'
    mount.appendChild(this.perfEl)
  }

  private updatePerfOverlay(dt: number) {
    if (!this.perfEl) return
    const fps = dt > 0 ? 1 / dt : 0
    const info = this.renderer.info
    this.perfEl.textContent = `FPS ${fps.toFixed(0)}  draws ${info.render.calls}  tris ${info.render.triangles}`
  }

  private start() {
    audio.unlock()
    this.started = true
    this.clock.start()
    this.setRunning(true)
    // Fire-and-forget — never blocks the game loop or player input, which
    // can already move the train while this plays out.
    window.setTimeout(() => this.handleWelcomeAnnounce(), 500)
  }

  /** Menu open/close: a real pause, not just a frozen simulation — the render loop itself stops. */
  private setPaused(p: boolean) {
    if (this.started) this.setRunning(!p)
  }

  /**
   * Starts or stops the actual WebGL animation loop. Stopping it (rather
   * than just skipping `step()` inside a loop that keeps spinning) is what
   * saves battery/heat on the start screen and while paused — `tick()` was
   * previously called every frame regardless of game state.
   */
  private setRunning(running: boolean) {
    this.running = running
    if (running) {
      this.clock.getDelta() // discard the stale interval built up while stopped
      this.renderer.setAnimationLoop(() => this.tick())
    } else {
      this.renderer.setAnimationLoop(null)
      this.renderOnce()
    }
  }

  /** Renders exactly one frame without advancing simulation — the start screen backdrop and the frame shown right when pausing/resizing. */
  private renderOnce() {
    this.renderer.render(this.scene, this.camera)
  }

  private handleLook(dx: number, dy: number) {
    const sens = 0.0032
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw - dx * sens, -LOOK_YAW_LIMIT, LOOK_YAW_LIMIT)
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch - dy * sens, -LOOK_PITCH_LIMIT, LOOK_PITCH_LIMIT)
  }

  /** The session's one-time welcome cue: next stop announced in JA/EN/ES with a retro chiptune fanfare. */
  private handleWelcomeAnnounce() {
    const next = STATIONS[this.train.targetStationIndex]
    const sides = doorSidePhrases(next.doorSide)
    audio.announce(
      [
        { lang: 'ja', text: `次は、${next.nameJa}、${next.nameJa}です。お出口は${sides.ja}です。` },
        { lang: 'en', text: `The next station is ${next.nameEn}. Doors will open on the ${sides.en} side.` },
        { lang: 'es', text: `Próxima estación: ${next.nameEn}. Las puertas se abrirán por el lado ${sides.es}.` },
      ],
      { fanfare: true, kind: 'depart' },
    )
  }

  /** Every announcement runs in the three languages, always naming the door side — JA first (host country), then EN, then ES. */
  private handleDepartAnnounce(nextIdx: number) {
    const next = STATIONS[nextIdx]
    const sides = doorSidePhrases(next.doorSide)
    audio.announce(
      [
        { lang: 'ja', text: `次は、${next.nameJa}、${next.nameJa}です。お出口は${sides.ja}です。` },
        { lang: 'en', text: `The next station is ${next.nameEn}. Doors will open on the ${sides.en} side.` },
        { lang: 'es', text: `Próxima estación: ${next.nameEn}. Las puertas se abrirán por el lado ${sides.es}.` },
      ],
      { kind: 'depart' },
    )
  }

  private handleArrivingAnnounce(idx: number) {
    const station = STATIONS[idx]
    const sides = doorSidePhrases(station.doorSide)
    const transferJa = station.transferLines?.length ? ` ${station.transferLines.join('、')}はお乗り換えです。` : ''
    const transferEn = station.transferLines?.length ? ` Please change here for ${station.transferLines.join(', ')}.` : ''
    audio.announce(
      [
        { lang: 'ja', text: `まもなく、${station.nameJa}、${station.nameJa}です。${transferJa} お出口は${sides.ja}です。` },
        { lang: 'en', text: `We will soon arrive at ${station.nameEn}.${transferEn} The doors on the ${sides.en} side will open.` },
        { lang: 'es', text: `Llegamos a ${station.nameEn}. Las puertas se abrirán por el lado ${sides.es}.` },
      ],
      { kind: 'arriving' },
    )
  }

  private handleDoorsOpen(idx: number) {
    this.controls.syncNotch(0)
    audio.playDoorCycle(true)
    const chimeDuration = audio.playMelody(DOOR_CHIME_OPEN, 'attention', 0.45) || 0.5
    window.setTimeout(() => {
      audio.startMelodyLoop(getStationMelody(STATIONS[idx].id), 'bell', 0.4)
    }, chimeDuration * 1000 + 120)
  }

  private handleDoorsClosingWarning() {
    // Stop future melody repeats so the closing-warning window reads
    // clearly instead of competing with the next loop iteration.
    audio.stopMelodyLoop()
    audio.announce(
      [
        { lang: 'ja', text: 'ドアが閉まります。ご注意ください。' },
        { lang: 'en', text: 'The doors are closing.' },
        { lang: 'es', text: 'Las puertas se cierran.' },
      ],
      { kind: 'closing' },
    )
  }

  private handleDoorsClose() {
    audio.stopMelodyLoop()
    audio.playDoorCycle(false)
    audio.playMelody(DOOR_CHIME_CLOSE, 'attention', 0.4)
  }

  private buildTrackVisual() {
    const segments = 900
    const halfWidth = 4.2
    const positions: number[] = []
    const uvs: number[] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const pl = p.clone().addScaledVector(normal, halfWidth)
      const pr = p.clone().addScaledVector(normal, -halfWidth)
      positions.push(pl.x, p.y - 0.06, pl.z, pr.x, p.y - 0.06, pr.z)
      uvs.push(0, t * 300, 1, t * 300)
    }
    const indices: number[] = []
    for (let i = 0; i < segments; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
      indices.push(a, b, c, b, d, c)
    }
    const bedGeo = new THREE.BufferGeometry()
    bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    bedGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    bedGeo.setIndex(indices)
    bedGeo.computeVertexNormals()
    const ballast = makeBallastTexture()
    const bedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: ballast.map, roughnessMap: ballast.roughnessMap, roughness: 1 })
    const bed = new THREE.Mesh(bedGeo, bedMat)
    bed.receiveShadow = true
    this.scene.add(bed)

    // Sleepers: individual boards with air between them (they used to be
    // longer than their spacing and fused into a dark ribbon), each with a
    // little placement/size jitter and its own wood tone — and a warm honey
    // tint inside every station's stop zone so the braking area reads at a
    // glance from the cab.
    const sleeperSpacing = 1.7
    const sleeperCount = Math.floor(this.track.getLength() / sleeperSpacing)
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 0.15, 0.95), sleeperMat, sleeperCount)
    sleepers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sleeperCount * 3), 3)
    sleepers.receiveShadow = true
    // Baked contact shadow: a soft-edged AO pad barely larger than each
    // board — a hard black rectangle read as a floating slab of its own.
    const shadowTex = (() => {
      const c = document.createElement('canvas')
      c.width = 128
      c.height = 64
      const ctx = c.getContext('2d')!
      const g = ctx.createRadialGradient(64, 32, 4, 64, 32, 62)
      g.addColorStop(0, 'rgba(0,0,0,0.55)')
      g.addColorStop(0.55, 'rgba(0,0,0,0.35)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.save()
      ctx.translate(64, 32)
      ctx.scale(1, 0.5)
      ctx.translate(-64, -32)
      ctx.fillStyle = g
      ctx.fillRect(0, -32, 128, 128)
      ctx.restore()
      const tex = new THREE.CanvasTexture(c)
      return tex
    })()
    const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.8, depthWrite: false })
    const sleeperShadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.6, 1.15), shadowMat, sleeperCount)
    const sleeperDummy = new THREE.Object3D()
    const sleeperTint = new THREE.Color()
    const zoneTint = new THREE.Color(0x7d5f2e)
    const trackLen = this.track.getLength()
    const markerTs = STATIONS.map((_, i) => this.track.markerFor(i).tFraction)
    for (let i = 0; i < sleeperCount; i++) {
      const t = i / sleeperCount
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      // Just a whisper of irregularity — boards laid by hand, not scattered.
      sleeperDummy.position.set(
        p.x + (Math.random() - 0.5) * 0.05,
        p.y - 0.02,
        p.z + (Math.random() - 0.5) * 0.05,
      )
      sleeperDummy.lookAt(p.x + tangent.x, p.y - 0.02, p.z + tangent.z)
      sleeperDummy.rotateY((Math.random() - 0.5) * 0.018)
      sleeperDummy.scale.set(0.97 + Math.random() * 0.06, 1, 0.95 + Math.random() * 0.1)
      sleeperDummy.updateMatrix()
      sleepers.setMatrixAt(i, sleeperDummy.matrix)

      sleeperDummy.position.y = p.y - 0.088
      sleeperDummy.rotateX(-Math.PI / 2)
      sleeperDummy.updateMatrix()
      sleeperShadows.setMatrixAt(i, sleeperDummy.matrix)
      sleeperDummy.rotation.set(0, 0, 0)

      // Dark creosote wood with slight per-board variation…
      sleeperTint.setHSL(0.075 + Math.random() * 0.015, 0.26 + Math.random() * 0.1, 0.085 + Math.random() * 0.035)
      // …shifted toward honey inside a stop zone: the braking guide.
      let minDist = Infinity
      for (const mt of markerTs) {
        const d = Math.abs((((t - mt) % 1) + 1.5) % 1 - 0.5) * trackLen
        if (d < minDist) minDist = d
      }
      if (minDist < 26) sleeperTint.lerp(zoneTint, 0.55)
      sleepers.setColorAt(i, sleeperTint)
    }
    sleepers.instanceMatrix.needsUpdate = true
    sleeperShadows.instanceMatrix.needsUpdate = true
    if (sleepers.instanceColor) sleepers.instanceColor.needsUpdate = true
    this.scene.add(sleepers, sleeperShadows)

    // Wide ground plane so the world doesn't feel like it ends at the ballast
    // edge — with a faint city-block texture so it reads as streets from the
    // cab. Sized well past the skyline belt at LOOP_SCALE 3 so no edge is
    // ever visible, even with the longer night fog range.
    const groundTex = makeGroundTexture()
    groundTex.repeat.set(56, 56)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(14000, 14000),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: groundTex, roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.5
    ground.receiveShadow = true
    this.scene.add(ground)

    // Worn corridor beside the rails: a wider, alpha-edged band of beaten
    // earth riding just above the ground plane, so the trackside looks used
    // and the pristine ground only starts a little way out.
    const wearPositions: number[] = []
    const wearUvs: number[] = []
    const wearHalf = 14
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const pl = p.clone().addScaledVector(normal, wearHalf)
      const pr = p.clone().addScaledVector(normal, -wearHalf)
      wearPositions.push(pl.x, -0.42, pl.z, pr.x, -0.42, pr.z)
      wearUvs.push(0, t * 260, 1, t * 260)
    }
    const wearGeo = new THREE.BufferGeometry()
    wearGeo.setAttribute('position', new THREE.Float32BufferAttribute(wearPositions, 3))
    wearGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wearUvs, 2))
    wearGeo.setIndex(indices)
    wearGeo.computeVertexNormals()
    const wearMat = new THREE.MeshStandardMaterial({
      map: makeTracksideWearTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 1,
    })
    const wear = new THREE.Mesh(wearGeo, wearMat)
    wear.receiveShadow = true
    this.scene.add(wear)

    const railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85 })
    for (const offset of [0.75, -0.75]) {
      const curve = new TrackOffsetCurve(this.track, offset)
      const railGeo = new THREE.TubeGeometry(curve, segments, 0.09, 6, true)
      const rail = new THREE.Mesh(railGeo, railMat)
      rail.castShadow = true
      rail.receiveShadow = true
      this.scene.add(rail)
    }

    this.buildCatenary()
  }

  private buildCatenary() {
    const trackLen = this.track.getLength()
    const poleSpacing = 42
    const poleCount = Math.max(8, Math.floor(trackLen / poleSpacing))
    const poleOffset = 5.6
    const poleHeight = 7
    const armLength = 4.6
    const wireHeight = 6.6

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.5, roughness: 0.5 })
    // Shafts run longer so their feet sink just below the ground plane
    // (-0.58) instead of hovering at track height.
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.16, poleHeight + 0.58, 8), poleMat, poleCount)
    poles.castShadow = true
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(armLength, 0.1, 0.1), poleMat, poleCount)

    const dummy = new THREE.Object3D()
    for (let i = 0; i < poleCount; i++) {
      const t = i / poleCount
      const p = this.track.pointAt(t)
      const tangent = this.track.tangentAt(t)
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
      const base = p.clone().addScaledVector(normal, poleOffset)

      dummy.position.set(base.x, base.y + (poleHeight - 0.58) / 2, base.z)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      poles.setMatrixAt(i, dummy.matrix)

      const armCenter = base.clone().addScaledVector(normal, -armLength / 2)
      dummy.position.set(armCenter.x, base.y + poleHeight, armCenter.z)
      const inward = normal.clone().multiplyScalar(-1)
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), inward)
      dummy.updateMatrix()
      arms.setMatrixAt(i, dummy.matrix)
    }
    poles.instanceMatrix.needsUpdate = true
    arms.instanceMatrix.needsUpdate = true
    this.scene.add(poles, arms)

    const wireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 })
    const wireCurve = new CatenaryCurve(this.track, wireHeight, 0.18, poleCount)
    const wireGeo = new THREE.TubeGeometry(wireCurve, Math.max(600, poleCount * 8), 0.035, 5, true)
    const wire = new THREE.Mesh(wireGeo, wireMat)
    this.scene.add(wire)
  }

  private buildCabRig() {
    const cab = new THREE.Group()
    this.camera.add(cab)

    // Cab dome light: a soft warm pool over the console so the controls and
    // pillars stay readable after dark (stronger at night, ember-low by day).
    this.cabLight = new THREE.PointLight(0xffdfb0, 0.25, 3.2, 1.6)
    this.cabLight.position.set(0.1, 0.35, -0.5)
    cab.add(this.cabLight)

    // Tinted windshield, set behind the dashboard hardware so it reads as
    // glass between the driver and the world rather than a filter on top.
    const windshieldMat = new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.045, depthWrite: false })
    const windshield = new THREE.Mesh(new THREE.PlaneGeometry(5, 3.6), windshieldMat)
    windshield.position.set(0, 0.05, -1.05)
    cab.add(windshield)

    const panelTex = makeScuffedPanelTexture('#3a3f4a')
    panelTex.repeat.set(1.5, 1.5)
    // Faint self-illumination so the desk never falls to pure black between lamps.
    const consoleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: panelTex, roughness: 0.55, metalness: 0.35, emissive: 0x2a2c33, emissiveIntensity: 0.22 })
    const consoleMesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.5), consoleMat)
    consoleMesh.position.set(0, -0.62, -0.85)
    consoleMesh.rotation.x = -0.25
    cab.add(consoleMesh)

    const pillarTex = makeScuffedPanelTexture('#33363d')
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: pillarTex, roughness: 0.65 })
    const pillarGeo = new THREE.BoxGeometry(0.12, 1.3, 0.12)
    const pillarL = new THREE.Mesh(pillarGeo, pillarMat)
    pillarL.position.set(-0.86, -0.05, -0.88)
    pillarL.rotation.z = 0.12
    cab.add(pillarL)
    const pillarR = pillarL.clone()
    pillarR.position.x = 0.86
    pillarR.rotation.z = -0.12
    cab.add(pillarR)

    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.35), pillarMat)
    visor.position.set(0, 0.56, -0.85)
    cab.add(visor)

    const lampGeo = new THREE.SphereGeometry(0.022, 8, 8)
    const lampColors = [0x33ff66, 0xffcc33, 0xff3333]
    lampColors.forEach((color, i) => {
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }))
      lamp.position.set(-0.55 + i * 0.12, -0.42, -0.82)
      cab.add(lamp)
    })

    // Destination roll sign, updated only when the target station changes.
    this.destinationMat = new THREE.MeshBasicMaterial({ map: makeDestinationTexture('---'), toneMapped: false })
    const destPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.14), this.destinationMat)
    destPlane.position.set(-0.48, -0.48, -0.83)
    destPlane.rotation.x = -0.25
    cab.add(destPlane)

    // The physical master controller — a modeled lever that tilts with the
    // train's notch, in front of the DOM lever the player actually drags.
    const leverMount = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 10), consoleMat)
    leverMount.position.set(0.58, -0.38, -0.72)
    cab.add(leverMount)

    this.leverPivot = new THREE.Object3D()
    this.leverPivot.position.copy(leverMount.position)
    cab.add(this.leverPivot)

    const shaftMat = new THREE.MeshStandardMaterial({ color: 0x888a8f, metalness: 0.6, roughness: 0.35 })
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.22, 8), shaftMat)
    shaft.position.set(0, 0.11, 0)
    this.leverPivot.add(shaft)

    const knobMat = new THREE.MeshStandardMaterial({ color: 0x2d3340, metalness: 0.25, roughness: 0.5 })
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), knobMat)
    knob.position.set(0, 0.22, 0)
    this.leverPivot.add(knob)
  }

  /** Train headlight — a soft forward spot that only matters after dusk, when it sweeps the ballast ahead of the cab. */
  private buildHeadlight() {
    this.headlight = new THREE.SpotLight(0xfff4d8, 0, 130, 0.42, 0.55, 1.2)
    this.headlight.castShadow = false
    this.scene.add(this.headlight)
    this.scene.add(this.headlight.target)
  }

  private readonly headlightPos = new THREE.Vector3()
  private readonly headlightDir = new THREE.Vector3()

  private updateHeadlight() {
    const night = this.dayNight.nightFactor
    // Cab light breathes with the dark: ember by day, warm pool at night.
    this.cabLight.intensity = 0.25 + night * 1.3
    // Fully off (and skipped by the renderer) in daylight — an intensity-0
    // spot still costs per-fragment work in every standard material.
    this.headlight.visible = night > 0.01
    if (!this.headlight.visible) return
    const t = this.train.progressFraction
    this.track.pointAt(t, this.headlightPos)
    this.track.tangentAt(t, this.headlightDir).normalize()
    const y = this.headlightPos.y
    this.headlight.position.set(this.headlightPos.x, y + 2.2, this.headlightPos.z)
    this.headlight.target.position.copy(this.headlightPos).addScaledVector(this.headlightDir, 60).setY(y + 0.3)
    this.headlight.target.updateMatrixWorld()
    this.headlight.intensity = night * 260
  }

  /** Adds points for a stop grade (with perfect-streak bonus), persists the best, and returns what was gained. */
  private applyScore(grade: string): number {
    let gained = GRADE_POINTS[grade] ?? 0
    if (grade === 'perfect') {
      this.perfectStreak++
      gained += Math.min((this.perfectStreak - 1) * STREAK_BONUS, STREAK_BONUS_CAP)
    } else {
      this.perfectStreak = 0
    }
    this.score += gained
    if (this.score > this.bestScore) {
      this.bestScore = this.score
      localStorage.setItem(BEST_SCORE_KEY, String(this.bestScore))
    }
    this.ui.setScore(this.score, this.bestScore, this.perfectStreak)
    return gained
  }

  private updateLever() {
    this.leverPivot.rotation.x = THREE.MathUtils.mapLinear(this.train.notch, MIN_NOTCH, MAX_NOTCH, 0.5, -0.35)
    if (this.train.targetStationIndex !== this.lastDestinationIdx) {
      this.lastDestinationIdx = this.train.targetStationIndex
      this.destinationMat.map?.dispose()
      this.destinationMat.map = makeDestinationTexture(this.train.targetStation.nameEn.toUpperCase())
      this.destinationMat.needsUpdate = true
    }
  }

  private updateCameraFromTrain() {
    const t = this.train.progressFraction
    const point = this.track.pointAt(t)
    const tangent = this.track.tangentAt(t).normalize()
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()

    const eye = point.clone().addScaledVector(normal, 0.95).add(new THREE.Vector3(0, 3.3, 0))
    const worldUp = new THREE.Vector3(0, 1, 0)
    const m = new THREE.Matrix4().lookAt(eye, eye.clone().add(tangent), worldUp)
    const baseQuat = new THREE.Quaternion().setFromRotationMatrix(m)
    const lookQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch, this.lookYaw, 0, 'YXZ'))

    this.camera.position.copy(eye)
    this.camera.quaternion.copy(baseQuat).multiply(lookQuat)
  }

  private onResize() {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    // The animation loop won't pick up the new size on its own if it isn't
    // running (start screen / paused) — repaint once so a rotate mid-pause
    // doesn't leave a stale frame at the old dimensions.
    if (!this.running) this.renderOnce()
  }

  private tick() {
    const frameDt = Math.min(this.clock.getDelta(), MAX_FRAME_DT)
    // Train physics (position/speed integration, stop detection, scoring)
    // runs in FIXED steps via an accumulator — decoupled from the render
    // frame rate, so the exact same lever input produces the exact same
    // stop position and score on a stuttering phone as on a smooth one.
    // Below ~20fps, a variable dt clamped at the frame level would silently
    // run the simulation in slow motion instead; this catches up instead.
    this.physicsAccumulator = Math.min(this.physicsAccumulator + frameDt, FIXED_DT * MAX_CATCHUP_STEPS)
    while (this.physicsAccumulator >= FIXED_DT) {
      this.train.update(FIXED_DT)
      this.physicsAccumulator -= FIXED_DT
    }
    this.step(frameDt)
    this.renderer.render(this.scene, this.camera)
    this.updatePerfOverlay(frameDt)
  }

  /**
   * Presentation layer: runs once per rendered frame with the real frame
   * delta (not the fixed physics step) — camera, ambient visuals, audio and
   * UI only ever READ the train's state here, so nothing here needs to be
   * re-run per physics step.
   */
  private step(dt: number) {
    this.dayNight.update(dt * this.timeScale, this.camera.position)
    // Every window-lit material shares this: windows pop on one by one
    // through dusk as it rises from 0 to 1.
    WINDOW_DUSK_UNIFORM.value = this.dayNight.nightFactor
    this.city.update(dt, this.dayNight.nightFactor, this.train.targetStationIndex, this.dayNight.timeOfDay)
    this.scenery.update(dt, this.dayNight, this.train.progressFraction)
    // Kan-kan: one bell strike per blink flip while the crossing is active.
    if (this.scenery.crossingBlinkPhase !== this.lastCrossingPhase) {
      this.lastCrossingPhase = this.scenery.crossingBlinkPhase
      if (this.scenery.crossingBellActive) audio.crossingTick(0.7)
    }
    this.updateHeadlight()
    // Positional platform murmur: nearest station (ahead or just passed)
    // wins; louder for landmark hubs, panned toward the platform side.
    const distAhead = this.train.distanceToTarget
    const prevMarker = this.track.markerFor(this.train.currentStationIndex)
    const distBehind = (((this.train.progressFraction - prevMarker.tFraction) % 1) + 1) % 1 * this.track.getLength()
    // Unrolled (no per-frame array allocation, per Marco's rule).
    let murmurLevel = 0
    let murmurPan = 0
    const ahead = this.train.targetStation
    const behind = this.train.currentStation
    const levelAhead = Math.max(0, 1 - Math.min(distAhead / 180, 1)) * (ahead.landmark ? 1 : 0.55)
    const levelBehind = Math.max(0, 1 - Math.min(distBehind / 180, 1)) * (behind.landmark ? 1 : 0.55)
    if (levelAhead >= levelBehind && levelAhead > 0) {
      murmurLevel = levelAhead
      murmurPan = ahead.doorSide === 'left' ? -0.55 : 0.55
    } else if (levelBehind > 0) {
      murmurLevel = levelBehind
      murmurPan = behind.doorSide === 'left' ? -0.55 : 0.55
    }
    audio.updateAmbient(this.train.speed01, this.train.brakeAmount01, this.dayNight.timeOfDay, this.train.doorsOpenAmount, murmurLevel, murmurPan)
    this.controls.syncNotch(this.train.notch)
    this.updateCameraFromTrain()
    this.updateLever()
    this.ui.updateClock(this.dayNight.timeOfDay, this.dayNight.phaseLabel)
    // Progress along the current segment for the HUD's reference bar.
    const currentT = this.track.markerFor(this.train.currentStationIndex).tFraction
    const targetT = this.track.markerFor(this.train.targetStationIndex).tFraction
    const segLen = ((((targetT - currentT) % 1) + 1) % 1) * this.track.getLength() || 1
    const segmentProgress = THREE.MathUtils.clamp(1 - this.train.distanceToTarget / segLen, 0, 1)
    this.ui.updateTrain({
      speedKmh: this.train.speedKmh,
      notchLabel: notchLabel(this.train.notch),
      currentStationIdx: this.train.currentStationIndex,
      targetStationIdx: this.train.targetStationIndex,
      doorsOpenAmount: this.train.doorsOpenAmount,
      segmentProgress,
    })
  }
}
