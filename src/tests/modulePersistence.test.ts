import { describe, it, expect, vi } from 'vitest'

const calls: { op: string; v?: unknown }[] = []

vi.mock('../infrastructure/db/client.js', () => {
  const chain: Record<string, unknown> = {}
  chain.insert = () => chain
  chain.values = (v: unknown) => {
    calls.push({ op: 'insert', v })
    return chain
  }
  chain.returning = () =>
    Promise.resolve([
      {
        id: 'f1',
        parserId: 'p1',
        path: 'validate',
        content: 'x',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
  chain.select = () => chain
  chain.from = () => chain
  chain.where = () => {
    calls.push({ op: 'where' })
    return chain
  }
  chain.orderBy = () => Promise.resolve([])
  chain.delete = () => chain
  chain.update = () => chain
  chain.set = (v: unknown) => {
    calls.push({ op: 'set', v })
    return chain
  }
  return { db: chain, pool: {} }
})

import { ModulePersistenceService } from '../infrastructure/db/ModulePersistenceService.js'

describe('ModulePersistenceService', () => {
  it('create() inserts parserId, path, content', async () => {
    const svc = new ModulePersistenceService()
    await svc.create({
      parserId: 'p1',
      path: 'validate',
      content: 'export const validate = () => true',
    })
    const inserted = calls.find((c) => c.op === 'insert')
    expect((inserted?.v as { parserId: string }).parserId).toBe('p1')
    expect((inserted?.v as { path: string }).path).toBe('validate')
    expect((inserted?.v as { content: string }).content).toContain('validate')
  })

  it('update() sets updatedAt alongside provided fields', async () => {
    const svc = new ModulePersistenceService()
    await svc.update('f1', { content: 'changed' })
    const set = calls.find((c) => c.op === 'set')
    expect((set?.v as { content: string }).content).toBe('changed')
    expect((set?.v as { updatedAt?: Date }).updatedAt).toBeInstanceOf(Date)
  })
})
