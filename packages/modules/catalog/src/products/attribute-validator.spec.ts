import { AttributeValidator } from './attribute-validator';
import type { AttributeDefinition } from '@platform/modules/catalog/contracts';

class StubDefsRepo {
  constructor(private readonly defs: AttributeDefinition[]) {}
  listByTenant(_tenantId: string): Promise<readonly AttributeDefinition[]> {
    return Promise.resolve(this.defs);
  }
}

const TENANT = 't1';

const def = <T extends AttributeDefinition['type']>(
  partial: Omit<AttributeDefinition<T>, 'id' | 'tenantId' | 'createdAt'>,
): AttributeDefinition<T> => ({
  id: 'fake-id',
  tenantId: TENANT,
  createdAt: '2025-01-01T00:00:00.000Z',
  ...partial,
});

const make = (defs: AttributeDefinition[]): AttributeValidator =>
  new AttributeValidator(new StubDefsRepo(defs) as never);

describe('AttributeValidator', () => {
  it('passes when attributes map is empty', async () => {
    const r = await make([]).validate(TENANT, {});
    expect(r.ok).toBe(true);
  });

  it('rejects unknown attribute codes', async () => {
    const r = await make([]).validate(TENANT, { color: 'red' });
    expect(r.ok).toBe(false);
    expect(r.errors[0]?.message).toMatch(/unknown attribute "color"/);
  });

  it('enforces type for string', async () => {
    const v = make([def({ code: 'name', type: 'string', multiValue: false, config: {} })]);
    const ok = await v.validate(TENANT, { name: 'shoe' });
    const bad = await v.validate(TENANT, { name: 42 });
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]?.message).toMatch(/expected string/);
  });

  it('enforces number with min/max', async () => {
    const v = make([
      def({ code: 'weight', type: 'number', multiValue: false, config: { min: 0, max: 10 } }),
    ]);
    expect((await v.validate(TENANT, { weight: 5 })).ok).toBe(true);
    expect((await v.validate(TENANT, { weight: -1 })).ok).toBe(false);
    expect((await v.validate(TENANT, { weight: 11 })).ok).toBe(false);
    expect((await v.validate(TENANT, { weight: 'x' })).ok).toBe(false);
  });

  it('enforces enum allowedValues', async () => {
    const v = make([
      def({
        code: 'color',
        type: 'enum',
        multiValue: false,
        config: { allowedValues: ['red', 'blue'] },
      }),
    ]);
    expect((await v.validate(TENANT, { color: 'red' })).ok).toBe(true);
    const bad = await v.validate(TENANT, { color: 'purple' });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]?.message).toMatch(/not in allowedValues/);
  });

  it('handles multi-value arrays', async () => {
    const v = make([
      def({
        code: 'tags',
        type: 'string',
        multiValue: true,
        config: {},
      }),
    ]);
    const ok = await v.validate(TENANT, { tags: ['a', 'b'] });
    expect(ok.ok).toBe(true);
    expect(ok.normalized['tags']).toEqual(['a', 'b']);

    const notArray = await v.validate(TENANT, { tags: 'a' });
    expect(notArray.ok).toBe(false);

    const wrongElem = await v.validate(TENANT, { tags: ['a', 5] });
    expect(wrongElem.ok).toBe(false);
    expect(wrongElem.errors[0]?.message).toMatch(/\[1\].*expected string/);
  });

  it('normalizes date strings to ISO', async () => {
    const v = make([def({ code: 'launched_on', type: 'date', multiValue: false, config: {} })]);
    const ok = await v.validate(TENANT, { launched_on: '2025-03-15' });
    expect(ok.ok).toBe(true);
    expect(ok.normalized['launched_on']).toBe('2025-03-15T00:00:00.000Z');

    const bad = await v.validate(TENANT, { launched_on: 'not-a-date' });
    expect(bad.ok).toBe(false);
  });

  it('reports every error rather than failing fast', async () => {
    const v = make([
      def({ code: 'a', type: 'string', multiValue: false, config: {} }),
      def({ code: 'b', type: 'number', multiValue: false, config: {} }),
    ]);
    const r = await v.validate(TENANT, { a: 1, b: 'x', c: 'ghost' });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(3);
  });
});
