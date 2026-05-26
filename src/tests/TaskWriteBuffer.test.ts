// src/tests/TaskWriteBuffer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TaskWriteBuffer, type TaskSink } from '../infrastructure/db/TaskWriteBuffer.js'
import type { PageTask } from '../domain/entities/PageTask.js'
import { PageState } from '../domain/value-objects/PageState.js'
import { stepName } from '../domain/value-objects/StepName.js'

function task(id: string, runState: PageState = PageState.Success): PageTask {
  return {
    id,
    url: `https://x/${id}`,
    stepName: stepName('s'),
    stepType: 'extractor',
    state: runState,
    attempts: 1,
    maxAttempts: 3,
  } as PageTask
}

function mockSink(): TaskSink & {
  flushTaskBatch: ReturnType<typeof vi.fn>
  flushResultBatch: ReturnType<typeof vi.fn>
} {
  return {
    flushTaskBatch: vi.fn(async () => {}),
    flushResultBatch: vi.fn(async () => {}),
  }
}

describe('TaskWriteBuffer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('batches multiple enqueues into one flush after debounce', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink, { flushIntervalMs: 100, maxBatchSize: 1000 })
    buf.enqueueTask('r1', task('a'))
    buf.enqueueTask('r1', task('b'))
    buf.enqueueTask('r1', task('c'))
    expect(sink.flushTaskBatch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(sink.flushTaskBatch).toHaveBeenCalledTimes(1)
    expect(sink.flushTaskBatch.mock.calls[0][0]).toEqual([
      { runId: 'r1', tasks: [task('a'), task('b'), task('c')] },
    ])
  })

  it('coalesces multiple enqueues of the same taskId to the latest snapshot', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink, { flushIntervalMs: 100, maxBatchSize: 1000 })
    buf.enqueueTask('r1', task('a', PageState.InProgress))
    buf.enqueueTask('r1', task('a', PageState.Success))
    await vi.advanceTimersByTimeAsync(100)
    expect(sink.flushTaskBatch).toHaveBeenCalledTimes(1)
    const [batch] = sink.flushTaskBatch.mock.calls[0]
    expect(batch[0].tasks).toHaveLength(1)
    expect(batch[0].tasks[0].state).toBe(PageState.Success)
  })

  it('groups by runId in a single flush', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink, { flushIntervalMs: 100, maxBatchSize: 1000 })
    buf.enqueueTask('r1', task('a'))
    buf.enqueueTask('r2', task('b'))
    await vi.advanceTimersByTimeAsync(100)
    const [batch] = sink.flushTaskBatch.mock.calls[0]
    expect(batch).toHaveLength(2)
    expect(new Set(batch.map((b: { runId: string }) => b.runId))).toEqual(new Set(['r1', 'r2']))
  })

  it('flushes immediately once maxBatchSize is reached', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink, { flushIntervalMs: 100, maxBatchSize: 3 })
    buf.enqueueTask('r1', task('a'))
    buf.enqueueTask('r1', task('b'))
    buf.enqueueTask('r1', task('c'))
    await Promise.resolve()
    await Promise.resolve()
    expect(sink.flushTaskBatch).toHaveBeenCalledTimes(1)
  })

  it('peekTask returns latest pending snapshot', () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink)
    buf.enqueueTask('r1', task('a', PageState.InProgress))
    expect(buf.peekTask('a')?.state).toBe(PageState.InProgress)
    buf.enqueueTask('r1', task('a', PageState.Failed))
    expect(buf.peekTask('a')?.state).toBe(PageState.Failed)
  })

  it('flush() drains both tasks and results', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink)
    buf.enqueueTask('r1', task('a'))
    buf.enqueueResult('a', [{ x: 1 }])
    await buf.flush()
    expect(sink.flushTaskBatch).toHaveBeenCalledTimes(1)
    expect(sink.flushResultBatch).toHaveBeenCalledTimes(1)
    expect(sink.flushResultBatch.mock.calls[0][0]).toEqual([{ taskId: 'a', rows: [{ x: 1 }] }])
  })

  it('flush() is a no-op when the buffer is empty', async () => {
    const sink = mockSink()
    const buf = new TaskWriteBuffer(sink)
    await buf.flush()
    expect(sink.flushTaskBatch).not.toHaveBeenCalled()
    expect(sink.flushResultBatch).not.toHaveBeenCalled()
  })
})
