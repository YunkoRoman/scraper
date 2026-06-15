import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { path: 'step-context', label: 'Step Context' },
  { path: 'step-types', label: 'Step Types' },
  { path: 'helper-files', label: 'Helper Files' },
  { path: 'step-settings', label: 'Step Settings' },
  { path: 'browser-settings', label: 'Browser Settings' },
  { path: 'parser-settings', label: 'Parser Settings' },
  { path: 'cloudflare-bypass', label: 'Cloudflare Bypass' },
  { path: 'recipes', label: 'Recipes' },
]

export function DocsPage() {
  return (
    <div className="flex min-h-full">
      {/* Sidebar nav */}
      <aside className="w-52 shrink-0 sticky top-0 h-screen overflow-y-auto border-r border-gray-200 dark:border-gray-800 px-3 py-6 hidden md:block">
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 dark:text-gray-500 px-2 mb-3">
          Reference
        </p>
        <nav className="space-y-0.5">
          {NAV.map(({ path, label }) => (
            <NavLink
              key={path}
              to={`/docs/${path}`}
              className={({ isActive }) =>
                [
                  'w-full text-left px-2 py-1.5 rounded text-[13px] transition-colors block',
                  isActive
                    ? 'bg-emerald-50 text-emerald-700 font-medium dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-800/50',
                ].join(' ')
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <Outlet />
      </div>
    </div>
  )
}
