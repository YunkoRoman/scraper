// src/tests/InMemoryTaskStateStore.test.ts
import { describe, it, expect } from 'vitest'
import { InMemoryTaskStateStore } from '../domain/services/TaskStateStore.js'
import { stepName } from '../domain/value-objects/StepName.js'
import { PageState } from '../domain/value-objects/PageState.js'

describe('InMemoryTaskStateStore', () => {
  it('addTask + getTask round-trip', async () => {
    const store = new InMemoryTaskStateStore('r1')
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    expect(await store.getTask(t.id)).toEqual(t)
  })

  it('markInProgress increments attempts', async () => {
    const store = new InMemoryTaskStateStore('r1')
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    const inP = await store.markInProgress(t.id)
    expect(inP.attempts).toBe(t.attempts + 1)
    expect(inP.state).toBe(PageState.InProgress)
  })

  it('isComplete is false with no tasks', async () => {
    const store = new InMemoryTaskStateStore('r1')
    expect(await store.isComplete()).toBe(false)
  })

  it('isComplete reflects all terminal', async () => {
    const store = new InMemoryTaskStateStore('r1')
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    await store.markSuccess(t.id)
    expect(await store.isComplete()).toBe(true)
  })

  it('getStats aggregates by state and type', async () => {
    const store = new InMemoryTaskStateStore('r1')
    const a = await store.addTask('https://a', stepName('s'), 'traverser')
    const b = await store.addTask('https://b', stepName('s'), 'extractor')
    await store.markSuccess(a.id)
    await store.markFailed(b.id, 'boom')
    const stats = await store.getStats()
    expect(stats.success).toBe(1)
    expect(stats.failed).toBe(1)
    expect(stats.traversers.success).toBe(1)
    expect(stats.extractors.failed).toBe(1)
    expect(stats.totalItems).toBe(0)
  })
})
