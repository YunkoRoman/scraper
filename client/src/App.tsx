import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Layout, type NavPage } from './components/Layout'
import { ParsersPage } from './components/ParsersPage'
import { DashboardPage } from './components/DashboardPage'
import { SettingsPage } from './components/SettingsPage'
import { DebugPage } from './components/DebugPage'
import { ParserEditorPage } from './components/ParserEditorPage'
import { JobsPage } from './components/JobsPage'
import { JobDetailPage } from './components/JobDetailPage'
import { TaskDetailPage } from './components/TaskDetailPage'
import { ParserDetailPage } from './components/ParserDetailPage'
import { PageTransition } from './components/motion/PageTransition'

type Page =
  | 'dashboard'
  | 'parsers'
  | 'editor'
  | 'parser-detail'
  | 'jobs'
  | 'job-detail'
  | 'task-detail'
  | 'settings'
  | 'debug'

function parseHash(): { page: Page; editorParserId: string; jobRunId: string; jobTaskId: string; parserDetailId: string } {
  const hash = window.location.hash
  if (hash.match(/^#\/jobs\/[^/]+\/tasks\//)) {
    const match = hash.match(/^#\/jobs\/([^/]+)\/tasks\/(.+)$/)
    return {
      page: 'task-detail',
      editorParserId: '',
      jobRunId: match ? decodeURIComponent(match[1]) : '',
      jobTaskId: match ? decodeURIComponent(match[2]) : '',
      parserDetailId: '',
    }
  }
  if (hash.startsWith('#/jobs/')) {
    return {
      page: 'job-detail',
      editorParserId: '',
      jobRunId: decodeURIComponent(hash.slice(7).split('/')[0]),
      jobTaskId: '',
      parserDetailId: '',
    }
  }
  if (hash === '#/jobs')     return { page: 'jobs',      editorParserId: '', jobRunId: '', jobTaskId: '', parserDetailId: '' }
  if (hash.startsWith('#/editor/'))
    return { page: 'editor', editorParserId: decodeURIComponent(hash.slice(9)), jobRunId: '', jobTaskId: '', parserDetailId: '' }
  if (hash.startsWith('#/parsers/'))
    return { page: 'parser-detail', editorParserId: '', jobRunId: '', jobTaskId: '',
             parserDetailId: decodeURIComponent(hash.slice(10)) }
  if (hash === '#/parsers')  return { page: 'parsers',   editorParserId: '', jobRunId: '', jobTaskId: '', parserDetailId: '' }
  if (hash === '#/settings') return { page: 'settings',  editorParserId: '', jobRunId: '', jobTaskId: '', parserDetailId: '' }
  if (hash === '#/debug')    return { page: 'debug',     editorParserId: '', jobRunId: '', jobTaskId: '', parserDetailId: '' }
  return { page: 'dashboard', editorParserId: '', jobRunId: '', jobTaskId: '', parserDetailId: '' }
}

export default function App() {
  const [state, setState] = useState(parseHash)

  useEffect(() => {
    const handler = () => setState(parseHash())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  function navigate(page: Page, param?: string) {
    if (page === 'editor')     window.location.hash = `#/editor/${encodeURIComponent(param ?? '')}`
    else if (page === 'job-detail' && param)
      window.location.hash = `#/jobs/${encodeURIComponent(param)}`
    else if (page === 'task-detail' && param) {
      const [rId, tId] = param.split(':')
      window.location.hash = `#/jobs/${encodeURIComponent(rId)}/tasks/${encodeURIComponent(tId)}`
    }
    else if (page === 'jobs')      window.location.hash = '#/jobs'
    else if (page === 'parser-detail' && param)
      window.location.hash = `#/parsers/${encodeURIComponent(param)}`
    else if (page === 'parsers')   window.location.hash = '#/parsers'
    else if (page === 'settings')  window.location.hash = '#/settings'
    else if (page === 'debug')     window.location.hash = '#/debug'
    else window.location.hash = '#/'
  }

  const navPage: NavPage =
    state.page === 'parsers' || state.page === 'parser-detail' || state.page === 'editor' ? 'parsers'
    : state.page === 'jobs' || state.page === 'job-detail' || state.page === 'task-detail' ? 'jobs'
    : state.page === 'settings' ? 'settings'
    : 'dashboard'

  function renderPage() {
    switch (state.page) {
      case 'editor':
        return (
          <ParserEditorPage
            parserId={state.editorParserId}
            onNavigateToParsers={() => navigate('parsers')}
            onParserSelect={(id) => navigate('editor', id)}
          />
        )
      case 'debug':
        return <DebugPage />
      case 'jobs':
        return <JobsPage onViewJob={(runId) => navigate('job-detail', runId)} />
      case 'job-detail':
        return (
          <JobDetailPage
            runId={state.jobRunId}
            onBack={() => navigate('jobs')}
            onViewTask={(taskId) => navigate('task-detail', `${state.jobRunId}:${taskId}`)}
          />
        )
      case 'task-detail':
        return (
          <TaskDetailPage
            runId={state.jobRunId}
            taskId={state.jobTaskId}
            onBack={() => navigate('job-detail', state.jobRunId)}
          />
        )
      case 'settings':
        return <SettingsPage />
      case 'parser-detail':
        return (
          <ParserDetailPage
            parserId={state.parserDetailId}
            onBack={() => navigate('parsers')}
            onEdit={(id) => navigate('editor', id)}
            onViewJob={(runId) => navigate('job-detail', runId)}
          />
        )
      case 'parsers':
        return (
          <ParsersPage
            onEdit={(id) => navigate('editor', id)}
            onViewParser={(id) => navigate('parser-detail', id)}
          />
        )
      default:
        return <DashboardPage onNavigate={navigate} />
    }
  }

  return (
    <Layout activePage={navPage} onNavigate={(p) => navigate(p)}>
      <AnimatePresence mode="wait">
        <PageTransition key={state.page}>
          {renderPage()}
        </PageTransition>
      </AnimatePresence>
    </Layout>
  )
}
