import { useNavigate, useLocation } from 'react-router-dom'
import { useSettings } from '../hooks/useSettings'

export type NavPage = 'dashboard' | 'parsers' | 'jobs' | 'settings'

interface Props {
  children: React.ReactNode
}

const NAV_ROUTES: Record<NavPage, string> = {
  dashboard: '/',
  parsers: '/parsers',
  jobs: '/jobs',
  settings: '/settings',
}

function DashboardIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  )
}

function BoltIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}

function JobsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

const NAV: { id: NavPage; label: string; icon: React.ReactElement }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
  { id: 'parsers',   label: 'Parsers',   icon: <BoltIcon /> },
  { id: 'jobs',      label: 'Jobs',      icon: <JobsIcon /> },
  { id: 'settings',  label: 'Settings',  icon: <SettingsIcon /> },
]

export function Layout({ children }: Props) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { settings, updateSettings } = useSettings()
  const collapsed = settings.navCollapsed

  const activePage: NavPage =
    pathname.startsWith('/parsers') || pathname.startsWith('/editor') ? 'parsers'
    : pathname.startsWith('/jobs') ? 'jobs'
    : pathname.startsWith('/settings') ? 'settings'
    : 'dashboard'

  function cycleTheme() {
    const next =
      settings.theme === 'system' ? 'light'
      : settings.theme === 'light' ? 'dark'
      : 'system'
    updateSettings({ theme: next })
  }

  const ThemeIcon =
    settings.theme === 'system' ? MonitorIcon
    : settings.theme === 'dark' ? SunIcon
    : MoonIcon

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white transition-colors duration-200">
      {/* Sidebar */}
      <aside className={[
        'shrink-0 flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 transition-all duration-200',
        collapsed ? 'w-[48px]' : 'w-[220px]',
      ].join(' ')}>
        {/* Logo */}
        <div className={[
          'flex items-center h-14 border-b border-gray-200 dark:border-gray-800 shrink-0 overflow-hidden',
          collapsed ? 'justify-center px-0' : 'gap-2.5 px-4',
        ].join(' ')}>
          <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center shrink-0">
            <BoltIcon />
          </div>
          {!collapsed && (
            <span className="font-extrabold text-base tracking-tight text-gray-900 dark:text-white">
              Parser
            </span>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(NAV_ROUTES[item.id])}
              title={collapsed ? item.label : undefined}
              className={[
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                collapsed ? 'justify-center' : '',
                activePage === item.id
                  ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white',
              ].join(' ')}
            >
              {item.icon}
              {!collapsed && item.label}
            </button>
          ))}
        </nav>

        {/* Theme toggle */}
        <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-800 shrink-0">
          <button
            onClick={cycleTheme}
            title={collapsed ? `Theme: ${settings.theme}` : undefined}
            className={[
              'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400',
              'hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors',
              collapsed ? 'justify-center' : '',
            ].join(' ')}
          >
            <ThemeIcon />
            {!collapsed && <span className="capitalize">{settings.theme}</span>}
          </button>
        </div>

        {/* Collapse toggle */}
        <div className="px-3 pb-3 shrink-0">
          <button
            onClick={() => updateSettings({ navCollapsed: !collapsed })}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-full flex items-center justify-center px-3 py-2 rounded-lg text-sm text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  )
}
