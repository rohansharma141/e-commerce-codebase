import type { AttributeDefinition } from '@platform/modules/catalog/contracts';
import type { OsMapping, OsMappingProperty } from '@platform/shared/opensearch';

export const BASE_PROPERTIES: OsMapping['properties'] = {
  id: { type: 'keyword' },
  tenant_id: { type: 'keyword' },
  sku: { type: 'keyword' },
  // Indexed twice: as analyzed text for query-string matching, and as a
  // keyword sub-field for exact-match / sorting.
  name: { type: 'text', fields: { keyword: { type: 'keyword' } } },
  created_at: { type: 'date' },
};

export function attributeFieldName(code: string): string {
  return `attr_${code}`;
}

export function osTypeFor(def: AttributeDefinition): OsMappingProperty {
  switch (def.type) {
    case 'string':
      return { type: 'keyword' };
    case 'number':
      return { type: 'double' };
    case 'boolean':
      return { type: 'boolean' };
    case 'enum':
      return { type: 'keyword' };
    case 'date':
      return { type: 'date' };
    default:
      throw new Error(`Unknown attribute type: ${(def as { type: string }).type}`);
  }
}

export function buildMapping(defs: readonly AttributeDefinition[]): OsMapping {
  const properties: OsMapping['properties'] = { ...BASE_PROPERTIES };
  for (const def of defs) {
    properties[attributeFieldName(def.code)] = osTypeFor(def);
  }
  return { properties };
}

export function attributePropertiesFor(
  defs: readonly AttributeDefinition[],
): OsMapping['properties'] {
  const properties: OsMapping['properties'] = {};
  for (const def of defs) {
    properties[attributeFieldName(def.code)] = osTypeFor(def);
  }
  return properties;
}
