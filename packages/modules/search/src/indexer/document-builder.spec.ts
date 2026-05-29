import type { Product } from '@platform/modules/catalog/contracts';
import { productToDocument } from './document-builder';

const product: Product = {
  id: '1d4c1f70-0000-4000-8000-000000000001',
  tenantId: 't1',
  sku: 'SKU-1',
  name: 'Test',
  attributes: { color: 'red', price: 12.5, in_stock: true },
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

describe('productToDocument', () => {
  it('flattens attributes into attr_<code> fields', () => {
    const doc = productToDocument(product);
    expect(doc['id']).toBe(product.id);
    expect(doc['tenant_id']).toBe('t1');
    expect(doc['sku']).toBe('SKU-1');
    expect(doc['name']).toBe('Test');
    expect(doc['created_at']).toBe(product.createdAt);
    expect(doc['attr_color']).toBe('red');
    expect(doc['attr_price']).toBe(12.5);
    expect(doc['attr_in_stock']).toBe(true);
  });

  it('handles products with no attributes', () => {
    const doc = productToDocument({ ...product, attributes: {} });
    expect(Object.keys(doc).some((k) => k.startsWith('attr_'))).toBe(false);
  });
});
