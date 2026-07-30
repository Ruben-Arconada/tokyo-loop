import * as THREE from 'three'
import type { PrecipProfile } from './Seasons'

// ————————————————————————————————————————————————————————————————
// Rain / snow as one instanced curtain that lives in a box around the
// camera. Positions are derived entirely in the vertex shader from a
// per-instance seed + CPU-accumulated fall/drift distances (wrapped into the
// box), so the per-frame CPU cost is a handful of uniform writes and nothing
// else — independent of world size, per the mobile-first weather plan.
//
// The curtain is drawn in the CAB's frame of reference, which is the whole
// point: what the driver sees is not the drop's fall but its APPARENT
// velocity — gravity plus wind minus the train's own motion. Standing at a
// platform, rain falls vertically past the window; at 90 km/h the very same
// rain is a near-horizontal streak. So the quad is built along that apparent
// velocity vector in view space, and stretched by its horizontal component:
// vertical drops when stopped, raked streaks at speed, and the same
// machinery turns snow from a slow flutter into a starfield rushing past.
// ————————————————————————————————————————————————————————————————

const COUNT = 1400
// Box the curtain recycles through, centered on the cab. Tall enough that
// streaks never visibly spawn, tight enough that every drop is near the eye.
const BOX = new THREE.Vector3(38, 26, 38)
/** Base fall speeds (world units/s) before the weather's fallScale. */
const RAIN_FALL = 18
const SNOW_FALL = 1.6
/** Gusts blow along a fixed compass bearing so a storm has one wind, not per-drop chaos. */
const WIND_DIR = new THREE.Vector2(Math.cos(0.7), Math.sin(0.7))

const VERTEX = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform float uFall;     // accumulated fall distance, wrapped into the box
uniform vec2 uDrift;     // accumulated horizontal drift (wind + train motion)
uniform vec3 uVel;       // apparent velocity of the precipitation in the cab's frame
uniform float uStretch;  // horizontal apparent speed — the global rake
uniform float uFallSpeed;// what "standing still" looks like, so gravity alone never stretches anything
uniform float uDensity;  // 0..1 fraction of instances kept alive
uniform vec3 uCamPos;
uniform float uSnow;     // 0 = rain, 1 = snow
uniform float uNearFade; // 1 in cab view: nothing falls INSIDE the cab
varying vec2 vUv;
varying float vRound;    // 1 = round flake, 0 = long streak
varying float vNear;     // proximity fade (see uNearFade)
void main() {
  vUv = uv;
  // Thinning out the curtain by hiding instances is what makes "drizzle vs
  // downpour" free: same buffers, same draw call, fewer live quads.
  float hash = fract(sin(dot(aSeed.xy, vec2(12.9898, 78.233))) * 43758.5453);
  if (hash > uDensity) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // outside the clip volume
    return;
  }
  vec3 box = vec3(${BOX.x.toFixed(1)}, ${BOX.y.toFixed(1)}, ${BOX.z.toFixed(1)});
  // Per-instance spread around the common fall distance, so drops don't
  // descend in lockstep. The distance itself is accumulated on the CPU:
  // multiplying a raw uTime by a changing speed would teleport every drop
  // the moment the weather (or the fall scale) shifted.
  // The five speeds are DISCRETE tenths on purpose: uFall is wrapped at
  // 10·box.y, so bias·uFall stays an exact multiple of the box height at the
  // wrap and no drop jumps when the accumulator rolls over.
  float bias = 0.8 + floor(aSeed.x * 4.999) * 0.1;
  vec3 p;
  p.x = mod(aSeed.x * box.x + uDrift.x + uSnow * sin(uTime * (0.8 + aSeed.z) + aSeed.y * 6.28) * 1.6, box.x) - box.x * 0.5;
  p.y = mod(aSeed.y * box.y - uFall * bias, box.y) - box.y * 0.5;
  p.z = mod(aSeed.z * box.z + uDrift.y + uSnow * cos(uTime * (0.6 + aSeed.x) + aSeed.x * 6.28) * 1.6, box.z) - box.z * 0.5;
  p += uCamPos;

  // Build the quad in VIEW space along the apparent velocity: the streak
  // always lies on the line the drop is actually tracing across the glass.
  vec4 mv = viewMatrix * vec4(p, 1.0);
  // View-space x/y IS the component of the motion that crosses the glass —
  // the part that smears. Looking forward at 95 km/h that's near zero dead
  // ahead and large at the edges, which is why real rain seen from a cab
  // radiates out of the vanishing point instead of raking uniformly.
  vec2 v = (mat3(viewMatrix) * uVel).xy;
  float vl = length(v);
  vec2 axis = vl > 0.0001 ? v / vl : vec2(0.0, -1.0);
  float width = mix(0.03, 0.075, uSnow);
  float crosswise = max(0.0, vl - uFallSpeed); // gravity alone must not stretch a standing drop
  float len = mix(0.5 + aSeed.y * 0.45, 0.075, uSnow)
    * (1.0 + crosswise * mix(0.06, 0.12, uSnow) + uStretch * mix(0.02, 0.05, uSnow));
  // NOTE: edge0 < edge1, then inverted. smoothstep with edge0 > edge1 is
  // UNDEFINED in GLSL — it returned NaN here and swallowed the whole curtain.
  vRound = 1.0 - smoothstep(1.15, 2.6, len / width);
  // In the cab the roof is real: a particle inside arm's reach is inside the
  // room, so it fades to nothing rather than hovering over the driver's desk.
  vNear = mix(1.0, smoothstep(1.3, 2.8, length(mv.xyz)), uNearFade);
  mv.xy += vec2(-axis.y, axis.x) * position.x * width + axis * (position.y - 0.5) * len;
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT = /* glsl */ `
uniform float uOpacity;
uniform vec3 uTint;
varying vec2 vUv;
varying float vRound;
varying float vNear;
void main() {
  // One quad, two readings: a soft-edged streak, or a round flake once the
  // thing is short enough to have no direction worth showing.
  float streak = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
  float flake = 1.0 - smoothstep(0.32, 0.5, length(vUv - 0.5));
  float a = mix(streak * 0.5, flake * 0.9, vRound) * uOpacity * vNear;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uTint, a);
}
`

