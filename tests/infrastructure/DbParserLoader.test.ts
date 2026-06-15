import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/infrastructure/db/client.js', () => ({
  db: {
    select: vi.fn(),
  },
}))

import { DbParserLoader } from '../../src/infrastructure/loader/DbParserLoader.js'
import { db } from '../../src/infrastructure/db/client.js'
import { stepName } from '../../src/domain/value-objects/StepName.js'

const mockSelect = db.select as ReturnType<typeof vi.fn>

describe('DbParserLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when parser not found', async () => {
    mockSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    })
    const loader = new DbParserLoader()
    await expect(loader.load('missing')).rejects.toThrow('Parser "missing" not found')
  })

  it('builds ParserConfig with traverser step', async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            id: 'abc',
            name: 'test',
            entryUrl: 'https://example.com',
            entryStep: 'crawl',
            browserType: 'playwright',
            browserSettings: {},
            retryConfig: { maxRetries: 3 },
            deduplication: true,
            concurrentQuota: null,
          },
        ]),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([
          {
            id: 'step1',
            parserId: 'abc',
            name: 'crawl',
            type: 'traverser',
            outputFile: null,
            code: 'return [{ link: "https://a.com", page_type: "detail", parent_data: {} }]',
            stepSettings: {},
            position: 0,
          },
        ]),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      })

    const loader = new DbParserLoader()
    const config = await loader.load('test')

    expect(config.name).toBe('test')
    expect(config.entryUrl).toBe('https://example.com')
    expect(config.steps.size).toBe(1)
    const step = config.steps.get(stepName('crawl'))!
    expect(step.type).toBe('traverser')
    expect(step.code).toBe(
      'return [{ link: "https://a.com", page_type: "detail", parent_data: {} }]',
    )
    const runnable = step as unknown as { run: (p: unknown, t: unknown) => Promise<unknown> }
    const result = await runnable.run({}, { url: 'https://a.com' })
    expect(result).toEqual([{ link: 'https://a.com', page_type: 'detail', parent_data: {} }])
  })

  it('builds ParserConfig with extractor step', async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([
          {
            id: 'abc',
            name: 'test',
            entryUrl: '',
            entryStep: 'extract',
            browserType: 'playwright',
            browserSettings: {},
            retryConfig: { maxRetries: 5 },
            deduplication: true,
            concurrentQuota: null,
          },
        ]),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([
          {
            id: 'step2',
            parserId: 'abc',
            name: 'extract',
            type: 'extractor',
            outputFile: 'data.csv',
            code: 'return [{ title: "test" }]',
            stepSettings: {},
            position: 0,
          },
        ]),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      })

    const loader = new DbParserLoader()
    const config = await loader.load('test')
    const step = config.steps.get(stepName('extract'))!
    expect(step.type).toBe('extractor')
    expect(step.outputFile).toBe('data.csv')
  })
})
