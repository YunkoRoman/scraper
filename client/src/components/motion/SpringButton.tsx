// client/src/components/motion/SpringButton.tsx
import { motion } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

const variantClasses = {
  primary: 'bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-50 disabled:cursor-not-allowed',
  success: 'bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed',
  danger:  'bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50 disabled:cursor-not-allowed',
  warning: 'bg-amber-500 hover:bg-amber-400 text-white disabled:opacity-50 disabled:cursor-not-allowed',
  ghost:   'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed',
} as const

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantClasses
  loading?: boolean
  children: ReactNode
}

export function SpringButton({
  variant = 'ghost',
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: Props) {
  const reduced = useReducedMotion()
  const isDisabled = disabled || loading

  return (
    <motion.button
      whileTap={reduced || isDisabled ? {} : { scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      disabled={isDisabled}
      className={`font-semibold rounded-lg transition-colors cursor-pointer ${variantClasses[variant]} ${className}`}
      {...(rest as object)}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-1.5">
          <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          {children}
        </span>
      ) : (
        children
      )}
    </motion.button>
  )
}
