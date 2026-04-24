import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/infrastructure/db/client.js', () => ({
  db: {
    select: vi.fn(),
  },
}))

import { DbParserLoader } from '../../src/infrastructure/loader/DbParserLoader.js'
import { db } from '../../src/infrastructure/db/client.js'

const mockSelect = db.select as ReturnType<typeof vi.fn>

function makeSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(result),
  }
  mockSelect.mockReturnValue(chain)
  return chain
}

describe('DbParserLoader', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws when parser not found', async () => {
    makeSelectChain([])
    const loader = new DbParserLoader()
    await expect(loader.load('missing')).rejects.toThrow('Parser "missing" not found')
  })

  it('builds ParserConfig with traverser step', async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{
          id: 'abc',
          name: 'test',
          entryUrl: 'https://example.com',
          entryStep: 'crawl',
          browserType: 'playwright',
          browserSettings: {},
          retryConfig: { maxRetries: 3 },
          deduplication: true,
          concurrentQuota: null,
        }]),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([{
          id: 'step1',
          parserId: 'abc',
          name: 'crawl',
          type: 'traverser',
          outputFile: null,
          code: 'return [{ link: "https://a.com", page_type: "detail", parent_data: {} }]',
          stepSettings: {},
          position: 0,
        }]),
      })

    const loader = new DbParserLoader()
    const config = await loader.load('test')

    expect(config.name).toBe('test')
    expect(config.entryUrl).toBe('https://example.com')
    expect(config.steps.size).toBe(1)
    const step = config.steps.get('crawl' as any)!
    expect(step.type).toBe('traverser')
    expect(step.code).toBe('return [{ link: "https://a.com", page_type: "detail", parent_data: {} }]')
    const result = await step.run({} as any, { url: 'https://a.com' } as any)
    expect(result).toEqual([{ link: 'https://a.com', page_type: 'detail', parent_data: {} }])
  })

  it('builds ParserConfig with extractor step', async () => {
    mockSelect
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{
          id: 'abc', name: 'test', entryUrl: '', entryStep: 'extract',
          browserType: 'playwright', browserSettings: {}, retryConfig: { maxRetries: 5 },
          deduplication: true, concurrentQuota: null,
        }]),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockResolvedValue([{
          id: 'step2', parserId: 'abc', name: 'extract', type: 'extractor',
          outputFile: 'data.csv', code: 'return [{ title: "test" }]',
          stepSettings: {}, position: 0,
        }]),
      })

    const loader = new DbParserLoader()
    const config = await loader.load('test')
    const step = config.steps.get('extract' as any)! as any
    expect(step.type).toBe('extractor')
    expect(step.outputFile).toBe('data.csv')
  })
})
