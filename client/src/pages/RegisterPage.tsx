import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { apiRegister } from '../api'

const INDUSTRIES = [
  'Technology',
  'Finance',
  'Healthcare',
  'Retail',
  'Manufacturing',
  'Media',
  'Education',
  'Other',
]

export function RegisterPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [organizationName, setOrganizationName] = useState('')
  const [industry, setIndustry] = useState(INDUSTRIES[0])
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const user = await apiRegister({ organizationName, industry, fullName, email, password })
      setUser(user)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left marketing panel */}
      <aside className="hidden w-1/3 flex-col justify-between bg-gray-900 p-10 text-white lg:flex">
        <div>
          <div className="text-lg font-semibold text-emerald-400">Scraper Platform</div>
          <h2 className="mt-10 text-3xl font-semibold leading-tight">
            Build and run web scrapers at scale.
          </h2>
          <p className="mt-4 text-sm text-gray-400">
            Multi-step parsers, concurrent workers, and a full run dashboard — for your whole team.
          </p>
        </div>
        <div className="flex gap-4 text-xs text-gray-500">
          <span>ISO 27001</span>
          <span>AES-256</span>
          <span>Global Edge Network</span>
        </div>
      </aside>

      {/* Right form */}
      <main className="flex w-full items-center justify-center bg-white px-4 py-10 dark:bg-gray-900 lg:w-2/3">
        <div className="w-full max-w-md">
          <h1 className="mb-1 text-2xl font-semibold text-gray-900 dark:text-white">
            Register your organization
          </h1>
          <p className="mb-6 text-sm text-gray-500">Create the admin account for your workspace.</p>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Organization Name
              </label>
              <input
                required
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Industry
              </label>
              <select
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              >
                {INDUSTRIES.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Admin Full Name
              </label>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Professional Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-16 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-emerald-700"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Minimum 12 characters, with at least one number and one symbol.
              </p>
            </div>

            <label className="flex items-start gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                required
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I agree to the{' '}
                <a href="#" className="text-emerald-700 hover:underline">
                  Service Agreement
                </a>{' '}
                and{' '}
                <a href="#" className="text-emerald-700 hover:underline">
                  Privacy Policy
                </a>
                .
              </span>
            </label>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {submitting ? 'Registering…' : 'Register Organization →'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-emerald-700 hover:underline">
              SIGN IN
            </Link>
          </p>
        </div>
      </main>
    </div>
  )
}
