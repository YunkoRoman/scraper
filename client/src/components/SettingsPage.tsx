import { useSettings } from '../hooks/useSettings'

export function SettingsPage() {
  const { settings, updateSettings } = useSettings()

  return (
    <div className="px-6 py-6 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Settings</h1>

      {/* App Preferences */}
      <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 mb-6 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">
          App Preferences
        </h2>

        <div className="space-y-5">
          {/* Theme */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Theme</label>
            <div className="flex gap-2">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => updateSettings({ theme: t })}
                  className={[
                    'px-4 py-1.5 rounded-lg text-sm font-medium border transition-colors capitalize',
                    settings.theme === t
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
                  ].join(' ')}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Items per page */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Parsers per page
            </label>
            <div className="flex gap-2">
              {([10, 25, 50] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => updateSettings({ pageLimit: n })}
                  className={[
                    'w-14 py-1.5 rounded-lg text-sm font-medium border transition-colors',
                    settings.pageLimit === n
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
                  ].join(' ')}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Parser Defaults */}
      <section className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 uppercase tracking-wider">
          Parser Defaults
        </h2>

        <div className="space-y-5">
          {/* Browser type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default browser
            </label>
            <select
              value={settings.defaultBrowserType}
              onChange={(e) => updateSettings({ defaultBrowserType: e.target.value as typeof settings.defaultBrowserType })}
              className="w-full max-w-xs text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="playwright">Playwright</option>
              <option value="playwright-stealth">Playwright Stealth</option>
              <option value="puppeteer">Puppeteer</option>
            </select>
          </div>

          {/* Retry count */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default retry count
            </label>
            <input
              type="number"
              min={1}
              max={20}
              value={settings.defaultRetryCount}
              onChange={(e) => updateSettings({ defaultRetryCount: Math.max(1, parseInt(e.target.value) || 1) })}
              className="w-24 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Concurrency quota */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Default concurrency quota
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                disabled={settings.defaultConcurrentQuota === null}
                value={settings.defaultConcurrentQuota ?? 10}
                onChange={(e) => updateSettings({ defaultConcurrentQuota: Math.max(1, parseInt(e.target.value) || 1) })}
                className="w-24 text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.defaultConcurrentQuota === null}
                  onChange={(e) => updateSettings({ defaultConcurrentQuota: e.target.checked ? null : 10 })}
                  className="w-4 h-4 rounded accent-emerald-500"
                />
                Unlimited
              </label>
            </div>
          </div>

          {/* Deduplication */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.defaultDeduplication}
                onChange={(e) => updateSettings({ defaultDeduplication: e.target.checked })}
                className="w-4 h-4 rounded accent-emerald-500"
              />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Default deduplication enabled
              </span>
            </label>
          </div>
        </div>
      </section>
    </div>
  )
}
