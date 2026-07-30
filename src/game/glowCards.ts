import * as THREE from 'three'

/**
 * Night halos — the Cloudpunk trick at Cloudpunk's real price, which is not a
 * bloom pass. Every lit fixture that already exists (neon columns, platform
 * lamps, paper lanterns) gets one soft additive billboard, all of them in ONE
 * instanced draw call that only exists after dusk.
 *
 * This is a POST-PASS over the built scene: it reads instance positions back
 * from the tagged pools and never rolls the world's dice, so the deterministic
 * world is byte-identical with or without it. The mesh itself is marked
 * `dynamic` — it is atmosphere, not the world, and the fingerprints and the
 * sectorizer both ignore it (same standing as the clouds).
 */

interface GlowSource {
  /** Regex over `userData.semanticGroup` of the pools to read. */
  match: RegExp
  /** Halo colour; null = per-design colour passed by the caller. */
  color: THREE.Color | null
  size: number
  /** Neon instances come as front/back pairs at one spot — take every 2nd. */
  stride: number
  yLift: number
}

const SOURCES: GlowSource[] = [
  { match: /^neon-signs-(\d+)$/, color: null, size: 7.2, stride: 2, yLift: 0 },
  { match: /^platform-lamp-bodies$/, color: new THREE.Color(0xfff2c0), size: 3.4, stride: 1, yLift: 0.05 },
  { match: /^platform-lanterns$/, color: new THREE.Color(0xffb64a), size: 2.3, stride: 1, yLift: 0 },
]

/** Soft round glow, drawn once — artwork with a fixed shape, not a die roll. */
function makeHaloTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 31)
  g.addColorStop(0, 'rgba(255,255,255,0.6)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.22)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.06)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.NoColorSpace
  return tex
}

const GLOW_VERTEX = /* glsl */ `
  attribute vec3 aPos;
  attribute float aSize;
  attribute vec3 aColor;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    vUv = uv;
    vColor = aColor;
    vec3 right = vec3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
    vec3 up = vec3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y);
    vec3 world = aPos + (right * position.x + up * position.y) * aSize;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    // Far clusters of halos would sum into a wall of light — fade them out
    // before they can gang up.
    vFade = 1.0 - smoothstep(550.0, 1300.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`

const GLOW_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uGlow;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float a = texture2D(uMap, vUv).a;
    if (vFade <= 0.001 || a <= 0.003) discard;
    gl_FragColor = vec4(vColor * (a * uGlow * vFade), 1.0);
  }
`

export class GlowCards {
  readonly mesh: THREE.Mesh | null
  private readonly uniforms = { uMap: { value: null as THREE.Texture | null }, uGlow: { value: 0 } }

  /**
   * @param neonColors halo colour per neon design index (the sign's tube
   * colour) — glowCards reads geometry back but should not guess art.
   */
  constructor(scene: THREE.Scene, neonColors: string[]) {
    scene.updateMatrixWorld(true)
    const pos: number[] = []
    const size: number[] = []
    const col: number[] = []
    const world = new THREE.Vector3()
    const mat = new THREE.Matrix4()
    const tint = new THREE.Color()
    scene.traverse((obj) => {
      const inst = obj as THREE.InstancedMesh
      if (!(inst as THREE.InstancedMesh).isInstancedMesh) return
      const group = (obj.userData.semanticGroup as string) ?? ''
      for (const src of SOURCES) {
        const m = group.match(src.match)
        if (!m) continue
        if (src.color) tint.copy(src.color)
        else tint.set(neonColors[Number(m[1])] ?? '#ffffff')
        for (let i = 0; i < inst.count; i += src.stride) {
          inst.getMatrixAt(i, mat)
          world.setFromMatrixPosition(mat).applyMatrix4(inst.matrixWorld)
          pos.push(world.x, world.y + src.yLift, world.z)
          // Neon halos scale with their sign (the matrix carries the scale);
          // fixed fixtures take their size as-is — reading the matrix column
          // on a ROTATED lamp inflated its halo by up to 41% (Marco, round 1).
          const s = src.color ? 1 : Math.max(0.6, Math.hypot(mat.elements[0], mat.elements[1], mat.elements[2]))
          size.push(src.size * s)
          col.push(tint.r, tint.g, tint.b)
        }
        break
      }
    })
    if (pos.length === 0) {
      this.mesh = null
      return
    }
    const quad = new THREE.PlaneGeometry(2, 2)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = quad.index
    geo.setAttribute('position', quad.getAttribute('position'))
    geo.setAttribute('uv', quad.getAttribute('uv'))
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(pos), 3))
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(new Float32Array(size), 1))
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(col), 3))
    geo.instanceCount = pos.length / 3
    this.uniforms.uMap.value = makeHaloTexture()
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: GLOW_VERTEX,
      fragmentShader: GLOW_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geo, material)
    // Spans the whole ring; culling a single draw call buys nothing.
    mesh.frustumCulled = false
    // Atmosphere, not world: out of the fingerprints and the sectorizer.
    mesh.userData.dynamic = true
    mesh.renderOrder = 2
    this.mesh = mesh
    scene.add(mesh)
  }

  /** Halos live between the first window and true night, like the windows do. */
  update(nightFactor: number) {
    if (!this.mesh) return
    const g = THREE.MathUtils.smoothstep(nightFactor, 0.12, 0.8)
    this.uniforms.uGlow.value = g
    this.mesh.visible = g > 0.01
  }
}
