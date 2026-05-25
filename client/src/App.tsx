import { AnimatePresence } from 'framer-motion'
import { Routes, Route, useLocation } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ParsersPage } from './pages/ParsersPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { DebugPage } from './pages/DebugPage'
import { ParserEditorPage } from './pages/ParserEditorPage'
import { JobsPage } from './pages/JobsPage'
import { JobDetailPage } from './pages/JobDetailPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { ParserDetailPage } from './pages/ParserDetailPage'
import { PageTransition } from './components/motion/PageTransition'

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <PageTransition key={location.pathname}>
        <Routes location={location}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/parsers" element={<ParsersPage />} />
          <Route path="/parsers/:parserId" element={<ParserDetailPage />} />
          <Route path="/editor" element={<ParserEditorPage />} />
          <Route path="/editor/:parserId" element={<ParserEditorPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:runId" element={<JobDetailPage />} />
          <Route path="/jobs/:runId/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/debug" element={<DebugPage />} />
        </Routes>
      </PageTransition>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <Layout>
      <AnimatedRoutes />
    </Layout>
  )
}
