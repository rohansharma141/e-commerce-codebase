import { EventBus, type DomainEvent } from '@platform/shared/event-bus';
import {
  CHANNELS_EVENTS,
  resolveChannelConfig,
  type Channel,
  type ChannelArchivedPayload,
  type ChannelConfig,
  type ChannelCreatedPayload,
  type ChannelDefaultChangedPayload,
  type ChannelUpdatedPayload,
  type CreateChannelDto,
  type ResolvedChannel,
  type TenantDefaults,
  type TenantDefaultsUpdatedPayload,
  type UpdateChannelDto,
  type UpdateTenantDefaultsDto,
} from '@platform/modules/channels/contracts';
import { ChannelsService, type ChannelStore } from './channels.service';

/**
 * Channel events (C-13).
 *
 * The backlog asks for two things, and they are different questions:
 *
 *   1. **Payload completeness** — no field requires a follow-up lookup. That is
 *      what lets a consumer hold a read-model instead of querying this module
 *      on every write (ADR-0014 §3). Checked by asserting the payload alone
 *      answers what a consumer needs, not that an event merely fired.
 *   2. **Idempotence** — a handler run twice reaches the same state. The bus
 *      redelivers, so a consumer that appends rather than upserts corrupts on
 *      the second delivery.
 *
 * Events go through a real `EventBus`, not a stubbed `publish()`. The bus
 * `structuredClone`s payloads at publish time, which is what actually enforces
 * "network-strict": a Set, a class instance or a function fails here rather
 * than at a network boundary that does not exist yet.
 */

const DEFAULTS: TenantDefaults = {
  tenantId: 't1',
  currencyCode: 'USD',
  defaultLocale: 'en-US',
  supportedLocales: ['en-US'],
  country: 'US',
  timezone: 'America/New_York',
  taxDisplay: 'net',
  taxRateBps: 875,
  version: 3,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
};

const base = (over: Partial<Channel> = {}): Channel => ({
  id: 'c1',
  tenantId: 't1',
  key: 'us',
  name: 'United States',
  status: 'active',
  isDefault: false,
  hasTransacted: false,
  version: 1,
  currencyCode: null,
  defaultLocale: null,
  supportedLocales: null,
  country: null,
  timezone: null,
  taxDisplay: null,
  taxRateBps: null,
  externalRef: null,
  createdAt: '2026-08-28T00:00:00.000Z',
  updatedAt: '2026-08-28T00:00:00.000Z',
  ...over,
});

class Fake implements ChannelStore {
  constructor(private readonly rows: Channel[] = [base()]) {}
  private r(c: Channel): ResolvedChannel {
    return resolveChannelConfig(c, DEFAULTS);
  }
  async findTenantDefaults(): Promise<TenantDefaults | null> {
    return DEFAULTS;
  }
  async updateTenantDefaults(
    _t: string,
    dto: UpdateTenantDefaultsDto,
    _v: number,
  ): Promise<TenantDefaults> {
    return { ...DEFAULTS, ...dto, version: DEFAULTS.version + 1 };
  }
  async findByKey(_t: string, key: string): Promise<ChannelConfig | null> {
    const c = this.rows.find((x) => x.key === key && x.status !== 'archived');
    return c ? this.r(c).config : null;
  }
  async findById(_t: string, id: string): Promise<ChannelConfig | null> {
    const c = this.rows.find((x) => x.id === id && x.status !== 'archived');
    return c ? this.r(c).config : null;
  }
  async findDefault(): Promise<ChannelConfig> {
    const c = this.rows.find((x) => x.isDefault);
    if (!c) throw new Error('no default');
    return this.r(c).config;
  }
  async listActive(): Promise<readonly ChannelConfig[]> {
    return this.rows.filter((x) => x.status === 'active').map((x) => this.r(x).config);
  }
  async list(): Promise<readonly ResolvedChannel[]> {
    return this.rows.map((x) => this.r(x));
  }
  async listPage(): Promise<{ items: readonly ResolvedChannel[]; nextCursor: string | null }> {
    return { items: this.rows.map((x) => this.r(x)), nextCursor: null };
  }
  async get(_t: string, id: string): Promise<ResolvedChannel | null> {
    const c = this.rows.find((x) => x.id === id);
    return c ? this.r(c) : null;
  }
  async getRaw(_t: string, id: string): Promise<Channel | null> {
    return this.rows.find((x) => x.id === id) ?? null;
  }
  async countActive(): Promise<number> {
    return 3;
  }
  async create(_t: string, dto: CreateChannelDto): Promise<Channel> {
    return base({ key: dto.key, name: dto.name, currencyCode: dto.currencyCode ?? null });
  }
  async update(_t: string, id: string, dto: UpdateChannelDto, v: number): Promise<Channel> {
    const cur = this.rows.find((x) => x.id === id) ?? base();
    return { ...cur, ...dto, id, version: v + 1 } as Channel;
  }
  async promoteDefault(_t: string, id: string): Promise<Channel> {
    return base({ id, key: id, isDefault: true });
  }
}

