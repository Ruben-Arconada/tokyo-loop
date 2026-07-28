// ————————————————————————————————————————————————————————————————
// Watches canvas-built textures for their FIRST arrival on the GPU.
//
// This is its own module for one reason: it has to be testable without a GL
// context. The first version of it lived inline in Game, took its "already
// uploaded" baseline from a counter that had never run, and therefore booked
// every texture that was ALREADY resident as if the lap had just uploaded it —
// a fabricated spike on the first recorded frame, pointing at exactly the
// suspect we are trying to confirm. The tests around it passed because they
// handed it a baseline that was correct by construction, which is no test at
// all.
//
// The uploaded-ness check is injected, so a test can drive it with a plain
// predicate and the game can pass three's own texture bookkeeping.
// ————————————————————————————————————————————————————————————————

/** Minimal shape: this never touches anything else on a texture. */
export interface WatchableTexture {
  readonly uuid?: string
}

export class TextureUploadWatch<T extends WatchableTexture> {
  /** Textures whose upload we have not seen yet. Drains as they go resident, so the per-frame cost falls to nothing. */
  private pending = new Set<T>()
  /** Monotonic: every first upload ever seen, including the ones already done when we started looking. */
  private uploads = 0

  private readonly isUploaded: (tex: T) => boolean

  // Written out rather than a constructor parameter property: the project
  // builds with `erasableSyntaxOnly`, so the shorthand is a compile error.
  constructor(isUploaded: (tex: T) => boolean) {
    this.isUploaded = isUploaded
  }

  /**
   * Starts watching a texture. Safe to call again with the same one; calling
   * it with a REPLACEMENT (the destination roll is disposed and rebuilt at
   * every station) is what makes the replacement's upload countable, which the
   * renderer's resident total cannot see because one leaves as one arrives.
   */
  watch(tex: T | null | undefined) {
    if (tex) this.pending.add(tex)
  }

  /** Stops watching one that will never arrive — a texture disposed before it was ever drawn. */
  forget(tex: T | null | undefined) {
    if (tex) this.pending.delete(tex)
  }

  /**
   * Checks the pending ones and returns the running total. Deleting from a Set
   * while iterating it is defined behaviour, and once everything has arrived
   * the loop does not run at all.
   */
  poll(): number {
    if (this.pending.size) {
      for (const tex of this.pending) {
        if (this.isUploaded(tex)) {
          this.pending.delete(tex)
          this.uploads++
        }
      }
    }
    return this.uploads
  }

  /** The count as of now, without looking. */
  get total(): number {
    return this.uploads
  }

  /** How many are still waiting — 0 means this costs nothing per frame from here on. */
  get waiting(): number {
    return this.pending.size
  }
}
