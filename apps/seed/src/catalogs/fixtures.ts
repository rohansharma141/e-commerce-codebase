import { faker } from '@faker-js/faker';
import type { AttributeDefinition, AttributeType } from '@platform/modules/catalog/contracts';

export interface AttrSpec {
  readonly code: string;
  readonly type: AttributeType;
  readonly multiValue?: boolean;
  readonly config?: Record<string, unknown>;
  readonly generate: () => unknown;
}

export interface TenantFixture {
  readonly tenantId: string;
  readonly attributes: readonly AttrSpec[];
  readonly productCount: number;
  readonly productName: () => string;
}

const FASHION_BRANDS = ['Acme', 'Nimbus', 'Verdant', 'Halcyon', 'Norden', 'Pilot'];
const FASHION_COLORS = ['black', 'white', 'red', 'blue', 'green', 'yellow', 'grey'];
const FASHION_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const ELECTRONICS_BRANDS = ['Volta', 'Lumiere', 'Onyx', 'Polaris', 'Quanta'];
const ELECTRONICS_CATEGORIES = ['phone', 'laptop', 'tablet', 'headphones', 'monitor', 'camera'];

const BOOK_GENRES = [
  'fiction',
  'non-fiction',
  'biography',
  'science',
  'history',
  'mystery',
  'romance',
  'fantasy',
];

export function defaultFixtures(productsPerTenant: number): readonly TenantFixture[] {
  return [
    {
      tenantId: 't-fashion',
      productCount: productsPerTenant,
      productName: () => `${faker.commerce.productAdjective()} ${faker.commerce.product()}`,
      attributes: [
        {
          code: 'brand',
          type: 'enum',
          config: { allowedValues: FASHION_BRANDS },
          generate: () => faker.helpers.arrayElement(FASHION_BRANDS),
        },
        {
          code: 'color',
          type: 'enum',
          config: { allowedValues: FASHION_COLORS },
          generate: () => faker.helpers.arrayElement(FASHION_COLORS),
        },
        {
          code: 'size',
          type: 'enum',
          config: { allowedValues: FASHION_SIZES },
          generate: () => faker.helpers.arrayElement(FASHION_SIZES),
        },
        {
          code: 'price',
          type: 'number',
          config: { min: 5, max: 500 },
          generate: () => Math.round(faker.number.float({ min: 5, max: 500 }) * 100) / 100,
        },
        {
          code: 'in_stock',
          type: 'boolean',
          generate: () => faker.datatype.boolean({ probability: 0.85 }),
        },
        {
          code: 'released_on',
          type: 'date',
          generate: () =>
            faker.date.between({ from: '2022-01-01', to: '2026-05-01' }).toISOString(),
        },
      ],
    },
    {
      tenantId: 't-electronics',
      productCount: productsPerTenant,
      productName: () =>
        `${faker.helpers.arrayElement(ELECTRONICS_CATEGORIES)} ${faker.commerce.productAdjective()}`,
      attributes: [
        {
          code: 'brand',
          type: 'enum',
          config: { allowedValues: ELECTRONICS_BRANDS },
          generate: () => faker.helpers.arrayElement(ELECTRONICS_BRANDS),
        },
        {
          code: 'category',
          type: 'enum',
          config: { allowedValues: ELECTRONICS_CATEGORIES },
          generate: () => faker.helpers.arrayElement(ELECTRONICS_CATEGORIES),
        },
        {
          code: 'power_watts',
          type: 'number',
          config: { min: 1, max: 2000 },
          generate: () => faker.number.int({ min: 1, max: 2000 }),
        },
        {
          code: 'warranty_years',
          type: 'number',
          config: { min: 0, max: 5 },
          generate: () => faker.number.int({ min: 0, max: 5 }),
        },
        {
          code: 'in_stock',
          type: 'boolean',
          generate: () => faker.datatype.boolean({ probability: 0.75 }),
        },
      ],
    },
    {
      tenantId: 't-books',
      productCount: productsPerTenant,
      productName: () => faker.lorem.words({ min: 2, max: 5 }),
      attributes: [
        {
          code: 'author',
          type: 'string',
          generate: () => faker.person.fullName(),
        },
        {
          code: 'genre',
          type: 'enum',
          config: { allowedValues: BOOK_GENRES },
          generate: () => faker.helpers.arrayElement(BOOK_GENRES),
        },
        {
          code: 'pages',
          type: 'number',
          config: { min: 50, max: 1200 },
          generate: () => faker.number.int({ min: 50, max: 1200 }),
        },
        {
          code: 'published_on',
          type: 'date',
          generate: () =>
            faker.date.between({ from: '1990-01-01', to: '2026-05-01' }).toISOString(),
        },
        {
          code: 'in_stock',
          type: 'boolean',
          generate: () => faker.datatype.boolean({ probability: 0.9 }),
        },
      ],
    },
  ];
}

export function toAttributeDefinition(
  tenantId: string,
  spec: AttrSpec,
  id: string,
): AttributeDefinition {
  return {
    id,
    tenantId,
    code: spec.code,
    type: spec.type,
    multiValue: spec.multiValue ?? false,
    config: (spec.config ?? {}) as AttributeDefinition['config'],
    createdAt: new Date().toISOString(),
  };
}
