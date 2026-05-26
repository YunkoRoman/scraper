// src/tests/DbTaskStateStore.test.ts
import { describe, it, expect, vi } from 'vitest'
import { DbTaskStateStore } from '../infrastructure/persistence/DbTaskStateStore.js'
import { stepName } from '../domain/value-objects/StepName.js'
import { PageState } from '../domain/value-objects/PageState.js'

function mockPersistence() {
  const stored = new Map<string, any>()
  return {
    upsertTask: vi.fn(async (_runId: string, task: any) => { stored.set(task.id, task) }),
    getTask: vi.fn(async (_runId: string, id: string) => stored.get(id) ?? null),
    getRunTasks: vi.fn(async () => ({ tasks: [...stored.values()], total: stored.size })),
    findById: vi.fn(async () => null),
    flushPendingWrites: vi.fn(async () => {}),
    _stored: stored,
  }
}

describe('DbTaskStateStore', () => {
  it('addTask writes through and caches', async () => {
    const p = mockPersistence()
    const store = new DbTaskStateStore('r1', p as any)
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    expect(p.upsertTask).toHaveBeenCalledTimes(1)
    expect(await store.getTask(t.id)).toEqual(t)
    // Second getTask should be cached (no persistence.getTask call)
    expect(p.getTask).not.toHaveBeenCalled()
  })

  it('markInProgress increments attempts and writes through', async () => {
    const p = mockPersistence()
    const store = new DbTaskStateStore('r1', p as any)
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    const inP = await store.markInProgress(t.id)
    expect(inP.state).toBe(PageState.InProgress)
    expect(inP.attempts).toBe(t.attempts + 1)
    expect(p.upsertTask).toHaveBeenCalledTimes(2)
  })

  it('getTask falls back to DB on cache miss', async () => {
    const p = mockPersistence()
    p._stored.set('z', { id: 'z', url: 'u', stepName: 's', stepType: 'traverser', state: 'pending', attempts: 0, maxAttempts: 3, error: null, parentTaskId: null, parent_data: null })
    const store = new DbTaskStateStore('r1', p as any)
    const t = await store.getTask('z')
    expect(t?.id).toBe('z')
    expect(p.getTask).toHaveBeenCalledTimes(1)
  })

  it('isComplete uses in-memory counter, not DB', async () => {
    const p = mockPersistence()
    const store = new DbTaskStateStore('r1', p as any)
    const t = await store.addTask('https://x', stepName('s'), 'traverser')
    expect(p.findById).not.toHaveBeenCalled()
    await store.markSuccess(t.id)
    expect(await store.isComplete()).toBe(true)
    expect(p.findById).not.toHaveBeenCalled()
  })

  it('allTasks() rebuilds stats counter from DB on resume', async () => {
    const p = mockPersistence()
    p._stored.set('a', { id: 'a', url: 'u', stepName: 's', stepType: 'traverser', state: 'success', attempts: 1, maxAttempts: 3, error: null, parentTaskId: null, parent_data: null })
    const store = new DbTaskStateStore('r1', p as any)
    await store.allTasks()
    const stats = await store.getStats()
    expect(stats.total).toBe(1)
    expect(stats.success).toBe(1)
  })

  it('isComplete is false with no tasks', async () => {
    const p = mockPersistence()
    const store = new DbTaskStateStore('r1', p as any)
    expect(await store.isComplete()).toBe(false)
  })
})
