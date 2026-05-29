import { attributeFieldName, buildMapping, osTypeFor } from './mapping-manager';
import type { AttributeDefinition } from '@platform/modules/catalog/contracts';

const def = (partial: Partial<AttributeDefinition>): AttributeDefinition => ({
  id: 'd',
  tenantId: 't',
  code: 'c',
  type: 'string',
  multiValue: false,
  config: {} as AttributeDefinition['config'],
  createdAt: '2026-01-01T00:00:00Z',
  ...partial,
});

describe('mapping-manager', () => {
  it('osTypeFor maps each AttributeType', () => {
    expect(osTypeFor(def({ type: 'string' }))).toEqual({ type: 'keyword' });
    expect(osTypeFor(def({ type: 'enum' }))).toEqual({ type: 'keyword' });
    expect(osTypeFor(def({ type: 'number' }))).toEqual({ type: 'double' });
    expect(osTypeFor(def({ type: 'boolean' }))).toEqual({ type: 'boolean' });
    expect(osTypeFor(def({ type: 'date' }))).toEqual({ type: 'date' });
  });

  it('buildMapping merges base + per-attribute fields', () => {
    const mapping = buildMapping([
      def({ code: 'color', type: 'enum' }),
      def({ code: 'price', type: 'number' }),
    ]);
    expect(mapping.properties['id']).toEqual({ type: 'keyword' });
    expect(mapping.properties['name']).toEqual({
      type: 'text',
      fields: { keyword: { type: 'keyword' } },
    });
    expect(mapping.properties[attributeFieldName('color')]).toEqual({ type: 'keyword' });
    expect(mapping.properties[attributeFieldName('price')]).toEqual({ type: 'double' });
  });

  it('attributeFieldName prefixes with attr_', () => {
    expect(attributeFieldName('color')).toBe('attr_color');
    expect(attributeFieldName('weight_kg')).toBe('attr_weight_kg');
  });
});
