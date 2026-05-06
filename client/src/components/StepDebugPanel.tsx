// client/src/components/StepDebugPanel.tsx
import { useEffect, useRef, useState } from 'react'
import ReactJsonModule from 'react-json-view'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactJson = (ReactJsonModule as any).default || ReactJsonModule
import { useDebugRun } from '../hooks/useDebugRun'
import { JsonEditor } from './JsonEditor'
import { motion, AnimatePresence } from 'framer-motion'
import { SpringButton } from './motion/SpringButton'

function parseJsonSafe(s: string): Record<string, unknown> | undefined {
  if (!s.trim()) return undefined
  try {
    const v = JSON.parse(s)
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* ignore */ }
  return undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LogLine = ({ line }: { line: any }) => {
  const content = line.args.join(' ')
  
  // Try to parse the log line as JSON
  let jsonData = null
  try {
    if (content.startsWith('[browser:debug] ')) {
        jsonData = JSON.parse(content.replace('[browser:debug] ', ''))
    }
  // eslint-disable-next-line no-empty
  } catch {}

  return (
    <div className={line.level === 'error' ? 'text-red-400' : 'text-gray-300'}>
      <span className="text-emerald-500 mr-1">[{line.stepName}]</span>
      {jsonData ? (
        <ReactJson 
          src={jsonData} 
          theme="monokai" 
          collapsed={1} 
          displayDataTypes={false} 
          enableClipboard={false}
          style={{ backgroundColor: 'transparent', fontSize: '12px' }}
        />
      ) : (
        content
      )}
    </div>
  )
}

interface Props {
  parserName: string
  stepName: string
  initialUrl: string
  onClose: () => void
}

export function StepDebugPanel({ parserName, stepName, initialUrl, onClose }: Props) {
  const [url, setUrl] = useState(initialUrl)
  const [parentDataJson, setParentDataJson] = useState('')
  const consoleRef = useRef<HTMLDivElement>(null)

  const { status, logs, result, error, run, reset } = useDebugRun()
  const isRunning = status === 'running'

  // Pre-fill URL when the selected step changes
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setUrl(initialUrl)
  }, [stepName, initialUrl])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Auto-scroll console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [logs])

  const parentDataError = parentDataJson.trim() !== '' && parseJsonSafe(parentDataJson) === undefined
  const canRun = !isRunning && !!url.trim() && !parentDataError

  return (
    <div className="w-80 xl:w-96 shrink-0 border-l border-gray-200 dark:border-gray-800 flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Run: {stepName}</span>
        <button
          onClick={() => { reset(); onClose() }}
          className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-lg leading-none"
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Controls */}
      <div className="p-3 flex flex-col gap-2 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isRunning}
            placeholder="https://example.com/page"
            className="w-full text-xs px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 font-mono placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 disabled:opacity-50"
          />
        </div>

        <details>
          <summary className="text-xs text-gray-500 cursor-pointer select-none">
            parentData (optional)
          </summary>
          <div className="mt-1.5">
            <JsonEditor
              value={parentDataJson}
              onChange={setParentDataJson}
              disabled={isRunning}
              placeholder={'{\n  "key": "value"\n}'}
            />
          </div>
        </details>

        <div className="flex gap-2">
          <SpringButton
            variant="primary"
            onClick={() => run(parserName, stepName, url, parseJsonSafe(parentDataJson))}
            disabled={!canRun}
            loading={isRunning}
            className="flex-1 text-xs px-3 py-2"
          >
            {isRunning ? 'Running…' : '▶ Run'}
          </SpringButton>
          {(status !== 'idle') && (
            <button
              onClick={reset}
              disabled={isRunning}
              className="px-3 py-2 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors disabled:opacity-40"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Console */}
      <div
        ref={consoleRef}
        className="flex-1 bg-gray-950 p-3 overflow-y-auto font-mono text-xs space-y-0.5 min-h-0"
      >
        {status === 'idle' && logs.length === 0 ? (
          <span className="text-gray-600">Enter a URL and click Run</span>
        ) : logs.length === 0 ? (
          <span className="text-gray-600">Waiting for output…</span>
        ) : null}
        <AnimatePresence initial={false}>
          {logs.map((line, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.12 }}
            >
              <LogLine line={line} />
            </motion.div>
          ))}
        </AnimatePresence>
        {status === 'done' && <div className="text-emerald-400 mt-1">✓ Done</div>}
        {status === 'error' && <div className="text-red-400 mt-1">✗ {error}</div>}
      </div>

      {/* Result */}
      {result && (
        <div className="border-t border-gray-800 bg-gray-950 p-3 overflow-y-auto max-h-56 shrink-0">
          {result.type === 'links' ? (
            <>
              <p className="text-xs text-gray-400 mb-1.5 font-medium">
                Links discovered ({result.items.length})
              </p>
              <pre className="text-xs text-emerald-400 whitespace-pre-wrap break-all">
                {JSON.stringify(result.items, null, 2)}
              </pre>
            </>
          ) : (
            <>
              <p className="text-xs text-gray-400 mb-1.5 font-medium">
                {result.outputFile} — {result.rows.length} rows
              </p>
              <pre className="text-xs text-emerald-400 whitespace-pre-wrap break-all">
                {JSON.stringify(result.rows, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