export class Precipitation {
  /** 0 = off, 1 = full curtain; lerped smoothly by update(). */
  private targetIntensity = 0
  private intensity = 0
  private snowTarget = 0
  private densityTarget = 0
  private density = 0
  private windTarget = 0
  private wind = 0
  private fallScale = 1
  private mesh: THREE.Mesh
  /** Cab velocity, differentiated from the camera and smoothed — the train exposes km/h, but what matters here is the actual world-space direction of travel through the weather. */
  private camVel = new THREE.Vector3()
  private lastCamPos = new THREE.Vector3()
  private hasLastPos = false
  private fallDistance = 0
  private drift = new THREE.Vector2()
  private uniforms = {
    uTime: { value: 0 },
    uFall: { value: 0 },
    uDrift: { value: new THREE.Vector2() },
    uVel: { value: new THREE.Vector3(0, -RAIN_FALL, 0) },
    uStretch: { value: 0 },
    uFallSpeed: { value: RAIN_FALL },
    uDensity: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uSnow: { value: 0 },
    uOpacity: { value: 0 },
    uTint: { value: new THREE.Color(0xcfd8e4) },
    // 1 in the cab view: particles born between the eye and the windscreen
    // fade out instead of floating INSIDE the cab (Lena, round 2 — one flake
    // over the ceiling in the blizzard's star capture).
    uNearFade: { value: 0 },
  }

  /** The cab has a roof: fade particles that spawn inside arm's reach. */
  setCabView(on: boolean) {
    this.uniforms.uNearFade.value = on ? 1 : 0
  }

