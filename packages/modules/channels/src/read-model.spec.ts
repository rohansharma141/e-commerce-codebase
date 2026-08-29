import {
  ChannelReadModel,
  type ChannelConfig,
  type IChannelsQuery,
} from '@platform/modules/channels/contracts';

/**
 * The consuming-module read-model (C-14).
 *
 * The backlog's stated check is unusual and worth restating, because it asserts
 * something is *not* required:
 *
 *   > Stop publishing `channels.created`; a write referencing a new channel
 *   > must still succeed via read-through. If it fails, validation is querying
 *   > rather than replicating.
 *
 * The point is that events are an **optimisation**, not a correctness
 * requirement. A replica that only worked once it had seen every message would
 * reject writes for channels that plainly exist — after a restart, after a
 * dropped message, or on the very first request of a cold process.
 *
 * So the tests below come in pairs: one proving a thing works with no events at
 * all, and one proving events actually save the read. Either alone would be
 * satisfied by a broken implementation — events-only fails cold, read-through-
 * only never caches anything and quietly reintroduces the per-write query.
 */

const config = (over: Partial<ChannelConfig> = {}): ChannelConfig =>
  ({
    channelId: 'c1',
    tenantId: 't1',
    key: 'uk',
    name: 'United Kingdom',
    status: 'active',
    isDefault: false,
    currencyCode: 'GBP',
    currencyMinorUnits: 2,
    defaultLocale: 'en-GB',
    supportedLocales: ['en-GB'],
    country: 'GB',
    timezone: 'Europe/London',
    taxDisplay: 'net',
    taxRateBps: 2000,
    ...over,
  }) as ChannelConfig;

/** Counts every call, so "did not query" is assertable rather than assumed. */
class CountingSource implements IChannelsQuery {
  calls: string[] = [];
  constructor(private rows: ChannelConfig[] = [config()]) {}
  async findByKey(t: string, key: string): Promise<ChannelConfig | null> {
    this.calls.push(`findByKey:${key}`);
    return this.rows.find((r) => r.tenantId === t && r.key === key) ?? null;
  }
  async findById(t: string, id: string): Promise<ChannelConfig | null> {
    this.calls.push(`findById:${id}`);
    return this.rows.find((r) => r.tenantId === t && r.channelId === id) ?? null;
  }
  async findDefault(t: string): Promise<ChannelConfig> {
    this.calls.push('findDefault');
    const d = this.rows.find((r) => r.tenantId === t && r.isDefault);
    if (!d) throw new Error('no default');
    return d;
  }
  async listActive(t: string): Promise<readonly ChannelConfig[]> {
    this.calls.push('listActive');
    return this.rows.filter((r) => r.tenantId === t && r.status === 'active');
  }
  /** Makes "the replica answered without asking" provable by making asking fail. */
  breakSource(): void {
    const boom = (): never => {
      throw new Error('source unavailable — the replica should not have asked');
    };
    this.findByKey = boom;
    this.findById = boom;
    this.findDefault = boom;
  }
}

describe('THE C-14 CHECK: events are an optimisation, not a requirement', () => {
  it('resolves a channel it was never told about, via read-through', async () => {
    // No event is ever applied. If this fails, the module is replicating
    // instead of resolving, and a cold process rejects valid writes.
    const source = new CountingSource([config({ key: 'brand-new' })]);
    const rm = new ChannelReadModel(source);

    const found = await rm.findByKey('t1', 'brand-new');
    expect(found?.key).toBe('brand-new');
    expect(source.calls).toEqual(['findByKey:brand-new']);
  });

  it('and having read through once, does not ask again', async () => {
    // The other half. Read-through alone, with no caching, would satisfy the
    // test above while reintroducing exactly the per-write query the design
    // exists to remove.
    const source = new CountingSource([config({ key: 'brand-new' })]);
    const rm = new ChannelReadModel(source);

    await rm.findByKey('t1', 'brand-new');
    source.breakSource();
    const again = await rm.findByKey('t1', 'brand-new');

    expect(again?.key).toBe('brand-new');
    expect(rm.stats.hits).toBe(1);
  });

  it('an event populates the replica with no read at all', async () => {
    const source = new CountingSource();
    const rm = new ChannelReadModel(source);
    source.breakSource();

    rm.onCreated({ channel: {} as never, config: config({ key: 'de' }) });
    const found = await rm.findByKey('t1', 'de');

    expect(found?.key).toBe('de');
    expect(source.calls).toEqual([]); // never asked
  });
});

describe('misses are not cached', () => {
  it('an unknown key is re-asked, not remembered as absent', async () => {
    // Caching a null would make a channel created seconds later unresolvable
    // until the entry expired — turning a miss into a durable wrong answer.
    const source = new CountingSource([]);
    const rm = new ChannelReadModel(source);

    expect(await rm.findByKey('t1', 'nope')).toBeNull();
    expect(await rm.findByKey('t1', 'nope')).toBeNull();
    expect(source.calls).toEqual(['findByKey:nope', 'findByKey:nope']);
  });
});

