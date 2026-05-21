import { describe, it, expect, vi } from 'vitest'
import { CronExpressionParser } from 'cron-parser'

vi.mock('../infrastructure/db/client.js', () => ({ db: {}, pool: {} }))

describe('cron-parser smoke', () => {
  it('computes next fire date for every-minute cron', () => {
    const it = CronExpressionParser.parse('* * * * *', { currentDate: new Date('2026-05-21T00:00:00Z') })
    const next = it.next().toDate()
    expect(next.getTime()).toBe(new Date('2026-05-21T00:01:00Z').getTime())
  })
})

describe('SchedulerService.nextFireAt', () => {
  it('returns a Date for a valid expression', async () => {
    const { SchedulerService } = await import('../application/services/SchedulerService.js')
    const d = SchedulerService.nextFireAt('0 */6 * * *', new Date('2026-05-21T00:00:00Z'))
    expect(d).toBeInstanceOf(Date)
  })
  it('returns null for an invalid expression', async () => {
    const { SchedulerService } = await import('../application/services/SchedulerService.js')
    expect(SchedulerService.nextFireAt('not-a-cron')).toBeNull()
  })
})
