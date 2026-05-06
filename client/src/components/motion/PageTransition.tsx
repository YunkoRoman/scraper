// client/src/components/motion/PageTransition.tsx
import { motion } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

export function PageTransition({ children }: Props) {
  const reduced = useReducedMotion()

  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : -6 }}
      transition={{ duration: 0.28, ease: [0.65, 0, 0.35, 1] }}
    >
      {children}
    </motion.div>
  )
}
