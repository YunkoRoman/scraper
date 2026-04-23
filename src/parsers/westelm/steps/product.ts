import type { Page } from 'playwright'
import type { PageTask } from '../../../domain/entities/PageTask.js'
import { validateProduct } from './product-validator.js'

const MAX_BYTE_SIZE = 399999

interface Attribute {
  valueName: string
  typeName: string
}

interface SelectionValue {
  skuSwatch?: { attributeIds: string[] }
  text?: { attributeId: string }
  attribute?: { attributeId: string }
  thumbnail?: { attributeId: string }
}

interface Sku {
  id: string
  selectionValueIds: string[]
  availability: { available: boolean }
  price: { regularPrice: string; sellingPrice: string }
}

function checkSizeLimit(obj: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(obj)).length >= MAX_BYTE_SIZE
}

function getOptions(attributes: Record<string, Attribute>, productId: string) {
  const grouped: Record<string, string[]> = {}
  for (const entry of Object.values(attributes)) {
    if (!grouped[entry.typeName]) grouped[entry.typeName] = []
    grouped[entry.typeName].push(entry.valueName)
  }
  return Object.entries(grouped).map(([typeName, values], i) => ({
    id: typeName.replaceAll(' ', '_'),
    name: typeName.replaceAll(' ', '_'),
    position: i + 1,
    product_id: productId,
    values,
  }))
}

function getVariants(
  skus: Record<string, Sku>,
  selectionValues: Record<string, SelectionValue>,
  attributes: Record<string, Attribute>,
  result: Record<string, unknown>,
) {
  const variants: Record<string, unknown>[] = []
  let index = 0
  for (const [property, sku] of Object.entries(skus)) {
    ++index
    if (!sku.availability.available) continue

    const variant: Record<string, unknown> = {
      barcode: null,
      compare_at_price: Number.parseFloat(sku.price.regularPrice),
      fulfillment_service: result.retailer_name,
      id: sku.id,
      images: result.images,
      inventory_management: result.retailer_name,
      inventory_policy: 'deny',
      inventory_quantity: null,
      position: index + 1,
      price: Number.parseFloat(sku.price.sellingPrice),
      product_id: result.id,
      product_url: result.product_url,
      sku: property,
      taxable: true,
      description: result.body_html,
      status: 'active',
    }

    const options: string[] = []
    for (const v of sku.selectionValueIds ?? []) {
      const sv = selectionValues[v]
      if (sv.skuSwatch) {
        for (const attrId of sv.skuSwatch.attributeIds) {
          options.push(attributes[attrId].valueName)
        }
      } else {
        const attributeObj = sv.text ?? sv.attribute ?? sv.thumbnail!
        options.push(attributes[attributeObj.attributeId].valueName)
      }
    }

    options.forEach((opt, i) => {
      variant[`option${i + 1}`] = opt
    })
    variant.title = options.join(' / ')

    variants.push(variant)
  }
  return variants
}

