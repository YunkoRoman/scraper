// Bootstrap for tsx dev mode: registers tsx ESM hooks before importing the actual .ts worker
import { register } from 'tsx/esm/api'
import { workerData } from 'node:worker_threads'

register()
await import(workerData.__workerPath)
