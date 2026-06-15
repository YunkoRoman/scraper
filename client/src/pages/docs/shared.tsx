import { useState } from 'react'

// ─── Code block ───────────────────────────────────────────────────────────────
export function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="relative group my-3">
      <pre className="bg-gray-900 dark:bg-black border border-gray-700 dark:border-gray-800 rounded-lg p-4 overflow-x-auto text-[13px] leading-relaxed text-gray-200 dark:text-gray-300 font-mono">
        {children.trim()}
      </pre>
      <button
        onClick={copy}
        className="absolute top-2.5 right-2.5 px-2 py-1 text-[11px] rounded bg-gray-700 dark:bg-gray-800 text-gray-300 dark:text-gray-400 hover:text-white hover:bg-gray-600 dark:hover:bg-gray-700 transition-all opacity-0 group-hover:opacity-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}

// ─── Badge ────────────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  string:
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/40 dark:text-sky-300 dark:border-sky-800/50',
  number:
    'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800/50',
  boolean:
    'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-800/50',
  object:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800/50',
  array:
    'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:border-rose-800/50',
  enum: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-800/50',
}

export function Badge({ type }: { type: string }) {
  const cls =
    TYPE_COLORS[type] ??
    'bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono border ${cls}`}
    >
      {type}
    </span>
  )
}

// ─── Prop row ─────────────────────────────────────────────────────────────────
export function Prop({
  name,
  type,
  defaultVal,
  children,
  optional = true,
}: {
  name: string
  type: string
  defaultVal?: string
  children: React.ReactNode
  optional?: boolean
}) {
  return (
    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800/60 last:border-0">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <code className="text-[13px] font-mono text-gray-900 dark:text-white">{name}</code>
        {!optional && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
            required
          </span>
        )}
        <Badge type={type} />
        {defaultVal && (
          <span className="text-[11px] text-gray-500 dark:text-gray-500">
            default: <code className="text-gray-600 dark:text-gray-400">{defaultVal}</code>
          </span>
        )}
      </div>
      <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed">{children}</p>
    </div>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
        <span className="w-1 h-5 bg-emerald-500 rounded-full inline-block" />
        {title}
      </h2>
      {children}
    </section>
  )
}

export function SubSection({
  id,
  title,
  children,
}: {
  id?: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div id={id} className="mb-8 scroll-mt-6">
      <h3 className="text-[15px] font-semibold text-gray-800 dark:text-gray-200 mb-3">{title}</h3>
      {children}
    </div>
  )
}

export function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed mb-3">{children}</p>
  )
}

export function CalloutBox({
  title,
  children,
  color = 'emerald',
}: {
  title: string
  children: React.ReactNode
  color?: 'emerald' | 'amber' | 'blue'
}) {
  const styles = {
    emerald:
      'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-800/50 dark:text-emerald-300',
    amber:
      'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/40 dark:border-amber-800/50 dark:text-amber-300',
    blue: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/40 dark:border-blue-800/50 dark:text-blue-300',
  }
  return (
    <div className={`border rounded-lg p-4 my-4 ${styles[color]}`}>
      <p className="text-[12px] font-bold uppercase tracking-wider mb-2">{title}</p>
      <div className="text-[13px] leading-relaxed">{children}</div>
    </div>
  )
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────
export function PageWrapper({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{title}</h1>
        {description && (
          <p className="text-[14px] text-gray-600 dark:text-gray-400">{description}</p>
        )}
      </div>
      {children}
      <div className="pb-16" />
    </div>
  )
}