describe('event application is idempotent', () => {
  it('the same created event twice leaves one entry', async () => {
    // The bus redelivers. A handler that appended would hold two.
    const rm = new ChannelReadModel(new CountingSource());
    const payload = { channel: {} as never, config: config({ key: 'de' }) };

    rm.onCreated(payload);
    rm.onCreated(payload);

    expect(rm.stats.size).toBe(1);
  });

  it('the same archived event twice is harmless', async () => {
    const rm = new ChannelReadModel(new CountingSource());
    rm.onCreated({ channel: {} as never, config: config({ key: 'de' }) });

    const archived = { channelId: 'c1', tenantId: 't1', key: 'de' };
    rm.onArchived(archived);
    expect(() => rm.onArchived(archived)).not.toThrow();
    expect(rm.stats.size).toBe(0);
  });
});

describe('staleness the replica must not keep', () => {
  it('a rename drops the entry filed under the old key', async () => {
    // Otherwise findByKey keeps answering for a key that no longer exists, and
    // a URL built from it resolves to a channel that has moved on.
    const source = new CountingSource([]);
    const rm = new ChannelReadModel(source);

    rm.onCreated({ channel: {} as never, config: config({ key: 'old' }) });
    rm.onUpdated({
      channel: {} as never,
      config: config({ key: 'new' }),
      changed: ['key'],
    });

    expect(await rm.findByKey('t1', 'new')).not.toBeNull();
    // The old key must now miss and fall through to the source, which no
    // longer has it.
    expect(await rm.findByKey('t1', 'old')).toBeNull();
  });

  it('an archived channel stops resolving', async () => {
    const source = new CountingSource([]);
    const rm = new ChannelReadModel(source);
    rm.onCreated({ channel: {} as never, config: config({ key: 'closing' }) });

    expect(await rm.findByKey('t1', 'closing')).not.toBeNull();
    rm.onArchived({ channelId: 'c1', tenantId: 't1', key: 'closing' });
    expect(await rm.findByKey('t1', 'closing')).toBeNull();
  });

  it('a tenant-defaults edit invalidates that tenant wholesale', async () => {
    // The event does not say which channels inherited the edited field, and
    // recomputing here would reimplement inheritance in a second place — the
    // thing resolveChannelConfig exists to prevent. Forget and re-read instead.
    const rm = new ChannelReadModel(new CountingSource([]));
    rm.onCreated({ channel: {} as never, config: config({ channelId: 'a', key: 'a' }) });
    rm.onCreated({ channel: {} as never, config: config({ channelId: 'b', key: 'b' }) });
    expect(rm.stats.size).toBe(2);

    rm.onTenantDefaultsUpdated({
      defaults: { tenantId: 't1' } as never,
      changedFields: ['taxRateBps'],
    });

    expect(rm.stats.size).toBe(0);
  });

  it('invalidating one tenant leaves another tenant warm', async () => {
    // Prefix-matching on the composite key must not over-match. Without this,
    // one tenant editing defaults would cold-start every other tenant.
    const rm = new ChannelReadModel(new CountingSource([]));
    rm.onCreated({ channel: {} as never, config: config({ tenantId: 't1', key: 'a' }) });
    rm.onCreated({
      channel: {} as never,
      config: config({ tenantId: 't2', channelId: 'c2', key: 'a' }),
    });

    rm.invalidateTenant('t1');

    expect(rm.stats.size).toBe(1);
    expect(await rm.findByKey('t2', 'a')).not.toBeNull();
  });

  it('a default change drops both configs so isDefault is not stale', async () => {
    const rm = new ChannelReadModel(new CountingSource([]));
    rm.onCreated({
      channel: {} as never,
      config: config({ channelId: 'old', key: 'old', isDefault: true }),
    });
    rm.onCreated({ channel: {} as never, config: config({ channelId: 'new', key: 'new' }) });

    rm.onDefaultChanged({
      tenantId: 't1',
      newDefaultChannelId: 'new',
      newDefaultKey: 'new',
      previousDefaultChannelId: 'old',
    });

    // Both are dropped rather than mutated: the next read re-fetches with the
    // flag correct, instead of trusting a copy this class edited by hand.
    expect(rm.stats.size).toBe(0);
  });
});

describe('completeness questions are never answered from the replica', () => {
  it('listActive always asks the source', async () => {
    // A partial replica knows the channels it has been told about, not that
    // they are all of them. Serving a subset would silently hide markets.
    const source = new CountingSource([config({ key: 'a' }), config({ channelId: 'c2', key: 'b' })]);
    const rm = new ChannelReadModel(source);

    await rm.listActive('t1');
    await rm.listActive('t1');

    expect(source.calls).toEqual(['listActive', 'listActive']);
  });
});