  constructor(scene: THREE.Scene) {
    const plane = new THREE.PlaneGeometry(1, 1)
    plane.translate(0, 0.5, 0)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = plane.index
    geo.attributes.position = plane.attributes.position
    geo.attributes.uv = plane.attributes.uv
    const seeds = new Float32Array(COUNT * 3)
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random() // 0..1; the shader scales by the box
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3))
    geo.instanceCount = COUNT
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      // The quad is laid out along the apparent-velocity axis, which points
      // DOWN — that mirrors the plane's winding and the whole curtain gets
      // backface-culled. Two-sided is the fix; for 1400 alpha quads it costs
      // nothing (they're never depth-written or lit).
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3 // over the clouds, under nothing that matters
    this.mesh.visible = false
    // Dynamic: the curtain reshuffles every frame.
    this.mesh.userData.dynamic = true
    scene.add(this.mesh)
  }

  /** Aim the curtain from the current weather profile (see Seasons.precipProfile) — cheap enough to call every frame. */
  set(p: PrecipProfile) {
    this.targetIntensity = p.falling ? 1 : 0
    this.snowTarget = p.snow ? 1 : 0
    this.densityTarget = p.density
    this.windTarget = p.wind
    this.fallScale = p.fallScale
  }

  update(dt: number, cameraPos: THREE.Vector3, nightFactor: number) {
    // Ease the fade, the rain↔snow costume swap, and the two weather dials.
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 1.4)
    this.uniforms.uSnow.value += (this.snowTarget - this.uniforms.uSnow.value) * Math.min(1, dt * 2)
    this.density += (this.densityTarget - this.density) * Math.min(1, dt * 1.2)
    this.wind += (this.windTarget - this.wind) * Math.min(1, dt * 0.7)

    // Differentiate the cab's position for its world velocity. Smoothed
    // because a single long frame would otherwise snap the whole curtain
    // sideways; clamped because a teleport (resize, resume) must not.
    if (this.hasLastPos && dt > 0) {
      const inst = SCRATCH_A.copy(cameraPos).sub(this.lastCamPos).divideScalar(dt)
      if (inst.lengthSq() > 3600) inst.setLength(60)
      this.camVel.lerp(inst, Math.min(1, dt * 6))
    }
    this.lastCamPos.copy(cameraPos)
    this.hasLastPos = true

    this.mesh.visible = this.intensity > 0.02
    if (!this.mesh.visible) return

    const snow = this.uniforms.uSnow.value
    const fallSpeed = THREE.MathUtils.lerp(RAIN_FALL, SNOW_FALL, snow) * this.fallScale
    // Gusts breathe rather than blow flat — two detuned sines, no allocation.
    const t = this.uniforms.uTime.value
    const gust = this.wind * (0.72 + 0.28 * Math.sin(t * 0.37) * Math.cos(t * 0.11))
    // Apparent horizontal air movement in the cab's frame: the wind it's
    // actually blowing, minus the train's own motion through it.
    const appX = WIND_DIR.x * gust - this.camVel.x
    const appZ = WIND_DIR.y * gust - this.camVel.z
    this.uniforms.uVel.value.set(appX, -fallSpeed, appZ)
    this.uniforms.uStretch.value = Math.hypot(appX, appZ)
    this.uniforms.uFallSpeed.value = fallSpeed

    // Accumulate the wrapped fall/drift distances (see the shader note).
    this.uniforms.uTime.value = t + dt
    this.fallDistance = (this.fallDistance + fallSpeed * dt) % (BOX.y * 10)
    this.drift.x = (this.drift.x + appX * dt) % BOX.x
    this.drift.y = (this.drift.y + appZ * dt) % BOX.z
    this.uniforms.uFall.value = this.fallDistance
    this.uniforms.uDrift.value.copy(this.drift)
    this.uniforms.uCamPos.value.copy(cameraPos)
    this.uniforms.uDensity.value = this.density
    // Long raked streaks cover more glass per drop: pull the alpha back as
    // they stretch, or a fast run through heavy rain turns into white paste.
    this.uniforms.uOpacity.value = this.intensity * (1 - 0.3 * Math.min(1, this.uniforms.uStretch.value / 30))
    // Rain reads darker by day, faintly luminous at night (city glow);
    // snow stays bright regardless.
    const l = THREE.MathUtils.lerp(0.62 - nightFactor * 0.25, 0.94, snow)
    ;(this.uniforms.uTint.value as THREE.Color).setHSL(0.58, 0.12, l)
  }
}

const SCRATCH_A = new THREE.Vector3()
