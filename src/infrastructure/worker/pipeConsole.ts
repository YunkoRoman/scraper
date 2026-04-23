import { parentPort } from 'node:worker_threads'

function fmt(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return arg.stack ?? arg.message
  try {
    return JSON.stringify(arg, null, 2)
  } catch {
    return String(arg)
  }
}

export function pipeConsole(stepName: string) {
  console.log = (...args: unknown[]) => {
    parentPort!.postMessage({ type: 'LOG', level: 'log', stepName, args: args.map(fmt) })
  }
  console.error = (...args: unknown[]) => {
    parentPort!.postMessage({ type: 'LOG', level: 'error', stepName, args: args.map(fmt) })
  }
}