const setup = (rows?: Channel[]): { svc: ChannelsService; events: DomainEvent[] } => {
  const events: DomainEvent[] = [];
  const bus = new EventBus();
  for (const name of Object.values(CHANNELS_EVENTS)) {
    bus.subscribe(name, (e) => {
      events.push(e);
    });
  }
  return { svc: new ChannelsService(new Fake(rows), bus), events };
};

function only<T>(events: DomainEvent[], name: string): T {
  const found = events.filter((e) => e.name === name);
  expect(found).toHaveLength(1);
  return found[0]!.payload as T;
}

describe('payload completeness', () => {
  it('created carries the RESOLVED config, so no consumer needs a follow-up read', async () => {
    // The load-bearing assertion. A payload carrying only the stored row hands
    // consumers `currencyCode: null` and forces them to ask this module what
    // the tenant default is — the cross-module read the design rules out.
    const { svc, events } = setup();
    await svc.create('t1', { key: 'gb', name: 'Great Britain' });

    const p = only<ChannelCreatedPayload>(events, CHANNELS_EVENTS.Created);
    expect(p.channel.currencyCode).toBeNull();
    expect(p.config.currencyCode).toBe('USD');
    expect(p.config.currencyMinorUnits).toBe(2);
    for (const f of [
      'channelId',
      'tenantId',
      'key',
      'status',
      'currencyCode',
      'defaultLocale',
      'country',
      'timezone',
      'taxDisplay',
    ] as const) {
      expect(p.config[f]).toBeDefined();
    }
  });

  it('archived carries the key, not just the id', async () => {
    // Consumers key read-models and cache tags on the key, and must be able to
    // evict without looking it up against a module that just stopped serving it.
    const { svc, events } = setup([base({ status: 'active', key: 'closing' })]);
    await svc.archive('t1', 'c1', 1);

    const p = only<ChannelArchivedPayload>(events, CHANNELS_EVENTS.Archived);
    expect(p.key).toBe('closing');
    expect(p.channelId).toBe('c1');
    expect(p.tenantId).toBe('t1');
  });

  it('archiving emits ONLY archived, never a plain updated', async () => {
    // A consumer subscribed to `updated` alone must not mistake an archival for
    // a config refresh and keep resolving a closed market.
    const { svc, events } = setup([base({ status: 'active' })]);
    await svc.archive('t1', 'c1', 1);
    expect(events.map((e) => e.name)).toEqual([CHANNELS_EVENTS.Archived]);
  });

  it('default-changed names the previous default, read before the promotion', async () => {
    const { svc, events } = setup([
      base({ id: 'old', key: 'old', status: 'active', isDefault: true }),
      base({ id: 'new', key: 'new', status: 'active' }),
    ]);
    await svc.promoteDefault('t1', 'new');

    const p = only<ChannelDefaultChangedPayload>(events, CHANNELS_EVENTS.DefaultChanged);
    expect(p.newDefaultChannelId).toBe('new');
    // Read before the write, or it reports the channel that just won.
    expect(p.previousDefaultChannelId).toBe('old');
  });

  it('tenant-defaults carries the values, not just the tenant id', async () => {
    // Unlike pricing's tenant-config event, which is only a cache-drop signal.
    // This one changes the resolved config of every inheriting channel, so a
    // read-model must RECOMPUTE — impossible without the values.
    const { svc, events } = setup();
    await svc.updateTenantDefaults('t1', { taxRateBps: 2000 }, 3);

    const p = only<TenantDefaultsUpdatedPayload>(events, CHANNELS_EVENTS.TenantDefaultsUpdated);
    expect(p.defaults.currencyCode).toBe('USD');
    expect(p.defaults.country).toBe('US');
    expect(p.changedFields).toContain('taxRateBps');
  });

  it('one tenant-defaults event, not one per affected channel', async () => {
    // Fanning out per channel is a thundering herd on one operator click: a
    // tenant with fifty markets would emit fifty events for a single edit.
    const { svc, events } = setup([
      base({ id: 'a', key: 'a' }),
      base({ id: 'b', key: 'b' }),
      base({ id: 'c', key: 'c' }),
    ]);
    await svc.updateTenantDefaults('t1', { taxRateBps: 2000 }, 3);
    expect(events).toHaveLength(1);
  });
});

