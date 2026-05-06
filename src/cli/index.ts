import { program } from 'commander'
import { resolve } from 'node:path'
import { DbParserLoader } from '../infrastructure/loader/DbParserLoader.js'
import { RunParser } from '../application/use-cases/RunParser.js'
import { ParserRunnerService } from '../application/services/ParserRunnerService.js'
import { RunPersistenceService } from '../infrastructure/db/RunPersistenceService.js'
import { ConsoleReporter } from './ConsoleReporter.js'
import type { RunStats } from '../domain/entities/ParserRun.js'

const outputDir = resolve(process.cwd(), 'output')

const loader = new DbParserLoader()
const runPersistence = new RunPersistenceService()
const runParser = new RunParser(loader, outputDir)
const runner = new ParserRunnerService(runParser, runPersistence)
const reporter = new ConsoleReporter()

runner.on('stats', (name: string, stats: RunStats) => reporter.update(name, stats))
runner.on('complete', (name: string, stats: RunStats) => reporter.complete(name, stats))
runner.on('postprocess', (name: string, filePath: string) => reporter.postProcess(name, filePath))

program.name('scraper').description('Universal Playwright scraping platform').version('0.1.0')

program
  .command('run <parsers...>')
  .description('Run one or more parsers concurrently')
  .action(async (parserNames: string[]) => {
    process.on('SIGINT', async () => {
      for (const name of parserNames) {
        if (runner.isRunning(name)) {
          await runner.stop(name)
        }
      }
      process.exit(0)
    })

    const promises = parserNames.map((name) => {
      reporter.start(name)
      return runner.run(name)
    })

    await Promise.all(promises)
  })

program
  .command('stop <parser>')
  .description('Stop a running parser')
  .action(async (parserName: string) => {
    await runner.stop(parserName)
    console.log(`[${parserName}] Stopped.`)
  })

program.parse()
