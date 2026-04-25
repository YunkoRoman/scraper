import { describe, it, expect, afterAll } from 'vitest'
import { RunPersistenceService } from '../../src/infrastructure/db/RunPersistenceService.js'
import { pool } from '../../src/infrastructure/db/client.js'
import { PageState } from '../../src/domain/value-objects/PageState.js'
import { randomUUID } from 'node:crypto'

const svc = new RunPersistenceService()
const runId = randomUUID()
const parserName = `test-parser-${randomUUID().slice(0, 8)}`

afterAll(async () => {
  await pool.query(`DELETE FROM parser_runs WHERE id = $1`, [runId])
  await pool.end()
})

describe('RunPersistenceService', () => {
  it('creates a run record', async () => {
    await svc.createRun(parserName, runId)
    const info = await svc.getLatestRunInfo(parserName)
    expect(info?.id).toBe(runId)
    expect(info?.status).toBe('running')
  })

  it('upserts a task and reads it back', async () => {
    const task = {
      id: randomUUID(),
      url: 'https://example.com',
      stepName: 'extract' as any,
      stepType: 'extractor' as const,
      state: PageState.Success,
      attempts: 1,
      maxAttempts: 5,
      error: undefined,
      parentTaskId: undefined,
      parentData: undefined,
    }
    await svc.upsertTask(runId, task)
    const { tasks } = await svc.getRunTasks(runId, 1, 100)
    expect(tasks.some(t => t.id === task.id)).toBe(true)
  })

  it('marks run as stopped', async () => {
    await svc.markRunStopped(runId, [])
    const info = await svc.getLatestRunInfo(parserName)
    expect(info?.status).toBe('stopped')
  })

  it('loadLatestStoppedRunTasks returns tasks for stopped run', async () => {
    const result = await svc.loadLatestStoppedRunTasks(parserName)
    expect(result?.runId).toBe(runId)
  })
})
