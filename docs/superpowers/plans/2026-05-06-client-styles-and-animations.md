# Client Styles & Animations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retrofit the React client with playful-productivity aesthetics: framer-motion animations, multi-accent status palette, warmer shadows, and signature motion on all pages — zero core logic changes.

**Architecture:** New `src/design/` layer holds color/motion tokens and status maps. New `src/components/motion/` folder holds reusable animation primitives (FadeIn, StaggerList, MotionCard, SpringButton, StatusBadge, StatusDot, PageTransition, AnimatedNumber). Existing page components are refactored to consume primitives; no hooks, API, or state logic is touched.

**Tech Stack:** React 19, Tailwind v3, framer-motion (new), TypeScript, Vite 8

---

### Task 1: Install framer-motion and extend Tailwind config

**Files:**
- Modify: `client/package.json` (via npm)
- Modify: `client/tailwind.config.js`
- Modify: `client/src/index.css`

- [ ] **Step 1: Install framer-motion**

```bash
cd client && npm install framer-motion
```

Expected output: package added, `package-lock.json` updated, no peer-dep warnings.

- [ ] **Step 2: Update tailwind.config.js**

Replace the full file with:

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      boxShadow: {
        card: '0 1px 2px rgb(28 25 23 / 0.06), 0 4px 12px rgb(28 25 23 / 0.04)',
        'card-hover': '0 2px 4px rgb(28 25 23 / 0.08), 0 12px 24px rgb(28 25 23 / 0.08)',
        glow: '0 0 0 4px rgb(124 58 237 / 0.12)',
      },
      animation: {
        float: 'float 3s ease-in-out infinite',
        shimmer: 'shimmer 2.5s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-2px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 3: Add reduced-motion CSS guard to index.css**

Append to the end of `client/src/index.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 4: Verify build still passes**

```bash
cd client && npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 5: Commit**

```bash
cd client && git add package.json package-lock.json tailwind.config.js src/index.css
git commit -m "feat(client): install framer-motion, extend tailwind shadows and keyframes"
```

---

### Task 2: Create design token and status map files

**Files:**
- Create: `client/src/design/tokens.ts`
- Create: `client/src/design/status.ts`

- [ ] **Step 1: Create `src/design/tokens.ts`**

```ts
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
```

- [ ] **Step 2: Create `src/design/status.ts`**

```ts
// client/src/design/status.ts

// Parser-level status (used in ParserCard, StatusDot, StatusBadge)
export const PARSER_STATUS = {
  idle: {
    badge: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    dot:   'bg-gray-300 dark:bg-gray-500',
    label: 'Idle',
    pulse: false,
  },
  running: {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    dot:   'bg-amber-400',
    label: 'Running',
    pulse: true,
  },
  stopped: {
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
    dot:   'bg-orange-400',
    label: 'Stopped',
    pulse: false,
  },
  complete: {
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    dot:   'bg-emerald-400',
    label: 'Complete',
    pulse: false,
  },
  error: {
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300',
    dot:   'bg-rose-400',
    label: 'Error',
    pulse: false,
  },
} as const satisfies Record<string, { badge: string; dot: string; label: string; pulse: boolean }>

// Job-level status (used in JobsPage)
export const JOB_STATUS = {
  running: {
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
    label: 'Running',
    pulse: true,
  },
  stopped: {
    badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
    label: 'Stopped',
    pulse: false,
  },
  completed: {
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    label: 'Completed',
    pulse: false,
  },
  failed: {
    badge: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400',
    label: 'Failed',
    pulse: false,
  },
} as const satisfies Record<string, { badge: string; label: string; pulse: boolean }>

// Task-level state (used in JobDetailPage, TaskDetailPage)
export const TASK_STATE = {
  pending: {
    badge: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    label: 'Pending',
    pulse: false,
  },
  in_progress: {
    badge: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300',
    label: 'In Progress',
    pulse: true,
  },
  retry: {
    badge: 'bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-300',
    label: 'Retry',
    pulse: false,
  },
  success: {
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
    label: 'Success',
    pulse: false,
  },
  failed: {
    badge: 'bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400',
    label: 'Failed',
    pulse: false,
  },
  aborted: {
    badge: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    label: 'Aborted',
    pulse: false,
  },
} as const satisfies Record<string, { badge: string; label: string; pulse: boolean }>

// Fallback for unknown status keys
export const UNKNOWN_STATUS = {
  badge: 'bg-gray-100 text-gray-600',
  dot:   'bg-gray-300',
  label: 'Unknown',
  pulse: false,
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/design/
git commit -m "feat(client): add design tokens and centralised status maps"
```

---

### Task 3: Motion primitives — FadeIn, StaggerList, useReducedMotion

**Files:**
- Create: `client/src/hooks/useReducedMotion.ts`
- Create: `client/src/components/motion/FadeIn.tsx`
- Create: `client/src/components/motion/StaggerList.tsx`

- [ ] **Step 1: Create `src/hooks/useReducedMotion.ts`**

```ts
// client/src/hooks/useReducedMotion.ts
export { useReducedMotion } from 'framer-motion'
```

- [ ] **Step 2: Create `src/components/motion/FadeIn.tsx`**

```tsx
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
```

- [ ] **Step 3: Create `src/components/motion/StaggerList.tsx`**

```tsx
// client/src/components/motion/StaggerList.tsx
import { motion } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { ReactNode } from 'react'
import { dur, ease } from '../../design/tokens'

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
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useReducedMotion.ts client/src/components/motion/
git commit -m "feat(client): add FadeIn, StaggerList, useReducedMotion primitives"
```

---

### Task 4: Motion primitives — MotionCard, SpringButton

**Files:**
- Create: `client/src/components/motion/MotionCard.tsx`
- Create: `client/src/components/motion/SpringButton.tsx`

- [ ] **Step 1: Create `src/components/motion/MotionCard.tsx`**

```tsx
// client/src/components/motion/MotionCard.tsx
import { motion } from 'framer-motion'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import type { ReactNode } from 'react'
import { dur, ease } from '../../design/tokens'

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
```

- [ ] **Step 2: Create `src/components/motion/SpringButton.tsx`**

```tsx
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
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/motion/MotionCard.tsx client/src/components/motion/SpringButton.tsx
git commit -m "feat(client): add MotionCard and SpringButton primitives"
```

---

### Task 5: Motion primitives — StatusBadge, StatusDot, PageTransition, AnimatedNumber

**Files:**
- Create: `client/src/components/motion/StatusBadge.tsx`
- Create: `client/src/components/motion/StatusDot.tsx`
- Create: `client/src/components/motion/PageTransition.tsx`
- Create: `client/src/components/motion/AnimatedNumber.tsx`

- [ ] **Step 1: Create `src/components/motion/StatusBadge.tsx`**

```tsx
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
```

- [ ] **Step 2: Create `src/components/motion/StatusDot.tsx`**

```tsx
// client/src/components/motion/StatusDot.tsx

interface Props {
  /** Tailwind class for the dot color, e.g. 'bg-amber-400' */
  dotClass: string
  /** Show a ping ring animation (for running state) */
  pulse?: boolean
}

export function StatusDot({ dotClass, pulse = false }: Props) {
  return (
    <span className="relative flex shrink-0 w-2 h-2" aria-hidden="true">
      {pulse && (
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotClass}`}
        />
      )}
      <span className={`relative inline-flex rounded-full w-2 h-2 ${dotClass}`} />
    </span>
  )
}
```

- [ ] **Step 3: Create `src/components/motion/PageTransition.tsx`**

```tsx
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
```

- [ ] **Step 4: Create `src/components/motion/AnimatedNumber.tsx`**

```tsx
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
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/motion/
git commit -m "feat(client): add StatusBadge, StatusDot, PageTransition, AnimatedNumber primitives"
```

---

### Task 6: Update App.tsx

**Files:**
- Modify: `client/src/App.tsx`

Key changes: animated logo, nav underline effect, animated theme toggle, `AnimatePresence`/`PageTransition` on pages, `StaggerList` + `staggerItemVariants` on parser grid, `SpringButton` for "+ New Parser".

- [ ] **Step 1: Replace `client/src/App.tsx` with the updated version**

```tsx
// client/src/App.tsx
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { listParsers } from './api'
import { ParserCard } from './components/ParserCard'
import { DebugPage } from './components/DebugPage'
import { ParserEditorPage } from './components/ParserEditorPage'
import { JobsPage } from './components/JobsPage'
import { JobDetailPage } from './components/JobDetailPage'
import { TaskDetailPage } from './components/TaskDetailPage'
import { useTheme } from './hooks/useTheme'
import { PageTransition } from './components/motion/PageTransition'
import { StaggerList, staggerItemVariants } from './components/motion/StaggerList'
import { SpringButton } from './components/motion/SpringButton'
import { useReducedMotion } from './hooks/useReducedMotion'

function SunIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

type Page = 'parsers' | 'debug' | 'editor' | 'jobs' | 'job-detail' | 'task-detail'

function getPageFromHash(): Page {
  const hash = window.location.hash
  if (hash === '#/debug') return 'debug'
  if (hash.startsWith('#/editor/')) return 'editor'
  if (hash.match(/^#\/jobs\/[^/]+\/tasks\//)) return 'task-detail'
  if (hash.startsWith('#/jobs/')) return 'job-detail'
  if (hash === '#/jobs') return 'jobs'
  return 'parsers'
}

function getEditorParserFromHash(): string {
  const hash = window.location.hash
  if (hash.startsWith('#/editor/')) return decodeURIComponent(hash.slice(9))
  return ''
}

function getJobRunIdFromHash(): string {
  const hash = window.location.hash
  if (hash.startsWith('#/jobs/')) {
    const rest = hash.slice(7)
    return decodeURIComponent(rest.split('/')[0])
  }
  return ''
}

function getTaskIdFromHash(): string {
  const match = window.location.hash.match(/^#\/jobs\/[^/]+\/tasks\/(.+)$/)
  return match ? decodeURIComponent(match[1]) : ''
}

function NavButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
        active
          ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
      }`}
    >
      {children}
      {active && (
        <motion.span
          layoutId="nav-underline"
          className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-emerald-500"
        />
      )}
    </button>
  )
}

export default function App() {
  const [parsers, setParsers] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>(getPageFromHash)
  const [editorParser, setEditorParser] = useState<string>(getEditorParserFromHash)
  const [jobRunId, setJobRunId] = useState<string>(getJobRunIdFromHash)
  const [jobTaskId, setJobTaskId] = useState<string>(getTaskIdFromHash)
  const { theme, toggle } = useTheme()
  const reduced = useReducedMotion()

  useEffect(() => {
    listParsers()
      .then(setParsers)
      .catch(() => setApiError('Could not connect to API. Is the server running?'))
  }, [])

  useEffect(() => {
    const handler = () => {
      setPage(getPageFromHash())
      setEditorParser(getEditorParserFromHash())
      setJobRunId(getJobRunIdFromHash())
      setJobTaskId(getTaskIdFromHash())
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  function navigate(p: Page, param?: string) {
    if (p === 'editor') {
      window.location.hash = param ? `#/editor/${encodeURIComponent(param)}` : '#/editor/'
      setEditorParser(param ?? '')
    } else if (p === 'debug') {
      window.location.hash = '#/debug'
    } else if (p === 'jobs') {
      window.location.hash = '#/jobs'
    } else if (p === 'job-detail' && param) {
      window.location.hash = `#/jobs/${encodeURIComponent(param)}`
      setJobRunId(param)
    } else if (p === 'task-detail' && param) {
      const colonIdx = param.indexOf(':')
      const rId = param.slice(0, colonIdx)
      const tId = param.slice(colonIdx + 1)
      window.location.hash = `#/jobs/${encodeURIComponent(rId)}/tasks/${encodeURIComponent(tId)}`
      setJobRunId(rId)
      setJobTaskId(tId)
    } else {
      window.location.hash = '#/'
    }
    setPage(p)
  }

  function renderPage() {
    if (apiError) {
      return (
        <div className="px-4 sm:px-6 lg:px-8 py-5">
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
            <p className="text-red-500 dark:text-red-400 font-medium">{apiError}</p>
            <p className="text-gray-500 text-sm mt-2">
              Run:{' '}
              <code className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-gray-700 dark:text-gray-300 text-xs font-mono">
                npm run api
              </code>
            </p>
          </div>
        </div>
      )
    }
    if (page === 'editor') {
      return (
        <ParserEditorPage
          parserName={editorParser}
          onNavigateToParsers={() => navigate('parsers')}
          onParserSelect={(name) => navigate('editor', name)}
        />
      )
    }
    if (page === 'debug') return <DebugPage />
    if (page === 'jobs') return <JobsPage onViewJob={(runId) => navigate('job-detail', runId)} />
    if (page === 'job-detail') {
      return (
        <JobDetailPage
          runId={jobRunId}
          onBack={() => navigate('jobs')}
          onViewTask={(taskId) => navigate('task-detail', `${jobRunId}:${taskId}`)}
        />
      )
    }
    if (page === 'task-detail') {
      return (
        <TaskDetailPage runId={jobRunId} taskId={jobTaskId} onBack={() => navigate('job-detail', jobRunId)} />
      )
    }
    if (parsers.length === 0) {
      return (
        <div className="text-center py-20 text-gray-400 dark:text-gray-600">
          <p className="text-lg">No parsers found</p>
          <p className="text-sm mt-1">
            Add a parser directory under{' '}
            <code className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-gray-500 dark:text-gray-400 text-xs font-mono">
              src/parsers/
            </code>
          </p>
        </div>
      )
    }
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">
            {parsers.length} parser{parsers.length !== 1 ? 's' : ''}
          </span>
          <SpringButton
            variant="primary"
            onClick={() => navigate('editor', '')}
            className="px-3 py-1.5 text-sm"
          >
            + New Parser
          </SpringButton>
        </div>
        <StaggerList stagger={0.04} className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {parsers.map((name) => (
            <motion.div key={name} variants={staggerItemVariants}>
              <ParserCard name={name} onEdit={() => navigate('editor', name)} onViewJob={() => navigate('jobs')} />
            </motion.div>
          ))}
        </StaggerList>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white transition-colors duration-200">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        {/* Gradient accent strip */}
        <div className="h-0.5 bg-gradient-to-r from-violet-500 via-emerald-500 to-violet-500 bg-[length:200%_100%]" />
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center gap-3">
          {/* Animated logo */}
          <div className={`w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0 ${reduced ? '' : 'animate-float'}`}>
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-base sm:text-lg font-extrabold tracking-tight m-0 text-gray-900 dark:text-white">
            Scraper Platform
          </h1>

          {/* Nav */}
          <nav className="flex items-center gap-1 ml-4">
            <NavButton
              active={page === 'parsers' || page === 'editor'}
              onClick={() => navigate('parsers')}
            >
              Parsers
            </NavButton>
            <NavButton
              active={page === 'jobs' || page === 'job-detail' || page === 'task-detail'}
              onClick={() => navigate('jobs')}
            >
              Jobs
            </NavButton>
          </nav>

          <span className="ml-auto" />
          {/* Theme toggle with animated icon swap */}
          <button
            onClick={toggle}
            className="ml-2 sm:ml-3 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors flex items-center justify-center overflow-hidden"
            aria-label={`Toggle theme (current: ${theme})`}
            title={`Theme: ${theme}`}
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={theme}
                initial={reduced ? { opacity: 1 } : { opacity: 0, rotate: -30 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, rotate: 30 }}
                transition={{ duration: 0.2 }}
              >
                {theme === 'system' ? <MonitorIcon /> : theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </header>

      {/* Main with page transitions */}
      <main className="w-full">
        <AnimatePresence mode="wait">
          <PageTransition key={page}>
            {renderPage()}
          </PageTransition>
        </AnimatePresence>
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles and dev server starts**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

```bash
cd client && npm run dev &
sleep 3 && curl -s http://localhost:5173 | grep -c 'id="root"'
kill %1
```

Expected: output `1`.

- [ ] **Step 3: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat(client): animated header, nav underline, page transitions, parser grid stagger"
```

---

### Task 7: Update ParserCard.tsx and StatsPanel.tsx

**Files:**
- Modify: `client/src/components/ParserCard.tsx`
- Modify: `client/src/components/StatsPanel.tsx`

- [ ] **Step 1: Replace `client/src/components/ParserCard.tsx`**

```tsx
// client/src/components/ParserCard.tsx
import { useState, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StatsPanel } from './StatsPanel'
import { startParser, stopParser, resumeParser, listFiles, downloadFile, getStatus, type RunStats } from '../api'
import type { OutputFile } from '../api'
import { PARSER_STATUS, UNKNOWN_STATUS } from '../design/status'
import { StatusDot } from './motion/StatusDot'
import { StatusBadge } from './motion/StatusBadge'
import { SpringButton } from './motion/SpringButton'
import { MotionCard } from './motion/MotionCard'
import { staggerItemVariants } from './motion/StaggerList'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface Props {
  name: string
  onEdit: () => void
  onViewJob: () => void
}

export function ParserCard({ name, onEdit, onViewJob }: Props) {
  const [status, setStatus] = useState<'idle'|'running'|'stopped'|'complete'|'error'>('idle')
  const [stats, setStats] = useState<RunStats | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<OutputFile[]>([])
  const reduced = useReducedMotion()

  const refreshStatus = async () => {
    try {
      const data = await getStatus(name)
      const newStatus = data.running ? 'running' : (data.stats ? 'complete' : 'idle')
      if (status === 'running' && newStatus !== 'running') {
        listFiles(name).then(setFiles).catch(() => {})
      }
      setStatus(newStatus)
      setStats(data.stats)
    } catch (err) {
      console.error('Failed to get status:', err)
    }
  }

  useEffect(() => {
    refreshStatus()
    listFiles(name).then(setFiles).catch(() => setFiles([]))
    const interval = setInterval(() => { refreshStatus() }, 2000)
    return () => clearInterval(interval)
  }, [name])

  async function handleRun() {
    setLoading(true); setErrorMessage(null)
    try { await startParser(name); setStatus('running') }
    catch (err) { console.error(err); setErrorMessage((err as Error).message) }
    finally { setLoading(false) }
  }

  async function handleStop() {
    setLoading(true); setErrorMessage(null)
    try { await stopParser(name); setStatus('stopped') }
    catch (err) { console.error(err); setErrorMessage((err as Error).message) }
    finally { setLoading(false) }
  }

  async function handleResume() {
    setLoading(true); setErrorMessage(null)
    try { await resumeParser(name); setStatus('running') }
    catch (err) { console.error(err); setErrorMessage((err as Error).message) }
    finally { setLoading(false) }
  }

  const isRunning = status === 'running'
  const isStopped = status === 'stopped'
  const statusConfig = PARSER_STATUS[status] ?? UNKNOWN_STATUS

  return (
    <MotionCard className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 sm:p-5 flex flex-col gap-3 shadow-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot dotClass={statusConfig.dot} pulse={statusConfig.pulse} />
          <h2 className="text-gray-900 dark:text-white font-semibold text-base tracking-wide m-0 truncate">{name}</h2>
        </div>
        <StatusBadge badgeClass={statusConfig.badge} label={statusConfig.label} />
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onViewJob} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-blue-100 dark:hover:bg-blue-900 text-gray-600 dark:text-gray-300 hover:text-blue-700 dark:hover:text-blue-300 transition-colors" title="View Jobs">
            Jobs
          </button>
          <button onClick={onEdit} className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-emerald-100 dark:hover:bg-emerald-900 text-gray-600 dark:text-gray-300 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors">
            Edit
          </button>
        </div>
      </div>

      {/* Error message — animated */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded px-3 py-2"
          >
            {errorMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {stats && <StatsPanel stats={stats} />}

      {/* Actions */}
      <div className="flex gap-2 mt-auto pt-1">
        {isRunning ? (
          <SpringButton variant="danger" onClick={handleStop} loading={loading} className="flex-1 text-sm py-2.5 px-4">
            {loading ? 'Stopping…' : 'Stop'}
          </SpringButton>
        ) : isStopped ? (
          <>
            <SpringButton variant="warning" onClick={handleResume} loading={loading} className="flex-1 text-sm py-2.5 px-4">
              {loading ? 'Resuming…' : 'Resume'}
            </SpringButton>
            <SpringButton variant="ghost" onClick={handleRun} disabled={loading} className="px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300">
              Run Fresh
            </SpringButton>
          </>
        ) : (
          <SpringButton variant="success" onClick={handleRun} loading={loading} className="flex-1 text-sm py-2.5 px-4">
            {loading ? 'Starting…' : 'Run'}
          </SpringButton>
        )}
      </div>

      {/* Output files — stagger in */}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.28 }}
            className="border-t border-gray-100 dark:border-gray-700 pt-3 overflow-hidden"
          >
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 font-medium uppercase tracking-wider">Output files</p>
            <motion.div
              className="space-y-1"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05 } } }}
              initial="hidden"
              animate="show"
            >
              {files.map((f) => (
                <motion.button
                  key={f.name}
                  variants={staggerItemVariants}
                  onClick={() => downloadFile(name, f.name)}
                  className="w-full flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-900/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 transition-colors group"
                >
                  <span className="text-gray-700 dark:text-gray-300 font-mono truncate">{f.name}</span>
                  <span className="text-gray-400 dark:text-gray-500 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 ml-2 shrink-0 flex items-center gap-1">
                    {formatBytes(f.size)}
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </span>
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionCard>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
```

- [ ] **Step 2: Update `client/src/components/StatsPanel.tsx` with AnimatedNumber**

Replace the file with:

```tsx
// client/src/components/StatsPanel.tsx
import type { RunStats } from '../api'
import { AnimatedNumber } from './motion/AnimatedNumber'

interface Props {
  stats: RunStats
}

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
      <div
        className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function StatRow({
  label, total, success, failed, extra,
}: {
  label: string; total: number; success: number; failed: number; extra?: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs gap-1">
        <span className="text-gray-500 dark:text-gray-400 font-medium w-20 shrink-0">{label}</span>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 justify-end text-gray-600 dark:text-gray-300">
          <span>
            <span className="text-gray-400 dark:text-gray-500">Total </span>
            <AnimatedNumber value={total} className="font-mono font-semibold text-gray-900 dark:text-white" />
          </span>
          <span>
            <span className="text-gray-400 dark:text-gray-500">OK </span>
            <AnimatedNumber value={success} className="font-mono font-semibold text-emerald-600 dark:text-emerald-400" />
          </span>
          {failed > 0 && (
            <span>
              <span className="text-gray-400 dark:text-gray-500">Fail </span>
              <AnimatedNumber value={failed} className="font-mono font-semibold text-red-600 dark:text-red-400" />
            </span>
          )}
          {extra}
        </div>
      </div>
      <ProgressBar value={success} total={total} />
    </div>
  )
}

export function StatsPanel({ stats }: Props) {
  return (
    <div className="space-y-3 mt-1 bg-gray-50 dark:bg-gray-900/60 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
      <StatRow
        label="Pages"
        total={stats.total}
        success={stats.success}
        failed={stats.failed}
        extra={
          stats.inProgress > 0 ? (
            <span>
              <span className="text-gray-400 dark:text-gray-500">Active </span>
              <AnimatedNumber value={stats.inProgress} className="font-mono font-semibold text-amber-600 dark:text-amber-400" />
            </span>
          ) : null
        }
      />
      <StatRow label="Traversers" total={stats.traversers.total} success={stats.traversers.success} failed={stats.traversers.failed} />
      <StatRow label="Extractors" total={stats.extractors.total} success={stats.extractors.success} failed={stats.extractors.failed} />
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ParserCard.tsx client/src/components/StatsPanel.tsx
git commit -m "feat(client): animate ParserCard with MotionCard, SpringButton, StatusBadge, file stagger, count-up stats"
```

---

### Task 8: Update JobsPage.tsx

**Files:**
- Modify: `client/src/components/JobsPage.tsx`

- [ ] **Step 1: Replace `client/src/components/JobsPage.tsx`**

```tsx
// client/src/components/JobsPage.tsx
import { useEffect, useState, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { listJobs } from '../api'
import type { RunInfo } from '../api'
import { JOB_STATUS, UNKNOWN_STATUS } from '../design/status'
import { StatusBadge } from './motion/StatusBadge'
import { SpringButton } from './motion/SpringButton'
import { FadeIn } from './motion/FadeIn'
import { staggerItemVariants } from './motion/StaggerList'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface Props {
  onViewJob: (runId: string) => void
}

export function JobsPage({ onViewJob }: Props) {
  const [runs, setRuns] = useState<RunInfo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [refreshSpin, setRefreshSpin] = useState(false)
  const reduced = useReducedMotion()
  const LIMIT = 50

  const load = useCallback(async (p: number) => {
    setLoading(true)
    try {
      const result = await listJobs(p, LIMIT)
      setRuns(result.runs)
      setTotal(result.total)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(page) }, [load, page])

  useEffect(() => {
    const hasRunning = runs.some((r) => r.status === 'running')
    if (!hasRunning) return
    const id = setInterval(() => load(page), 3000)
    return () => clearInterval(id)
  }, [runs, load, page])

  function handleRefresh() {
    setRefreshSpin(true)
    load(page).then(() => setRefreshSpin(false))
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString()
  }

  function formatDuration(run: RunInfo) {
    if (!run.stoppedAt) return '—'
    const ms = new Date(run.stoppedAt).getTime() - new Date(run.startedAt).getTime()
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6">
      <FadeIn>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Jobs <span className="text-sm font-normal text-gray-500 ml-1">({total})</span>
          </h2>
          <SpringButton
            variant="ghost"
            onClick={handleRefresh}
            className="text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            <motion.svg
              animate={refreshSpin && !reduced ? { rotate: 360 } : { rotate: 0 }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
              onAnimationComplete={() => setRefreshSpin(false)}
              className="w-3.5 h-3.5"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </motion.svg>
            Refresh
          </SpringButton>
        </div>
      </FadeIn>

      {loading && runs.length === 0 ? (
        <p className="text-center text-gray-400 py-12">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-center text-gray-400 py-12">No jobs yet. Run a parser to see jobs here.</p>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-800 text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Parser</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Started</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tasks</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Failed</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <motion.tbody
              className="divide-y divide-gray-100 dark:divide-gray-700/50"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.025 } } }}
              initial="hidden"
              animate="show"
            >
              {runs.map((run) => {
                const sc = JOB_STATUS[run.status as keyof typeof JOB_STATUS] ?? UNKNOWN_STATUS
                return (
                  <motion.tr
                    key={run.id}
                    variants={staggerItemVariants}
                    className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{run.parserName}</td>
                    <td className="px-4 py-3">
                      <StatusBadge badgeClass={sc.badge} label={sc.label} />
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDate(run.startedAt)}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">{formatDuration(run)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-mono text-xs">
                      {run.stats ? `${run.stats.success}/${run.stats.total}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {(run.stats?.failed ?? 0) > 0 ? (
                        <span className="text-xs text-rose-500 font-medium">{run.stats!.failed}</span>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SpringButton
                        variant="ghost"
                        onClick={() => onViewJob(run.id)}
                        className="text-xs px-3 py-1.5 hover:bg-emerald-100 dark:hover:bg-emerald-900 hover:text-emerald-700 dark:hover:text-emerald-300"
                      >
                        View
                      </SpringButton>
                    </td>
                  </motion.tr>
                )
              })}
            </motion.tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (() => {
        const totalPages = Math.ceil(total / LIMIT)

        function goTo(p: number) {
          setPage(p)
          load(p)
        }

        function pageNumbers(): (number | '…')[] {
          if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
          const pages: (number | '…')[] = [1]
          if (page > 3) pages.push('…')
          for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p++) pages.push(p)
          if (page < totalPages - 2) pages.push('…')
          pages.push(totalPages)
          return pages
        }

        return (
          <div className="flex items-center justify-center gap-1 mt-4">
            <SpringButton
              variant="ghost"
              onClick={() => goTo(page - 1)}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700"
            >
              ←
            </SpringButton>
            {pageNumbers().map((p, i) =>
              p === '…' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm">…</span>
              ) : (
                <SpringButton
                  key={p}
                  variant={p === page ? 'success' : 'ghost'}
                  onClick={() => goTo(p as number)}
                  className="w-8 h-8 text-sm"
                >
                  {p}
                </SpringButton>
              )
            )}
            <SpringButton
              variant="ghost"
              onClick={() => goTo(page + 1)}
              disabled={page >= totalPages}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700"
            >
              →
            </SpringButton>
          </div>
        )
      })()}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/JobsPage.tsx
git commit -m "feat(client): animate JobsPage with row stagger, StatusBadge, SpringButton, refresh spin"
```

---

### Task 9: Update JobDetailPage.tsx

**Files:**
- Modify: `client/src/components/JobDetailPage.tsx`

Key changes: FadeIn on header, SpringButton for actions, StatusBadge for task states in table, task detail side-panel slides in via AnimatePresence.

- [ ] **Step 1: Add imports and update header + action buttons in `JobDetailPage.tsx`**

Also update the back button (currently `<button onClick={onBack} className="text-gray-400 ...">←</button>`) to a motion button with hover nudge:

```tsx
<motion.button
  onClick={onBack}
  whileHover={{ x: -3 }}
  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none font-bold"
>
  ←
</motion.button>
```

At the top of the file, replace the existing import block with:

```tsx
import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { getJob, getJobTasks, getTaskResult, stopJob, resumeJob, retryTask, retryAllFailed } from '../api'
import type { RunInfo, TaskRow } from '../api'
import { TASK_STATE, UNKNOWN_STATUS } from '../design/status'
import { StatusBadge } from './motion/StatusBadge'
import { SpringButton } from './motion/SpringButton'
import { FadeIn } from './motion/FadeIn'
import { staggerItemVariants } from './motion/StaggerList'
import { useReducedMotion } from '../hooks/useReducedMotion'
```

- [ ] **Step 2: Remove `STATE_BADGE` constant** (now provided by `TASK_STATE` from `design/status.ts`)

Delete these lines (lines 5–12):
```ts
const STATE_BADGE: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300 animate-pulse',
  retry:       'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-300',
  success:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  failed:      'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400',
  aborted:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}
```

- [ ] **Step 3: Add `reduced` from `useReducedMotion` inside the component**

After the last `useState` line in `JobDetailPage`, add:
```tsx
const reduced = useReducedMotion()
```

- [ ] **Step 4: Update the header div (the `<div className="px-4 sm:px-6 py-4 border-b ...">`) to use FadeIn**

Replace:
```tsx
<div className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
```
With:
```tsx
<FadeIn as="div" className="px-4 sm:px-6 py-4 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shrink-0">
```
And close the corresponding `</div>` → `</FadeIn>`.

- [ ] **Step 5: Replace action buttons with SpringButton**

Replace the Stop Job button:
```tsx
<button onClick={handleStop} disabled={actionLoading}
  className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-50 transition-colors">
  {actionLoading ? 'Stopping…' : 'Stop Job'}
</button>
```
With:
```tsx
<SpringButton variant="danger" onClick={handleStop} loading={actionLoading} className="text-xs px-3 py-1.5">
  {actionLoading ? 'Stopping…' : 'Stop Job'}
</SpringButton>
```

Replace the Resume Job button:
```tsx
<button onClick={handleResume} disabled={actionLoading}
  className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-semibold disabled:opacity-50 transition-colors">
  {actionLoading ? 'Resuming…' : 'Resume Job'}
</button>
```
With:
```tsx
<SpringButton variant="warning" onClick={handleResume} loading={actionLoading} className="text-xs px-3 py-1.5">
  {actionLoading ? 'Resuming…' : 'Resume Job'}
</SpringButton>
```

Replace the Retry Failed button:
```tsx
<button onClick={handleRetryAllFailed} disabled={actionLoading}
  className="text-xs px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold disabled:opacity-50 transition-colors">
  {actionLoading ? 'Starting…' : `Retry Failed (${stats!.failed})`}
</button>
```
With:
```tsx
<SpringButton variant="warning" onClick={handleRetryAllFailed} loading={actionLoading} className="text-xs px-3 py-1.5">
  {actionLoading ? 'Starting…' : `Retry Failed (${stats!.failed})`}
</SpringButton>
```

Replace the Refresh button:
```tsx
<button onClick={() => { loadRun(); loadTasks(page, statusFilter) }}
  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
  Refresh
</button>
```
With:
```tsx
<SpringButton variant="ghost" onClick={() => { loadRun(); loadTasks(page, statusFilter) }} className="text-xs px-3 py-1.5">
  Refresh
</SpringButton>
```

- [ ] **Step 6: Update task table rows to use StatusBadge + motion.tr**

Replace the `<tbody>` element and its content. Find:
```tsx
<tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
  {tasks.map((task) => (
    <tr key={task.id}
```
Replace with:
```tsx
<motion.tbody
  className="divide-y divide-gray-100 dark:divide-gray-700/50"
  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.02 } } }}
  initial="hidden"
  animate="show"
>
  {tasks.map((task) => {
    const sc = TASK_STATE[task.state as keyof typeof TASK_STATE] ?? UNKNOWN_STATUS
    return (
    <motion.tr key={task.id}
      variants={staggerItemVariants}
```

And close with `})}`  `</motion.tbody>` instead of `})}` `</tbody>`.

Inside the row, replace the status badge `<span>`:
```tsx
<span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_BADGE[task.state] ?? ''}`}>
  {task.state}
</span>
```
With:
```tsx
<StatusBadge badgeClass={sc.badge} label={sc.label} />
```

Replace the task detail side panel status badge (in `selectedTask` detail panel):
```tsx
<span className={`px-2 py-0.5 rounded-full font-medium ${STATE_BADGE[selectedTask.state] ?? ''}`}>
  {selectedTask.state}
</span>
```
With:
```tsx
{(() => {
  const sc = TASK_STATE[selectedTask.state as keyof typeof TASK_STATE] ?? UNKNOWN_STATUS
  return <StatusBadge badgeClass={sc.badge} label={sc.label} />
})()}
```

- [ ] **Step 7: Wrap the task detail side-panel in AnimatePresence**

Find:
```tsx
{selectedTask && (
  <div className="w-96 shrink-0 border-l ...">
```
Replace with:
```tsx
<AnimatePresence>
  {selectedTask && (
    <motion.div
      className="w-96 shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto flex flex-col"
      initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
```
And close with `</motion.div>` `</AnimatePresence>` (replacing the previous `</div>`).

- [ ] **Step 8: Verify TypeScript**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add client/src/components/JobDetailPage.tsx
git commit -m "feat(client): animate JobDetailPage with FadeIn, StatusBadge, SpringButton, task panel slide"
```

---

### Task 10: Update TaskDetailPage.tsx

**Files:**
- Modify: `client/src/components/TaskDetailPage.tsx`

- [ ] **Step 1: Update imports**

Replace the import block at the top:
```tsx
import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { getJob, getTask, getTaskResult, retryTask, abortTask } from '../api'
import type { RunInfo, TaskRow } from '../api'
import { TASK_STATE, UNKNOWN_STATUS } from '../design/status'
import { StatusBadge } from './motion/StatusBadge'
import { SpringButton } from './motion/SpringButton'
import { FadeIn } from './motion/FadeIn'
import { MotionCard } from './motion/MotionCard'
```

Also replace the back button (currently `<button onClick={onBack} className="text-gray-400 ...">←</button>`) with a motion button with hover nudge:

```tsx
<motion.button
  onClick={onBack}
  whileHover={{ x: -3 }}
  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
  className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl leading-none font-bold"
>
  ←
</motion.button>
```

- [ ] **Step 2: Remove `STATE_BADGE` constant**

Delete lines:
```ts
const STATE_BADGE: Record<string, string> = {
  pending:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  in_progress: 'bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300 animate-pulse',
  retry:       'bg-yellow-100 text-yellow-600 dark:bg-yellow-500/20 dark:text-yellow-300',
  success:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  failed:      'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400',
  aborted:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}
```

- [ ] **Step 3: Wrap the page in FadeIn and replace card div with MotionCard**

Replace:
```tsx
return (
  <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
```
With:
```tsx
const taskConfig = task ? (TASK_STATE[task.state as keyof typeof TASK_STATE] ?? UNKNOWN_STATUS) : UNKNOWN_STATUS

return (
  <FadeIn as="div" className="px-4 sm:px-6 lg:px-8 py-6 max-w-3xl mx-auto">
```
And close `</FadeIn>` instead of `</div>`.

Replace the main card div:
```tsx
<div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
```
With:
```tsx
<MotionCard className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
```
And the closing `</div>` → `</MotionCard>`.

Replace the actions card div:
```tsx
<div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
```
With:
```tsx
<MotionCard className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5">
```
And closing `</div>` → `</MotionCard>`.

- [ ] **Step 4: Replace status badge**

Replace:
```tsx
<span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATE_BADGE[task.state] ?? ''}`}>
  {task.state}
</span>
```
With:
```tsx
<StatusBadge badgeClass={taskConfig.badge} label={taskConfig.label} />
```

- [ ] **Step 5: Replace action buttons**

Replace the Refresh button:
```tsx
<button onClick={loadData}
  className="ml-auto text-xs px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
  Refresh
</button>
```
With:
```tsx
<SpringButton variant="ghost" onClick={loadData} className="ml-auto text-xs px-3 py-1.5">
  Refresh
</SpringButton>
```

Replace Retry button:
```tsx
<button onClick={handleRetry} disabled={actionLoading !== null}
  className="text-sm px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-400 text-white font-semibold disabled:opacity-50 transition-colors">
  {actionLoading === 'retry' ? 'Retrying…' : 'Retry'}
</button>
```
With:
```tsx
<SpringButton variant="warning" onClick={handleRetry} loading={actionLoading === 'retry'} disabled={actionLoading !== null} className="text-sm px-4 py-2">
  {actionLoading === 'retry' ? 'Retrying…' : 'Retry'}
</SpringButton>
```

Replace Abort button:
```tsx
<button onClick={handleAbort} disabled={actionLoading !== null}
  className="text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-50 transition-colors">
  {actionLoading === 'abort' ? 'Aborting…' : 'Abort'}
</button>
```
With:
```tsx
<SpringButton variant="danger" onClick={handleAbort} loading={actionLoading === 'abort'} disabled={actionLoading !== null} className="text-sm px-4 py-2">
  {actionLoading === 'abort' ? 'Aborting…' : 'Abort'}
</SpringButton>
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/TaskDetailPage.tsx
git commit -m "feat(client): animate TaskDetailPage with FadeIn, MotionCard, StatusBadge, SpringButton"
```

---

### Task 11: Update ParserEditorPage.tsx

**Files:**
- Modify: `client/src/components/ParserEditorPage.tsx`

Key changes: FadeIn on header bar, SpringButton for Save, AnimatePresence on save-status text, StaggerList on steps sidebar with AnimatePresence item exit, active step sliding indicator via `layoutId`, StepDebugPanel slides in from right.

- [ ] **Step 1: Add imports**

After the existing imports, add:
```tsx
import { AnimatePresence, motion } from 'framer-motion'
import { FadeIn } from './motion/FadeIn'
import { SpringButton } from './motion/SpringButton'
import { staggerItemVariants } from './motion/StaggerList'
```

- [ ] **Step 2: Replace the Save button in the parser header bar**

Find:
```tsx
<button
  onClick={saveNow}
  disabled={saveStatus === 'saving'}
  className="px-3 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-medium transition-colors"
>
  Save
</button>
```
Replace with:
```tsx
<SpringButton
  variant="primary"
  onClick={saveNow}
  loading={saveStatus === 'saving'}
  className="px-3 py-1 text-xs"
>
  Save
</SpringButton>
```

- [ ] **Step 3: Animate save status text**

Find:
```tsx
<span className="text-xs text-gray-400">{saveStatusLabel}</span>
```
Replace with:
```tsx
<AnimatePresence mode="wait">
  {saveStatusLabel && (
    <motion.span
      key={saveStatusLabel}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      className={`text-xs ${saveStatus === 'error' ? 'text-rose-400' : saveStatus === 'saved' ? 'text-emerald-500' : 'text-gray-400'}`}
    >
      {saveStatusLabel}
    </motion.span>
  )}
</AnimatePresence>
```

- [ ] **Step 4: Animate steps in the sidebar with AnimatePresence + stagger**

Find the steps list in the sidebar (the `{steps.map((s) => (` block). Replace the containing fragment and list:

Current (lines ~414–437):
```tsx
{steps.map((s) => (
  <div
    key={s.name}
    onClick={() => selectStep(s.name)}
    className={[
      'group flex items-center justify-between px-3 py-2 cursor-pointer text-xs border-b border-gray-100 dark:border-gray-800',
      selectedStepName === s.name
        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
    ].join(' ')}
  >
    <div>
      <div className="font-medium">{s.name}</div>
      <div className="text-gray-400 dark:text-gray-500">{s.type}</div>
    </div>
    <button
      onClick={(e) => { e.stopPropagation(); removeStep(s.name) }}
      className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity text-base leading-none"
      title="Delete step"
    >
      ×
    </button>
  </div>
))}
```

Replace with:
```tsx
<AnimatePresence initial={false}>
  {steps.map((s) => (
    <motion.div
      key={s.name}
      variants={staggerItemVariants}
      initial="hidden"
      animate="show"
      exit={{ opacity: 0, x: -16, transition: { duration: 0.18 } }}
      onClick={() => selectStep(s.name)}
      className={[
        'group relative flex items-center justify-between px-3 py-2 cursor-pointer text-xs border-b border-gray-100 dark:border-gray-800',
        selectedStepName === s.name
          ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
      ].join(' ')}
    >
      {/* Active step sliding indicator */}
      {selectedStepName === s.name && (
        <motion.span
          layoutId="active-step-bar"
          className="absolute left-0 top-0 bottom-0 w-0.5 rounded-r bg-violet-500"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
      <div>
        <div className="font-medium">{s.name}</div>
        <div className="text-gray-400 dark:text-gray-500">{s.type}</div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); removeStep(s.name) }}
        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity text-base leading-none"
        title="Delete step"
      >
        ×
      </button>
    </motion.div>
  ))}
</AnimatePresence>
```

- [ ] **Step 5: Animate StepDebugPanel slide-in from the right**

Find:
```tsx
{showDebug && selectedStep && (
  <StepDebugPanel
    parserName={parserName}
    stepName={selectedStep.name}
    initialUrl={selectedStep.entryUrl}
    onClose={() => setShowDebug(false)}
  />
)}
```
Replace with:
```tsx
<AnimatePresence>
  {showDebug && selectedStep && (
    <motion.div
      initial={{ opacity: 0, x: 32 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 32 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="contents"
    >
      <StepDebugPanel
        parserName={parserName}
        stepName={selectedStep.name}
        initialUrl={selectedStep.entryUrl}
        onClose={() => setShowDebug(false)}
      />
    </motion.div>
  )}
</AnimatePresence>
```

The `motion.div` is a block-level flex child inside `<div className="flex flex-1 overflow-hidden">`. Its width is determined by StepDebugPanel's own `w-80 xl:w-96 shrink-0` classes — the layout is preserved. No special treatment needed.

- [ ] **Step 6: Wrap the "New Parser" form fields in a StaggerList**

Find the new-parser form return (the `if (!parserName)` branch). The `<div className="flex flex-col gap-4">` contains the form fields. Replace it with:

```tsx
<motion.div
  className="flex flex-col gap-4"
  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
  initial="hidden"
  animate="show"
>
  {/* ... all existing form field divs wrapped in motion.div with staggerItemVariants ... */}
```

And wrap each top-level form field `<div>` with `<motion.div variants={staggerItemVariants}>`. There are 6 field groups (Name, Entry URL, Browser, Retries+Quota, Dedup, Browser Settings advanced) — each gets the wrapper. The Actions div also gets a wrapper.

- [ ] **Step 7: Verify TypeScript**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/ParserEditorPage.tsx
git commit -m "feat(client): animate ParserEditorPage — save button, status text, step list, debug panel slide"
```

---

### Task 12: Update DebugPage.tsx and StepDebugPanel.tsx

**Files:**
- Modify: `client/src/components/DebugPage.tsx`
- Modify: `client/src/components/StepDebugPanel.tsx`

- [ ] **Step 1: Update imports in DebugPage.tsx**

Add after existing imports:
```tsx
import { motion, AnimatePresence } from 'framer-motion'
import { FadeIn } from './motion/FadeIn'
import { SpringButton } from './motion/SpringButton'
import { staggerItemVariants } from './motion/StaggerList'
```

- [ ] **Step 2: Wrap DebugPage content in FadeIn**

Replace the outermost return div:
```tsx
<div className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 flex flex-col gap-6 max-w-5xl mx-auto">
```
With:
```tsx
<FadeIn as="div" className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 flex flex-col gap-6 max-w-5xl mx-auto">
```
Close `</FadeIn>` instead of `</div>`.

- [ ] **Step 3: Replace Run button in DebugPage with SpringButton**

Replace:
```tsx
<button
  onClick={handleRun}
  disabled={!canRun}
  className="self-start bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors active:scale-95"
>
  {isRunning ? 'Running…' : 'Run'}
</button>
```
With:
```tsx
<SpringButton
  variant="primary"
  onClick={handleRun}
  disabled={!canRun}
  loading={isRunning}
  className="self-start text-sm px-6 py-2.5"
>
  {isRunning ? 'Running…' : 'Run'}
</SpringButton>
```

- [ ] **Step 4: Stagger log lines in DebugPage console**

In the console `<div ref={consoleRef} ...>`, replace:
```tsx
{logs.map((line, i) => (
  <div
    key={i}
    className={line.level === 'error' ? 'text-red-400' : 'text-gray-300'}
  >
    <span className="text-emerald-500 mr-1">[{line.stepName}]</span>
    {line.args.join(' ')}
  </div>
))}
```
With:
```tsx
<AnimatePresence initial={false}>
  {logs.map((line, i) => (
    <motion.div
      key={i}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.15 }}
      className={line.level === 'error' ? 'text-red-400' : 'text-gray-300'}
    >
      <span className="text-emerald-500 mr-1">[{line.stepName}]</span>
      {line.args.join(' ')}
    </motion.div>
  ))}
</AnimatePresence>
```

- [ ] **Step 5: Update imports in StepDebugPanel.tsx**

Add after existing imports:
```tsx
import { motion, AnimatePresence } from 'framer-motion'
import { SpringButton } from './motion/SpringButton'
```

- [ ] **Step 6: Replace Run button in StepDebugPanel**

Replace:
```tsx
<button
  onClick={() => run(parserName, stepName, url, parseJsonSafe(parentDataJson))}
  disabled={!canRun}
  className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold px-3 py-2 rounded transition-colors"
>
  {isRunning ? 'Running…' : '▶ Run'}
</button>
```
With:
```tsx
<SpringButton
  variant="primary"
  onClick={() => run(parserName, stepName, url, parseJsonSafe(parentDataJson))}
  disabled={!canRun}
  loading={isRunning}
  className="flex-1 text-xs px-3 py-2"
>
  {isRunning ? 'Running…' : '▶ Run'}
</SpringButton>
```

- [ ] **Step 7: Stagger log lines in StepDebugPanel console**

In the console `<div ref={consoleRef} ...>`, replace:
```tsx
{logs.map((line, i) => (
  <LogLine key={i} line={line} />
))}
```
With:
```tsx
<AnimatePresence initial={false}>
  {logs.map((line, i) => (
    <motion.div
      key={i}
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.12 }}
    >
      <LogLine line={line} />
    </motion.div>
  ))}
</AnimatePresence>
```

- [ ] **Step 8: Verify TypeScript**

```bash
cd client && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add client/src/components/DebugPage.tsx client/src/components/StepDebugPanel.tsx
git commit -m "feat(client): animate DebugPage and StepDebugPanel with FadeIn, SpringButton, log slide-in"
```

---

### Task 13: Final build verification and QA

**Files:** (read-only verification — no edits)

- [ ] **Step 1: Full TypeScript build**

```bash
cd client && npm run build 2>&1
```

Expected: `✓ built in Xs` with zero errors.

- [ ] **Step 2: Lint**

```bash
cd client && npm run lint 2>&1
```

Expected: no errors, zero warnings.

- [ ] **Step 3: Start dev server**

```bash
cd client && npm run dev
```

Open `http://localhost:5173` in a browser.

- [ ] **Step 4: Manual QA checklist**

Check each item — mark failures as bugs to fix before closing the task:

**Parsers page:**
- [ ] Cards stagger-fade in on page load (each ~40ms apart)
- [ ] Card hover lifts slightly + shadow deepens
- [ ] Card tap scales down and springs back
- [ ] StatusDot pings for running parser
- [ ] StatusBadge fades between states when parser starts/stops
- [ ] Run/Stop/Resume buttons spring on tap
- [ ] Output files stagger in when run completes
- [ ] Stats numbers count up when values change

**Jobs page:**
- [ ] Title fades in
- [ ] Refresh icon spins on click
- [ ] Table rows stagger-fade in on load
- [ ] StatusBadge shows correct color per status
- [ ] Pagination SpringButtons respond to tap

**Job detail page:**
- [ ] Header fades in
- [ ] Action buttons (Stop, Resume, Retry) spring on tap
- [ ] Task rows stagger in on load
- [ ] Task side-panel slides in from right when row clicked
- [ ] Task side-panel slides out when closed

**Task detail page:**
- [ ] Page fades in
- [ ] Cards mount with animation
- [ ] Retry/Abort buttons spring on tap

**Parser editor:**
- [ ] Save button springs on tap + shows spinner while saving
- [ ] Save status text fades between "Saving…" / "Saved" / "Save failed"
- [ ] Steps stagger-appear on sidebar open
- [ ] Violet bar slides between selected steps
- [ ] New step slides in from top
- [ ] Deleted step slides out to left
- [ ] Debug panel slides in from right on "▶ Run"
- [ ] Debug panel slides out on close

**Debug page:**
- [ ] Page fades in
- [ ] Run button springs; shows spinner while running
- [ ] Console lines slide in from left as they appear

**Theme / reduced-motion:**
- [ ] Toggle animates icon swap (rotate + fade)
- [ ] In Chrome DevTools: Rendering → Emulate CSS prefers-reduced-motion: reduce → verify all transforms are gone, only opacity fades remain
- [ ] Dark and light mode both look clean

- [ ] **Step 5: Fix any QA failures, then commit final**

```bash
git add -p  # stage only intentional fixes
git commit -m "fix(client): QA fixes from manual animation review"
```

- [ ] **Step 6: Final summary commit if no QA fixes needed**

```bash
git log --oneline -12
```

Expected: a clean sequence of feature commits for each task.
