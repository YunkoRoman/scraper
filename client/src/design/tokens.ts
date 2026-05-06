// client/src/design/tokens.ts
import type { Transition } from 'framer-motion'

export const ease = {
  out:   [0.16, 1, 0.3, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
}

export const spring = {
  tight: { type: 'spring', stiffness: 380, damping: 30 } as Transition,
  soft:  { type: 'spring', stiffness: 200, damping: 22 } as Transition,
}

export const dur = { fast: 0.18, base: 0.28, slow: 0.45 }
