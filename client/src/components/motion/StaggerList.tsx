// client/src/components/motion/StaggerList.tsx
import { motion } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { ReactNode } from 'react'
import { dur, ease } from '../../design/tokens'

// eslint-disable-next-line react-refresh/only-export-components
export const staggerItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: dur.base, ease: ease.out },
  },
}

interface Props {
  children: ReactNode
  stagger?: number
  className?: string
}

export function StaggerList({ children, stagger = 0.05, className }: Props) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      className={className}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: reduced ? 0 : stagger } },
      }}
      initial="hidden"
      animate="show"
    >
      {children}
    </motion.div>
  )
}
