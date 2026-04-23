interface FieldSchema {
  type: string
  required?: boolean
  minLength?: number
  possibleValues?: string[]
  items?: string | { type: string; properties: Record<string, FieldSchema> }
  properties?: Record<string, FieldSchema>
}

const PRODUCT_SCHEMA: Record<string, FieldSchema> = {
  body_html: { type: 'string', required: true },
  brand_name: { type: 'string', required: true },
  categories: { type: 'array', required: true, items: 'string' },
  handle: { type: 'string', required: true },
  id: { type: 'string', required: true },
  images: {
    type: 'array',
    required: true,
    minLength: 1,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', required: true },
        position: { type: 'number', required: true },
        product_id: { type: 'string', required: true },
        src: { type: 'string', required: true },
      },
    },
  },
  options: {
    type: 'array',
    required: true,
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', required: true },
        name: { type: 'string', required: true },
        position: { type: 'number', required: true },
        product_id: { type: 'string', required: true },
        values: { type: 'array', required: true, items: 'string' },
      },
    },
  },
  product_type: { type: 'string', required: true },
  product_url: { type: 'string', required: true },
  retailer_name: { type: 'string', required: true },
  retailer_website: { type: 'string', required: true },
  status: { type: 'string', required: true },
  title: { type: 'string', required: true, minLength: 1 },
  variant_count: { type: 'integer', required: true },
  variants: {
    type: 'array',
    required: true,
    minLength: 1,
    items: {
      type: 'object',
      properties: {
        compare_at_price: { type: 'number', required: true },
        fulfillment_service: { type: 'string', required: true },
        id: { type: 'string', required: true },
        inventory_management: { type: 'string', required: true },
        inventory_policy: { type: 'string', required: true },
        option1: { type: 'string', required: false },
        price: { type: 'number', required: true },
        product_id: { type: 'string', required: true },
        product_url: { type: 'string', required: true },
        taxable: { type: 'boolean', required: true },
        description: { type: 'string', required: false },
        status: { type: 'string', possibleValues: ['active', 'inactive'], required: true },
        title: { type: 'string', required: false },
        images: {
          type: 'array',
          required: false,
          minLength: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', required: true },
              position: { type: 'number', required: true },
              product_id: { type: 'string', required: true },
              src: { type: 'string', required: true },
            },
          },
        },
      },
    },
  },
  sub_categories: { type: 'array', required: true, items: 'string' },
  vendor: { type: 'string', required: true },
  integration_alias: { type: 'string', required: true },
  extra: { type: 'object', required: true },
}

function validate(data: Record<string, unknown>, schema: Record<string, FieldSchema>, path = ''): string[] {
  const errors: string[] = []
  for (const key in schema) {
    const field = schema[key]
    const value = data[key]
    const currentPath = path ? `${path}.${key}` : key

    if (field.required && !(key in data)) {
      errors.push(`${currentPath} is required`)
      continue
    }
    if (!(key in data)) continue

    if (field.type === 'string') {
      if (typeof value !== 'string') errors.push(`${currentPath} must be a string`)
      else {
        if (field.possibleValues && !field.possibleValues.includes(value))
          errors.push(`${currentPath} should be one of: [${field.possibleValues.join(',')}]`)
        if (field.minLength && value.length < field.minLength)
          errors.push(`${currentPath} must be at least ${field.minLength} length`)
      }
    } else if (field.type === 'integer') {
      if (!Number.isInteger(value)) errors.push(`${currentPath} must be an integer`)
    } else if (field.type === 'number') {
      if (typeof value !== 'number' || !value) errors.push(`${currentPath} must be a number`)
    } else if (field.type === 'boolean') {
      if (typeof value !== 'boolean') errors.push(`${currentPath} must be a boolean`)
    } else if (field.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`${currentPath} must be an array`)
      } else {
        if (field.minLength && value.length < field.minLength)
          errors.push(`${currentPath} must have at least ${field.minLength} elements`)
        if (field.items) {
          value.forEach((item, i) => {
            if (field.items === 'string') {
              if (typeof item !== 'string') errors.push(`${currentPath}[${i}] must be a string`)
            } else if (typeof field.items === 'object' && field.items.type === 'object') {
              errors.push(...validate(item as Record<string, unknown>, field.items.properties, `${currentPath}[${i}]`))
            }
          })
        }
      }
    } else if (field.type === 'object' && field.properties) {
      errors.push(...validate(value as Record<string, unknown>, field.properties, currentPath))
    }
  }
  return errors
}

function validateVariants(product: Record<string, unknown>): string[] {
  const errors: string[] = []
  const variants = (product.variants as Record<string, unknown>[]) ?? []
  const options = (product.options as unknown[]) ?? []

  if (variants.length <= 1) {
    if (options.length !== 0) errors.push('Product: options must be empty for single-variant products')
    variants.forEach((v, i) => {
      if (v.option2 || typeof v.option2 === 'string')
        errors.push(`Variants[${i}]: option2 must not be set for single-variant products`)
      if (v.option3 || typeof v.option3 === 'string')
        errors.push(`Variants[${i}]: option3 must not be set for single-variant products`)
    })
  } else {
    variants.forEach((v, i) => {
      if (options.length >= 1 && (!v.option1 || typeof v.option1 !== 'string'))
        errors.push(`Variants[${i}]: option1 is required for multi-variant products`)
      if (options.length >= 2 && (!v.option2 || typeof v.option2 !== 'string'))
        errors.push(`Variants[${i}]: option2 is required for products with two options`)
      if (options.length >= 3 && (!v.option3 || typeof v.option3 !== 'string'))
        errors.push(`Variants[${i}]: option3 is required for products with three options`)
    })
  }
  return errors
}

export function validateProduct(product: Record<string, unknown>): boolean {
  const errors = [...validateVariants(product), ...validate(product, PRODUCT_SCHEMA)]
  if (errors.length > 0) {
    console.error('Validation errors:', errors)
    return false
  }
  return true
}
