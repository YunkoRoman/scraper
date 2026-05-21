import { describe, it, expect, vi } from 'vitest'

const calls: { op: string; v?: unknown; n?: number }[] = []

vi.mock('../infrastructure/db/client.js', () => {
  const chain: Record<string, unknown> = {}
  chain.insert = () => chain
  chain.values = (v: unknown) => { calls.push({ op: 'insert', v }); return chain }
  chain.returning = () => Promise.resolve([{ id: 'v1', stepId: 'step1', code: 'x', savedAt: new Date() }])
  chain.select = () => chain
  chain.from = () => chain
  chain.where = () => chain
  chain.orderBy = () => chain
  chain.limit = (n: number) => { calls.push({ op: 'limit', n }); return Promise.resolve([]) }
  chain.delete = () => chain
  chain.update = () => chain
  chain.set = () => chain
  return { db: chain, pool: {} }
})

import { StepVersionPersistenceService } from '../infrastructure/db/StepVersionPersistenceService.js'

describe('StepVersionPersistenceService', () => {
  it('save() calls insert with stepId + code', async () => {
    const svc = new StepVersionPersistenceService()
    await svc.save('step1', 'console.log("v1")')
    const inserted = calls.find(c => c.op === 'insert')
    expect((inserted?.v as { stepId: string }).stepId).toBe('step1')
    expect((inserted?.v as { code: string }).code).toBe('console.log("v1")')
  })
  it('list() uses limit', async () => {
    const svc = new StepVersionPersistenceService()
    await svc.list('step1', 20)
    expect(calls.some(c => c.op === 'limit' && c.n === 20)).toBe(true)
  })
})
