import { describe, it, expect } from 'vitest'
import type { RunStats } from '../domain/entities/ParserRun.js'

// Pure logic extracted from the route handler
function computeStatus(
  dbStatus: 'running' | 'stopped' | 'idle',
  isRunning: boolean,
): 'running' | 'stopped' | 'idle' {
  return isRunning ? 'running' : dbStatus
}

function applyStatusFilter(
  parsers: { name: string; status: 'running' | 'stopped' | 'idle' }[],
  filter: string,
) {
  if (filter === 'all' || !filter) return parsers
  return parsers.filter((p) => p.status === filter)
}

describe('computeStatus', () => {
  it('overrides db status when runner says running', () => {
    expect(computeStatus('idle', true)).toBe('running')
    expect(computeStatus('stopped', true)).toBe('running')
  })
  it('uses db status when not running', () => {
    expect(computeStatus('stopped', false)).toBe('stopped')
    expect(computeStatus('idle', false)).toBe('idle')
  })
})

describe('applyStatusFilter', () => {
  const list = [
    { name: 'a', status: 'idle' as const },
    { name: 'b', status: 'running' as const },
    { name: 'c', status: 'stopped' as const },
  ]

  it('returns all when filter=all', () => {
    expect(applyStatusFilter(list, 'all')).toHaveLength(3)
  })
  it('filters to running only', () => {
    expect(applyStatusFilter(list, 'running')).toEqual([{ name: 'b', status: 'running' }])
  })
  it('filters to stopped only', () => {
    expect(applyStatusFilter(list, 'stopped')).toEqual([{ name: 'c', status: 'stopped' }])
  })
})

function isInitializing(stats: RunStats | null): boolean {
  if (!stats) return true
  return stats.inProgress > 0 && stats.success === 0
}

describe('isInitializing', () => {
  it('returns true when no stats', () => {
    expect(isInitializing(null)).toBe(true)
  })
  it('returns true when inProgress > 0 and success === 0', () => {
    expect(isInitializing({ total: 5, pending: 0, retry: 0, success: 0, failed: 0, aborted: 0, inProgress: 5, traversers: { total: 5, success: 0, failed: 0 }, extractors: { total: 0, success: 0, failed: 0 } })).toBe(true)
  })
  it('returns false when success > 0', () => {
    expect(isInitializing({ total: 5, pending: 0, retry: 0, success: 2, failed: 0, aborted: 0, inProgress: 3, traversers: { total: 5, success: 2, failed: 0 }, extractors: { total: 0, success: 0, failed: 0 } })).toBe(false)
  })
})