export async function productStep(page: Page, task: PageTask) {
  const parentData = (task.parentData ?? {}) as Record<string, string | null | undefined>
  const {
    index_attrs,
    product_type,
    product_type_link,
    category,
    category_link,
    subcategory_link,
  } = parentData

  // Pull __INITIAL_STATE__ directly — page is already loaded
  const productData = await page.evaluate(() => (window as unknown as Record<string, unknown>).__INITIAL_STATE__ as Record<string, unknown>)

  if (!productData?.product) return []
  const pd = productData.product as Record<string, unknown>
  const details = pd.productDetails as Record<string, unknown>
  const subsets = details.subsets as unknown[]
  if (!subsets?.length) return []

  const subset = subsets[0] as Record<string, unknown>
  const defs = subset.definitions as Record<string, unknown>
  const skus = defs.skus as Record<string, Sku>
  const attributes = defs.attributes as Record<string, Attribute>
  const selectionValues = defs.selectionValues as Record<string, SelectionValue>
  const pipTabs = details.pipTabs as Array<{ value: string }>

  // Collect all DOM-dependent data in one round-trip
  const domData = await page.evaluate((pipTabHtml) => {
    const bodyHtml =
      (pipTabHtml
        ? (() => {
            const div = document.createElement('div')
            div.innerHTML = pipTabHtml
            div.querySelectorAll('ul, h6').forEach((el) => el.remove())
            return div.textContent?.trim() ?? ''
          })()
        : null) ||
      (() => {
        const el = document.querySelector("[data-test-id='product-details-description'], [data-style='product-summary-description-wrapper']")
        if (!el) return ''
        const clone = el.cloneNode(true) as Element
        clone.querySelectorAll('ul, h6').forEach((c) => c.remove())
        return clone.textContent?.trim() ?? ''
      })()

    const title =
      document.querySelector("h1[data-test-id='product-title']")?.textContent?.trim() ?? ''

    const productIdAttr = document.querySelector('[productid]')?.getAttribute('productid') ?? null

    // details
    let detailsText = ''
    document
      .querySelectorAll(
        "[data-test-id='product-details-description'] li, [data-test-id='product-summary-description'] li, [data-test-id='product-selling-points-side-copy-0']",
      )
      .forEach((el) => {
        const text = el.textContent?.trim()
        if (text) detailsText += `- ${text} \n`
      })

    // dimensions
    let dimensionsText = ''
    const dimItems = Array.from(
      document.querySelectorAll("[data-test-id='product-dimensions-data'] li"),
    ).filter((el) => el.textContent?.includes(':'))
    dimItems.forEach((el) => {
      const key = el.textContent?.trim()
      const value = el.nextElementSibling?.textContent?.trim()
      if (key && value) dimensionsText += `- ${key} ${value} \n`
    })

    // shipping
    let shippingText = ''
    document
      .querySelectorAll(
        "[data-test-id='shippingAndReturns-desktop-accordion-component'] [data-style='shipping-and-returns-shipping-and-returns-template-component']",
      )
      .forEach((el) => {
        const key = el.querySelector("[data-test-id='dream-pip-shipping-option-title']")?.textContent?.trim()
        const text = el.querySelector("[data-test-id='dream-pip-shipping-option-description']")?.textContent?.trim()
        if (text) shippingText += `- ${key}: ${text} \n`
      })

    // assembly & care
    let assemblyText = ''
    document
      .querySelectorAll("[data-test-id='assembly-care-section-wrapper'] > div")
      .forEach((el) => {
        const key = el.querySelector('h1')?.textContent?.trim()
        const value = el.querySelector('h1')?.nextElementSibling?.textContent?.trim()
        if (key && value) assemblyText += `- ${key}: ${value} \n`
      })

    return {
      bodyHtml,
      title,
      productIdAttr,
      origin: window.location.origin,
      pathname: window.location.pathname,
      href: window.location.href,
      productAttributes: {
        ...(detailsText ? { details: detailsText } : {}),
        ...(dimensionsText ? { demensions: dimensionsText } : {}),
        ...(shippingText ? { shippingAndReturnsPolicy: shippingText } : {}),
        ...(assemblyText ? { assemblyAndCare: assemblyText } : {}),
      },
    }
  }, pipTabs?.[0]?.value ?? null)

  const { bodyHtml, title, productIdAttr, origin: _origin, pathname, href, productAttributes } = domData

  const id = productIdAttr ?? pathname.replace('/products/', '').replace('/', '')
  const images = (details.images as Array<{ path: string }>).map((img, i) => ({
    src: `https://assets.weimgs.com/weimgs/ab/images/wcm/${img.path}xl.jpg`,
    position: i + 1,
    id: `https://assets.weimgs.com/weimgs/ab/images/wcm/${img.path}xl.jpg`,
    product_id: id,
  }))

  const result: Record<string, unknown> = {
    body_html: bodyHtml,
    brand_name: 'West Elm',
    handle: pathname,
    id,
    images,
    options: [],
    product_type: product_type ?? '',
    product_url: href,
    retailer_name: 'West Elm',
    retailer_website: 'https://www.westelm.com',
    tags: [],
    vendor: 'West Elm',
    status: 'active',
    categories: [`${product_type} > ${category ?? '-'}`],
    sub_categories: [`${product_type} > ${category ?? '-'} > ${parentData.subcategory ?? '-'}`],
    product_attributes: productAttributes,
    integration_alias: 'WestElm-web',
    extra: {},
  }

  result.options = getOptions(attributes, id)
  result.variants = getVariants(skus, selectionValues, attributes, result)

  if ((result.variants as unknown[]).length === 0) return []

  result.variant_count = (result.variants as unknown[]).length
  result.title = title
  result._primary_key = id

  if (result.variant_count === 1) {
    result.options = []
    const v = (result.variants as Record<string, unknown>[])[0]
    v.option1 = ''
    v.id = id
    delete v.option2
    delete v.option3
    v.title = ''
    v.description = ''
  }

  if (checkSizeLimit(result)) return []
  if (!validateProduct(result)) throw new Error('Product data validation failed')

  if (index_attrs) {
    result.product_category = category
    result.product_sub_category = parentData.subcategory
    result.product_type_link = product_type_link
    result.product_category_link = category_link
    result.product_sub_category_link = subcategory_link

    for (const [key, val] of Object.entries(productAttributes)) {
      result[`pAttr_${key}`] = val
    }
    for (const [i, opt] of (result.options as Array<{ name: string; values: string[] }>).entries()) {
      result[`pOpt_${opt.name}`] = opt.values
    }
  }

  return [result]
}
