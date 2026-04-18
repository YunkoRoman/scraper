import { defineParser } from '../../domain/entities/Parser.js'

export default defineParser({
  name: 'example',
  entryUrl: 'https://books.toscrape.com/',
  entryStep: 'categoryList',
  retryConfig: { maxRetries: 3 },
  deduplication: true,
  steps: {
    categoryList: {
      type: 'traverser',
      linkSelector: 'div.side_categories ul li ul li a',
      parentDataSelectors: {
        category: 'div.side_categories ul li ul li a',
      },
      nextStep: 'bookList',
    },
    bookList: {
      type: 'traverser',
      linkSelector: 'article.product_pod h3 a',
      nextPageSelector: 'li.next a',
      nextStep: 'bookDetail',
    },
    bookDetail: {
      type: 'extractor',
      outputFile: 'books.csv',
      dataSelectors: {
        title: 'h1',
        price: 'p.price_color',
        availability: 'p.availability',
        rating: 'p.star-rating',
      },
    },
  },
})
