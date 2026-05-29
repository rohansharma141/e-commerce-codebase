/**
 * OpenSearch index names must be lowercase, can contain a–z, 0–9, hyphens and
 * underscores, max 255 chars, can't start with - or _. We slugify the tenant
 * id and prefix to make the namespace unambiguous and a glob like
 * `products-*` easy to scan with `_cat/indices`.
 */
const PREFIX = 'products-';
const MAX_TENANT_LEN = 255 - PREFIX.length;

export function indexNameFor(tenantId: string): string {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error(`indexNameFor: tenantId must be a non-empty string`);
  }
  const slug = tenantId
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new Error(`indexNameFor: tenantId "${tenantId}" reduced to empty after slugify`);
  }
  if (slug.length > MAX_TENANT_LEN) {
    throw new Error(`indexNameFor: tenantId slug too long (${slug.length} > ${MAX_TENANT_LEN})`);
  }
  return `${PREFIX}${slug}`;
}

export const INDEX_PREFIX = PREFIX;
