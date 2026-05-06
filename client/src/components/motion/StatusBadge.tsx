// client/src/components/motion/StatusBadge.tsx
import { motion, AnimatePresence } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'

interface Props {
  /** Tailwind class string for bg + text color. Use values from design/status.ts */
  badgeClass: string
  /** Visible text label */
  label: string
  className?: string
}

export function StatusBadge({ badgeClass, label, className = '' }: Props) {
  const reduced = useReducedMotion()

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={label}
        initial={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.82 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={reduced ? { opacity: 1 } : { opacity: 0, scale: 0.82 }}
        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass} ${className}`}
      >
        {label}
      </motion.span>
    </AnimatePresence>
  )
}
