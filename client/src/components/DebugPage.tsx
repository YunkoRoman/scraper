// client/src/components/DebugPage.tsx
import { useEffect, useRef, useState } from 'react'
import { listParsers, listSteps, getStep } from '../api'
import type { StepInfo } from '../api'
import { JsonEditor } from './JsonEditor'
import { useDebugRun } from '../hooks/useDebugRun'
import type { DebugResult } from '../hooks/useDebugRun'
import { motion, AnimatePresence } from 'framer-motion'
import { FadeIn } from './motion/FadeIn'
import { SpringButton } from './motion/SpringButton'

function parseJsonSafe(s: string): Record<string, unknown> | undefined {
  if (!s.trim()) return undefined
  try {
    const v = JSON.parse(s)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* ignore */ }
  return undefined
}

function ResultPanel({ result }: { result: DebugResult }) {
  if (result.type === 'links') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
          Links discovered ({result.items.length})
        </p>
        <pre className="text-xs font-mono bg-gray-950 text-emerald-400 rounded-lg p-4 overflow-auto max-h-96 whitespace-pre-wrap">
          {JSON.stringify(result.items, null, 2)}
        </pre>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">
        Data extracted — {result.outputFile} ({result.rows.length} rows)
      </p>
      <pre className="text-xs font-mono bg-gray-950 text-emerald-400 rounded-lg p-4 overflow-auto max-h-96 whitespace-pre-wrap">
        {JSON.stringify(result.rows, null, 2)}
      </pre>
    </div>
  )
}

export function DebugPage() {
  const [parsers, setParsers] = useState<string[]>([])
  const [selectedParser, setSelectedParser] = useState('')
  const [steps, setSteps] = useState<StepInfo[]>([])
  const [selectedStep, setSelectedStep] = useState('')
  const [url, setUrl] = useState('')
  const [parentDataJson, setParentDataJson] = useState('')
  const consoleRef = useRef<HTMLDivElement>(null)

  const { status, logs, result, error, run, reset } = useDebugRun()
  const isRunning = status === 'running'

  useEffect(() => {
    listParsers().then(setParsers).catch(() => setParsers([]))
  }, [])

  useEffect(() => {
    if (!selectedParser) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSteps([])
      setSelectedStep('')
      return
    }
    listSteps(selectedParser)
      .then((s) => {
        setSteps(s)
        setSelectedStep(s[0]?.name ?? '')
      })
      .catch(() => {
        setSteps([])
        setSelectedStep('')
      })
  }, [selectedParser])

  useEffect(() => {
    if (!selectedParser || !selectedStep) return
    getStep(selectedParser, selectedStep)
      .then((s) => { if (s.entryUrl) setUrl(s.entryUrl) })
      .catch(() => {})
  }, [selectedParser, selectedStep])

  // Auto-scroll console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [logs])

  function handleRun() {
    const parent_data = parseJsonSafe(parentDataJson)
    run(selectedParser, selectedStep, url, parent_data)
  }

  const parentDataError =
    parentDataJson.trim() !== '' && parseJsonSafe(parentDataJson) === undefined
  const canRun = !isRunning && !!selectedParser && !!selectedStep && !!url.trim() && !parentDataError

  const selectClass =
    'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
    'text-gray-900 dark:text-gray-100 text-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-400'

  const inputClass =
    'w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 ' +
    'text-gray-900 dark:text-gray-100 text-sm px-3 py-2 font-mono placeholder-gray-400 dark:placeholder-gray-600 ' +
    'focus:outline-none focus:ring-1 focus:ring-emerald-400'

  return (
    <FadeIn as="div" className="w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-8 flex flex-col gap-6 max-w-5xl mx-auto">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">Debug Step Runner</h2>

      {/* Config panel */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 flex flex-col gap-4 shadow-sm">

        {/* Parser + Step row */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Parser</label>
            <select
              value={selectedParser}
              onChange={(e) => { setSelectedParser(e.target.value); reset() }}
              disabled={isRunning}
              className={selectClass}
            >
              <option value="">— select —</option>
              {parsers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Step</label>
            <select
              value={selectedStep}
              onChange={(e) => { setSelectedStep(e.target.value); reset() }}
              disabled={isRunning || !steps.length}
              className={selectClass}
            >
              {steps.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.type})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* URL */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isRunning}
            placeholder="https://example.com/page"
            className={inputClass}
          />
        </div>

        {/* parentData */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            parentData <span className="font-normal text-gray-400">(optional JSON object)</span>
          </label>
          <JsonEditor
            value={parentDataJson}
            onChange={setParentDataJson}
            disabled={isRunning}
            placeholder={'{\n  "category": "Travel"\n}'}
          />
        </div>

        {/* Run button */}
        <SpringButton
          variant="primary"
          onClick={handleRun}
          disabled={!canRun}
          loading={isRunning}
          className="self-start text-sm px-6 py-2.5"
        >
          {isRunning ? 'Running…' : 'Run'}
        </SpringButton>
      </div>

      {/* Output — only when there's something to show */}
      {(status !== 'idle' || logs.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Console */}
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Console</p>
            <div
              ref={consoleRef}
              className="bg-gray-950 rounded-xl p-4 h-80 overflow-y-auto font-mono text-xs space-y-0.5"
            >
              {logs.length === 0 && (
                <span className="text-gray-600">Waiting for output…</span>
              )}
              <AnimatePresence initial={false}>
                {logs.map((line, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.15 }}
                    className={line.level === 'error' ? 'text-red-400' : 'text-gray-300'}
                  >
                    <span className="text-emerald-500 mr-1">[{line.stepName}]</span>
                    {line.args.join(' ')}
                  </motion.div>
                ))}
              </AnimatePresence>
              {status === 'done' && (
                <div className="text-emerald-400 mt-1">✓ Done</div>
              )}
              {status === 'error' && (
                <div className="text-red-400 mt-1">✗ {error}</div>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">Result</p>
            <div className="bg-gray-950 rounded-xl p-4 h-80 overflow-y-auto">
              {!result && (
                <span className="text-gray-600 font-mono text-xs">
                  {isRunning ? 'Waiting for result…' : 'No result yet.'}
                </span>
              )}
              {result && <ResultPanel result={result} />}
            </div>
          </div>

        </div>
      )}
    </FadeIn>
  )
}
