import './style.css'
import { Game } from './game/Game'

const app = document.querySelector<HTMLDivElement>('#app')!
const game = new Game(app)

// Dev-only handle so tooling (and curious devs) can poke the running game
// from the console; stripped from production builds.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__game = game
}
