import { AnimatePresence } from 'framer-motion'
import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { ParsersPage } from './pages/ParsersPage'
import { DashboardPage } from './pages/DashboardPage'
import { SettingsPage } from './pages/SettingsPage'
import { DebugPage } from './pages/DebugPage'
import { ParserEditorPage } from './pages/ParserEditorPage'
import { JobsPage } from './pages/JobsPage'
import { JobDetailPage } from './pages/JobDetailPage'
import { TaskDetailPage } from './pages/TaskDetailPage'
import { ParserDetailPage } from './pages/ParserDetailPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { DocsPage } from './pages/DocsPage'
import { StepContextPage } from './pages/docs/StepContextPage'
import { StepTypesPage } from './pages/docs/StepTypesPage'
import { HelperFilesPage } from './pages/docs/HelperFilesPage'
import { StepSettingsPage } from './pages/docs/StepSettingsPage'
import { BrowserSettingsPage } from './pages/docs/BrowserSettingsPage'
import { ParserSettingsPage } from './pages/docs/ParserSettingsPage'
import { CloudflareBypassPage } from './pages/docs/CloudflareBypassPage'
import { RecipesPage } from './pages/docs/RecipesPage'
import { PageTransition } from './components/motion/PageTransition'

function AnimatedRoutes() {
  const location = useLocation()
  // Docs sub-pages share the same transition key so the layout shell
  // doesn't re-animate on every internal navigation.
  const transitionKey = location.pathname.startsWith('/docs') ? '/docs' : location.pathname

  return (
    <AnimatePresence mode="wait">
      <PageTransition key={transitionKey}>
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
          <Route path="/docs" element={<DocsPage />}>
            <Route index element={<Navigate to="step-context" replace />} />
            <Route path="step-context" element={<StepContextPage />} />
            <Route path="step-types" element={<StepTypesPage />} />
            <Route path="helper-files" element={<HelperFilesPage />} />
            <Route path="step-settings" element={<StepSettingsPage />} />
            <Route path="browser-settings" element={<BrowserSettingsPage />} />
            <Route path="parser-settings" element={<ParserSettingsPage />} />
            <Route path="cloudflare-bypass" element={<CloudflareBypassPage />} />
            <Route path="recipes" element={<RecipesPage />} />
          </Route>
        </Routes>
      </PageTransition>
    </AnimatePresence>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <AnimatedRoutes />
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}
