// client/src/App.tsx
import { useEffect, useState } from 'react'
import { listParsers } from './api'
import { ParserCard } from './components/ParserCard'
import { DebugPage } from './components/DebugPage'
import { useTheme } from './hooks/useTheme'

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

type Page = 'parsers' | 'debug'

function getPageFromHash(): Page {
  return window.location.hash === '#/debug' ? 'debug' : 'parsers'
}

export default function App() {
  const [parsers, setParsers] = useState<string[]>([])
  const [apiError, setApiError] = useState<string | null>(null)
  const [page, setPage] = useState<Page>(getPageFromHash)
  const { theme, toggle } = useTheme()

  useEffect(() => {
    listParsers()
      .then(setParsers)
      .catch(() => setApiError('Could not connect to API. Is the server running?'))
  }, [])

  useEffect(() => {
    const handler = () => setPage(getPageFromHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  function navigate(p: Page) {
    window.location.hash = p === 'debug' ? '#/debug' : '#/'
    setPage(p)
  }

  const tabClass = (p: Page) =>
    [
      'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
      page === p
        ? 'bg-emerald-600 text-white'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800',
    ].join(' ')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white transition-colors duration-200">
      {/* Header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 sm:py-4 flex items-center gap-3">
          <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight m-0 text-gray-900 dark:text-white">
            Scraper Platform
          </h1>

          {/* Nav tabs */}
          <nav className="flex items-center gap-1 ml-4">
            <button onClick={() => navigate('parsers')} className={tabClass('parsers')}>
              Parsers
            </button>
            <button onClick={() => navigate('debug')} className={tabClass('debug')}>
              Debug
            </button>
          </nav>

          <span className="ml-auto text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">
            {parsers.length} parser{parsers.length !== 1 ? 's' : ''} found
          </span>
          <button
            onClick={toggle}
            className="ml-2 sm:ml-3 p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="w-full">
        {apiError ? (
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
        ) : page === 'debug' ? (
          <DebugPage />
        ) : parsers.length === 0 ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-600">
            <p className="text-lg">No parsers found</p>
            <p className="text-sm mt-1">
              Add a parser directory under{' '}
              <code className="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-gray-500 dark:text-gray-400 text-xs font-mono">
                src/parsers/
              </code>
            </p>
          </div>
        ) : (
          <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
            <div className="grid gap-4 sm:gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {parsers.map((name) => (
                <ParserCard key={name} name={name} />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
