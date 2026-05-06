// client/src/components/motion/AnimatedNumber.tsx
import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'

interface Props {
  value: number
  className?: string
}

export function AnimatedNumber({ value, className }: Props) {
  const reduced = useReducedMotion()
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)

  useEffect(() => {
    if (reduced || prevRef.current === value) {
      setDisplay(value)
      prevRef.current = value
      return
    }
    const from = prevRef.current
    prevRef.current = value
    const controls = animate(from, value, {
      duration: 0.6,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v)),
    })
    return () => controls.stop()
  }, [value, reduced])

  return <span className={className}>{display}</span>
}
