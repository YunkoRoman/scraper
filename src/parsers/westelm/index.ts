import { defineParser } from '../../domain/entities/Parser.js'
import { indexStep } from './steps/index.js'
import { categoryStep } from './steps/category.js'
import { subcategoryStep } from './steps/subcategory.js'
import { productListStep } from './steps/productList.js'
import { productStep } from './steps/product.js'

export default defineParser({
  name: 'westelm',
  entryUrl: 'https://www.westelm.com/',
  entryStep: 'index',
  retryConfig: { maxRetries: 3 },
  concurrentQuota: 50,
  deduplication: true,
  browserSettings: {
    browser_type: 'playwright-stealth',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    contextOptions: {
      locale: 'en-US',
      timezoneId: 'America/New_York',
      viewport: { width: 1440, height: 900 },
    },
    initScripts: [
      `Object.defineProperty(navigator, 'webdriver', { get: () => undefined })`,
      `window.chrome = { runtime: {} }`,
      `Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] })`,
      `Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })`,
    ],
  },
  steps: {
    index: { type: 'traverser', run: indexStep },
    category: { type: 'traverser', run: categoryStep },
    subcategory: { type: 'traverser', run: subcategoryStep },
    ProductList: { type: 'traverser', run: productListStep },
    Product: { type: 'extractor', outputFile: 'westelm-products.csv', run: productStep },
  },
})
