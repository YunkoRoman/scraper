import { program } from 'commander'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { FileParserLoader } from '../infrastructure/loader/FileParserLoader.js'
import { RunParser } from '../application/use-cases/RunParser.js'
import { ParserRunnerService } from '../application/services/ParserRunnerService.js'
import { ConsoleReporter } from './ConsoleReporter.js'
import type { RunStats } from '../domain/entities/ParserRun.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const parsersDir = resolve(__dirname, '../../src/parsers')
const outputDir = resolve(process.cwd(), 'output')

const loader = new FileParserLoader(parsersDir)
const runParser = new RunParser(loader, outputDir)
const runner = new ParserRunnerService(runParser)
const reporter = new ConsoleReporter()

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
      return runner.run(
        name,
        (n, stats) => reporter.update(n, stats as RunStats),
        (n, stats) => reporter.complete(n, stats as RunStats),
        (n, filePath) => reporter.postProcess(n, filePath),
      )
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
