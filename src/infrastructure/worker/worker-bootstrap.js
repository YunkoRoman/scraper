// Bootstrap for tsx dev mode: registers tsx ESM hooks before importing the actual .ts worker
import { register } from 'tsx/esm/api'
import { workerData } from 'node:worker_threads'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ALLOWED_WORKER_PATHS = new Set([
  resolve(__dirname, 'ExtractorWorker.ts'),
  resolve(__dirname, 'TraverserWorker.ts'),
])

const workerPath = workerData.__workerPath
if (!workerPath || !ALLOWED_WORKER_PATHS.has(resolve(String(workerPath)))) {
  throw new Error(`Invalid __workerPath: ${workerPath}`)
}

register()
await import(workerPath)
