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
      // eslint-disable-next-line react-hooks/immutability
      window.location.hash = param ? `#/editor/${encodeURIComponent(param)}` : '#/editor/'
      setEditorParser(param ?? '')
    } else if (p === 'debug') {
      // eslint-disable-next-line react-hooks/immutability
      window.location.hash = '#/debug'
    } else if (p === 'jobs') {
      // eslint-disable-next-line react-hooks/immutability
      window.location.hash = '#/jobs'
    } else if (p === 'job-detail' && param) {
      // eslint-disable-next-line react-hooks/immutability
      window.location.hash = `#/jobs/${encodeURIComponent(param)}`
      setJobRunId(param)
    } else if (p === 'task-detail' && param) {
      const colonIdx = param.indexOf(':')
      const rId = param.slice(0, colonIdx)
      const tId = param.slice(colonIdx + 1)
      // eslint-disable-next-line react-hooks/immutability
      window.location.hash = `#/jobs/${encodeURIComponent(rId)}/tasks/${encodeURIComponent(tId)}`
      setJobRunId(rId)
      setJobTaskId(tId)
    } else {
      // eslint-disable-next-line react-hooks/immutability
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
        <div className="h-0.5 bg-gradient-to-r from-violet-500 via-emerald-500 to-violet-500" />
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
