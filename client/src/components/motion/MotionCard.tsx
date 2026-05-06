// client/src/components/motion/MotionCard.tsx
import { motion } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { ReactNode } from 'react'
import { dur, ease } from '../../design/tokens'

// eslint-disable-next-line react-refresh/only-export-components
export const cardVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: dur.base, ease: ease.out },
  },
}

interface Props {
  children: ReactNode
  className?: string
  /**
   * When true: does not set initial/animate — lets a parent StaggerList control entry.
   * When false (default): plays own mount animation.
   */
  inheritVariants?: boolean
}

export function MotionCard({ children, className, inheritVariants = false }: Props) {
  const reduced = useReducedMotion()

  return (
    <motion.div
      className={className}
      variants={cardVariants}
      initial={inheritVariants ? undefined : 'hidden'}
      animate={inheritVariants ? undefined : 'show'}
      whileHover={reduced ? {} : { y: -2 }}
      whileTap={reduced ? {} : { scale: 0.98 }}
      style={{ willChange: 'transform' }}
    >
      {children}
    </motion.div>
  )
}
