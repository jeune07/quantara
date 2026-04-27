const productInputSchema = {
  type: 'object',
  required: ['title'],
  properties: {
    title: {
      type: 'string',
      description: 'Primary product name as shown on the page.',
    },
    sku: {
      type: 'string',
      description:
        'Manufacturer or vendor part number / SKU. Empty string if not present.',
    },
    brand: {
      type: 'string',
      description: 'Brand or manufacturer name. Empty string if not present.',
    },
    price: {
      type: 'object',
      description:
        'Price as displayed. Leave empty {} if no price shown (e.g. "Quote only").',
      properties: {
        amount: {
          type: 'number',
          description: 'Numeric value (e.g. 12.99).',
        },
        currency: {
          type: 'string',
          description: 'ISO currency code if determinable (e.g. "USD").',
        },
        raw: {
          type: 'string',
          description: 'Exact price string as shown on page (e.g. "$12.99 each").',
        },
      },
    },
    description: {
      type: 'string',
      description:
        'Short paragraph describing the product. Pull from the visible product description; do not invent.',
    },
    specs: {
      type: 'object',
      description:
        'Key/value technical specifications (e.g. {"Material": "316 Stainless Steel", "Length": "2 in"}). Use the labels as printed.',
      additionalProperties: { type: 'string' },
    },
    variants: {
      type: 'array',
      description:
        'For multi-SKU pages, the list of selectable variants. Empty array if single SKU.',
      items: {
        type: 'object',
        properties: {
          sku: { type: 'string' },
          label: { type: 'string' },
          attributes: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
      },
    },
    images: {
      type: 'array',
      description: 'Absolute image URLs for the product. Skip icons and logos.',
      items: { type: 'string' },
    },
    availability: {
      type: 'string',
      description:
        'Stock status as displayed (e.g. "In stock", "Ships in 1-2 days", "Backordered"). Empty if not shown.',
    },
  },
};

const recordProductTool = {
  name: 'record_product',
  description:
    'Record the structured product information extracted from the page. ' +
    'Leave fields empty rather than guessing — only include data that is visibly present on the page.',
  input_schema: productInputSchema,
};

module.exports = { productInputSchema, recordProductTool };
