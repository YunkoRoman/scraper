// client/src/components/motion/FadeIn.tsx
import { motion } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { ElementType, ReactNode } from 'react'
import { dur, ease } from '../../design/tokens'

interface Props {
  children: ReactNode
  delay?: number
  y?: number
  as?: ElementType
  className?: string
}

export function FadeIn({ children, delay = 0, y = 8, as: Tag = 'div', className }: Props) {
  const reduced = useReducedMotion()
  const MotionTag = motion.create(Tag as 'div')

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : y }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        reduced
          ? { duration: 0.15 }
          : { duration: dur.base, delay, ease: ease.out }
      }
    >
      {children}
    </MotionTag>
  )
}
