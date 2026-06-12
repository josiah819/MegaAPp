// One motion vocabulary for the whole app — used everywhere so the product
// moves like a single piece of software, not a collage.
export const SWIFT = [0.22, 1, 0.36, 1]
export const SPRING = { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }
export const SPRING_SOFT = { type: 'spring', stiffness: 260, damping: 28 }

export const pageAnim = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: SWIFT } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.18, ease: 'easeIn' } },
}

export const stagger = (delay = 0.05) => ({
  animate: { transition: { staggerChildren: delay } },
})

export const rise = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: SWIFT } },
}

export const pop = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0, transition: SPRING },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: { duration: 0.15 } },
}

export const sheetUp = {
  initial: { y: '100%' },
  animate: { y: 0, transition: { type: 'spring', stiffness: 380, damping: 38 } },
  exit: { y: '100%', transition: { duration: 0.22, ease: 'easeIn' } },
}

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
}
