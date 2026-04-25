import { describe, it, expect } from 'vitest'
import { ParserRun } from '../../src/domain/entities/ParserRun.js'
import { PageState } from '../../src/domain/value-objects/PageState.js'
import { stepName } from '../../src/domain/value-objects/StepName.js'

describe('ParserRun', () => {
  it('adds a task and tracks it', () => {
    const run = new ParserRun('my-parser')
    const task = run.addTask('https://example.com', stepName('step1'))
    expect(run.getTask(task.id)).toBeDefined()
    expect(task.state).toBe(PageState.Pending)
  })

  it('transitions task to retry and increments attempts', () => {
    const run = new ParserRun('my-parser')
    const task = run.addTask('https://example.com', stepName('step1'), { maxRetries: 3 })
    run.markRetry(task.id, 'timeout')
    const updated = run.getTask(task.id)!
    expect(updated.state).toBe(PageState.Retry)
    expect(updated.attempts).toBe(1)
    expect(updated.error).toBe('timeout')
  })

  it('transitions to failed when attempts exhausted', () => {
    const run = new ParserRun('my-parser')
    const task = run.addTask('https://example.com', stepName('step1'), { maxRetries: 1 })
    run.markRetry(task.id, 'err')
    run.markFailed(task.id, 'err')
    expect(run.getTask(task.id)!.state).toBe(PageState.Failed)
  })

  it('isComplete returns true when all tasks terminal', () => {
    const run = new ParserRun('my-parser')
    const t1 = run.addTask('https://a.com', stepName('step1'))
    const t2 = run.addTask('https://b.com', stepName('step1'))
    run.markSuccess(t1.id)
    run.markSuccess(t2.id)
    expect(run.isComplete()).toBe(true)
  })

  it('stats returns correct counts', () => {
    const run = new ParserRun('my-parser')
    const t1 = run.addTask('https://a.com', stepName('step1'))
    const t2 = run.addTask('https://b.com', stepName('step1'))
    run.markSuccess(t1.id)
    run.markFailed(t2.id, 'err')
    const stats = run.getStats()
    expect(stats.total).toBe(2)
    expect(stats.success).toBe(1)
    expect(stats.failed).toBe(1)
    expect(stats.pending).toBe(0)
  })

  it('has a stable string id in UUID format', () => {
    const run = new ParserRun('p')
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('restoreTask adds a task without changing its state', () => {
    const run1 = new ParserRun('p')
    const task = run1.addTask('https://a.com', stepName('s'), 'extractor')
    run1.markSuccess(task.id)

    const run2 = new ParserRun('p')
    run2.restoreTask(run1.getTask(task.id)!)
    expect(run2.getTask(task.id)?.state).toBe(PageState.Success)
  })

  it('markPending resets an aborted task', () => {
    const run = new ParserRun('p')
    const task = run.addTask('https://a.com', stepName('s'), 'traverser')
    run.markAborted(task.id)
    run.markPending(task.id)
    expect(run.getTask(task.id)?.state).toBe(PageState.Pending)
  })

  it('markInProgress sets in_progress state', () => {
    const run = new ParserRun('p')
    const task = run.addTask('https://a.com', stepName('s'), 'traverser')
    run.markInProgress(task.id)
    expect(run.getTask(task.id)?.state).toBe(PageState.InProgress)
  })

  it('isComplete is false when tasks are in_progress', () => {
    const run = new ParserRun('p')
    const task = run.addTask('https://a.com', stepName('s'), 'traverser')
    run.markInProgress(task.id)
    expect(run.isComplete()).toBe(false)
  })
})