describe('changed-field reporting', () => {
  it('reports a field that actually moved', async () => {
    const { svc, events } = setup([base({ status: 'draft', name: 'Before' })]);
    await svc.update('t1', 'c1', { name: 'After' }, 1);
    const p = only<ChannelUpdatedPayload>(events, CHANNELS_EVENTS.Updated);
    expect(p.changed).toContain('name');
  });

  it('does NOT report a field re-sent with the value it already had', async () => {
    // A PATCH may name a field and set it to what it already was. Reporting
    // that as changed invalidates caches for a write that moved nothing, which
    // is why `changed` diffs the stored row rather than trusting the patch keys.
    const { svc, events } = setup([base({ status: 'draft', name: 'Same' })]);
    await svc.update('t1', 'c1', { name: 'Same' }, 1);
    const p = only<ChannelUpdatedPayload>(events, CHANNELS_EVENTS.Updated);
    expect(p.changed).not.toContain('name');
  });
});

describe('network-strictness and idempotence', () => {
  it('payloads survive structuredClone — nothing non-serializable rides along', async () => {
    const { svc, events } = setup();
    await svc.create('t1', { key: 'gb', name: 'GB' });
    expect(() => structuredClone(events[0]!.payload)).not.toThrow();
    expect(JSON.parse(JSON.stringify(events[0]!.payload))).toEqual(events[0]!.payload);
  });

  it('a handler run twice on the same event reaches the same state', async () => {
    // The bus redelivers, so consumers must be idempotent. Modelled as the
    // read-model C-14 will build: upsert by channelId, never append. An
    // appending handler ends with two rows, which is the failure this pins.
    const { svc, events } = setup();
    await svc.create('t1', { key: 'gb', name: 'GB' });
    const payload = events[0]!.payload as ChannelCreatedPayload;

    const readModel = new Map<string, string>();
    const handler = (p: ChannelCreatedPayload): void => {
      readModel.set(p.config.channelId, p.config.currencyCode);
    };

    handler(payload);
    const afterFirst = [...readModel];
    handler(payload);

    expect(readModel.size).toBe(1);
    expect([...readModel]).toEqual(afterFirst);
  });

  it('every event carries the envelope fields a consumer needs to dedupe', async () => {
    // eventId is what makes idempotence implementable at all: without it a
    // consumer cannot tell a redelivery from a second genuine change.
    const { svc, events } = setup();
    await svc.create('t1', { key: 'gb', name: 'GB' });
    const e = events[0]!;
    expect(typeof e.eventId).toBe('string');
    expect(e.eventId.length).toBeGreaterThan(0);
    expect(e.tenantId).toBe('t1');
    expect(Number.isNaN(Date.parse(e.occurredAt))).toBe(false);
  });
});
