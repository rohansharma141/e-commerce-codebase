import type { Product } from '@platform/modules/catalog/contracts';
import { attributeFieldName } from './mapping-manager';

/**
 * Flatten a Product into an OpenSearch document. Each attribute becomes a
 * top-level `attr_<code>` field whose type matches the per-tenant mapping.
 * Dates arrive as ISO strings from the catalog and OpenSearch's date field
 * accepts ISO directly.
 */
export function productToDocument(product: Product): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    id: product.id,
    tenant_id: product.tenantId,
    sku: product.sku,
    name: product.name,
    created_at: product.createdAt,
  };
  for (const [code, value] of Object.entries(product.attributes)) {
    doc[attributeFieldName(code)] = value;
  }
  return doc;
}
