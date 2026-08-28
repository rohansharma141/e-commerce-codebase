import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  resolveChannelConfig,
  type Channel,
  type ChannelConfig,
  type CreateChannelDto,
  type ResolvedChannel,
  type TenantDefaults,
  type UpdateChannelDto,
  type UpdateTenantDefaultsDto,
} from '@platform/modules/channels/contracts';
import { VersionConflictError } from './channels.repository';
import { ChannelsService, type ChannelStore } from './channels.service';

/**
 * Invariant enforcement at the service layer (C-8b).
 *
 * **These tests run.** They exercise the guards against an in-memory store, so
 * they are real coverage of the rules and of the failure-to-HTTP mapping —
 * independent of the repository's SQL, which has never been run against a
 * database. The seam exists precisely so this uncertainty does not spread: if
 * the SQL turns out to be wrong, these guards are still known-good.
 *
 * What they deliberately do NOT cover, so nobody mistakes green here for
 * green overall: whether the SQL persists what the guards permitted, whether
 * RLS scopes it, and whether concurrent promotion serialises. Those need
 * `channels.integration.spec.ts` and a database.
 *
 * ── What these print if the guards were removed ───────────────────────────
 *
 * Every `rejects` case would resolve instead of throwing, and the fake store
 * would record a write that should never have happened — which is why the
 * assertions check `store.writes` rather than only the thrown error. A service
 * that threw *after* persisting would pass a test that only checked the throw.
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

const channel = (over: Partial<Channel> = {}): Channel => ({
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

/** Records every write, so "rejected" can be distinguished from "rejected after writing". */
class FakeStore implements ChannelStore {
  readonly writes: string[] = [];
  activeCount = 2;
  conflictOnUpdate: number | null = null;
  constructor(private readonly rows: Channel[] = [channel()]) {}

  private resolved(c: Channel): ResolvedChannel {
    return resolveChannelConfig(c, DEFAULTS);
  }

  async findTenantDefaults(): Promise<TenantDefaults | null> {
    return DEFAULTS;
  }
  async updateTenantDefaults(
    _t: string,
    _dto: UpdateTenantDefaultsDto,
    expectedVersion: number,
  ): Promise<TenantDefaults> {
    if (expectedVersion !== DEFAULTS.version) throw new VersionConflictError(DEFAULTS.version);
    this.writes.push('updateTenantDefaults');
    return { ...DEFAULTS, version: DEFAULTS.version + 1 };
  }
  async findByKey(_t: string, key: string): Promise<ChannelConfig | null> {
    const c = this.rows.find((r) => r.key === key && r.status !== 'archived');
    return c ? this.resolved(c).config : null;
  }
  async findById(_t: string, id: string): Promise<ChannelConfig | null> {
    const c = this.rows.find((r) => r.id === id && r.status !== 'archived');
    return c ? this.resolved(c).config : null;
  }
  async findDefault(): Promise<ChannelConfig> {
    const c = this.rows.find((r) => r.isDefault);
    if (!c) throw new Error('no default');
    return this.resolved(c).config;
  }
  async listActive(): Promise<readonly ChannelConfig[]> {
    return this.rows.filter((r) => r.status === 'active').map((r) => this.resolved(r).config);
  }
  async list(): Promise<readonly ResolvedChannel[]> {
    return this.rows.map((r) => this.resolved(r));
  }
  async get(_t: string, id: string): Promise<ResolvedChannel | null> {
    const c = this.rows.find((r) => r.id === id);
    return c ? this.resolved(c) : null;
  }
  async getRaw(_t: string, id: string): Promise<Channel | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async countActive(): Promise<number> {
    return this.activeCount;
  }
  async create(_t: string, dto: CreateChannelDto): Promise<Channel> {
    this.writes.push(`create:${dto.key}`);
    return channel({ key: dto.key, name: dto.name });
  }
  async update(
    _t: string,
    id: string,
    _dto: UpdateChannelDto,
    expectedVersion: number,
  ): Promise<Channel> {
    if (this.conflictOnUpdate !== null) throw new VersionConflictError(this.conflictOnUpdate);
    this.writes.push(`update:${id}`);
    return channel({ id, version: expectedVersion + 1 });
  }
  async promoteDefault(_t: string, id: string): Promise<Channel> {
    this.writes.push(`promote:${id}`);
    return channel({ id, isDefault: true });
  }
}

const make = (rows?: Channel[]): { svc: ChannelsService; store: FakeStore } => {
  const store = new FakeStore(rows);
  return { svc: new ChannelsService(store), store };
};

describe('create', () => {
  it('rejects a malformed key without writing', async () => {
    const { svc, store } = make();
    await expect(svc.create('t1', { key: 'Not Valid', name: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // The half that matters: a service that threw *after* persisting would
    // pass an assertion that only checked the throw.
    expect(store.writes).toEqual([]);
  });

  it('rejects an unsupported currency without writing', async () => {
    const { svc, store } = make();
    await expect(
      svc.create('t1', { key: 'xx', name: 'x', currencyCode: 'XYZ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.writes).toEqual([]);
  });

  it('accepts a valid create, so the guard is not simply refusing everything', async () => {
    const { svc, store } = make();
    await svc.create('t1', { key: 'gb', name: 'Great Britain', currencyCode: 'GBP' });
    expect(store.writes).toEqual(['create:gb']);
  });

  it('reports every violation at once, not just the first', async () => {
    // The back office edits a whole channel in one form; first-error-wins turns
    // one round trip into several.
    const { svc } = make();
    try {
      await svc.create('t1', { key: 'BAD KEY', name: 'x', currencyCode: 'XYZ' });
      throw new Error('expected rejection');
    } catch (e) {
      const body = (e as BadRequestException).getResponse() as { violations: unknown[] };
      expect(body.violations).toHaveLength(2);
    }
  });
});

describe('update', () => {
  it('rejects renaming a key past draft, without writing', async () => {
    const { svc, store } = make([channel({ status: 'active', key: 'us' })]);
    await expect(svc.update('t1', 'c1', { key: 'usa' }, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(store.writes).toEqual([]);
  });

  it('allows renaming a key while draft', async () => {
    const { svc, store } = make([channel({ status: 'draft', key: 'us' })]);
    await svc.update('t1', 'c1', { key: 'usa' }, 1);
    expect(store.writes).toEqual(['update:c1']);
  });

  it('rejects a currency change after transacting, without writing', async () => {
    const { svc, store } = make([channel({ hasTransacted: true, currencyCode: 'USD' })]);
    await expect(
      svc.update('t1', 'c1', { currencyCode: 'EUR' }, 1),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.writes).toEqual([]);
  });

  it('allows a currency change before transacting', async () => {
    const { svc, store } = make([channel({ hasTransacted: false, currencyCode: 'USD' })]);
    await svc.update('t1', 'c1', { currencyCode: 'EUR' }, 1);
    expect(store.writes).toEqual(['update:c1']);
  });

  it('404s an unknown channel rather than reporting a validation failure', async () => {
    const { svc } = make();
    await expect(svc.update('t1', 'nope', { name: 'x' }, 1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('archive', () => {
  it('rejects archiving the default channel, without writing', async () => {
    const { svc, store } = make([channel({ isDefault: true })]);
    await expect(svc.archive('t1', 'c1', 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(store.writes).toEqual([]);
  });

  it('rejects archiving the last active channel', async () => {
    const { svc, store } = make([channel({ status: 'active' })]);
    store.activeCount = 1;
    await expect(svc.archive('t1', 'c1', 1)).rejects.toBeInstanceOf(BadRequestException);
    expect(store.writes).toEqual([]);
  });

  it('allows archiving a non-default channel when others remain active', async () => {
    const { svc, store } = make([channel({ status: 'active', isDefault: false })]);
    store.activeCount = 2;
    await svc.archive('t1', 'c1', 1);
    expect(store.writes).toEqual(['update:c1']);
  });

  it('applies the same guards when status is set through a plain update', async () => {
    // Archiving routes through the update validator rather than a separate
    // path, so the default-channel rule cannot be sidestepped by calling
    // update({status:'archived'}) instead of archive().
    const { svc, store } = make([channel({ isDefault: true })]);
    await expect(
      svc.update('t1', 'c1', { status: 'archived' }, 1),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.writes).toEqual([]);
  });

  it('reads the active count per write rather than trusting a stale one', async () => {
    const { svc, store } = make([channel({ status: 'active' })]);
    store.activeCount = 2;
    await svc.archive('t1', 'c1', 1); // permitted
    store.activeCount = 1;
    await expect(svc.archive('t1', 'c1', 2)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('promoteDefault', () => {
  it.each(['draft', 'archived'] as const)('rejects promoting a %s channel', async (status) => {
    const { svc, store } = make([channel({ status })]);
    await expect(svc.promoteDefault('t1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(store.writes).toEqual([]);
  });

  it('allows promoting an active channel', async () => {
    const { svc, store } = make([channel({ status: 'active' })]);
    await svc.promoteDefault('t1', 'c1');
    expect(store.writes).toEqual(['promote:c1']);
  });
});

describe('version conflicts become 409 with the current version', () => {
  it('maps a store conflict onto a 409 body carrying currentVersion', async () => {
    const { svc, store } = make([channel({ status: 'draft' })]);
    store.conflictOnUpdate = 7;
    try {
      await svc.update('t1', 'c1', { name: 'x' }, 1);
      throw new Error('expected a conflict');
    } catch (e) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = (e as ConflictException).getResponse() as Record<string, unknown>;
      // The shape ADMIN-API.md fixed before anything returned a 409, so the
      // first client to meet one adopts it rather than inventing another.
      expect(body['statusCode']).toBe(409);
      expect(body['currentVersion']).toBe(7);
    }
  });

  it('maps a tenant-defaults conflict the same way', async () => {
    const { svc } = make();
    await expect(
      svc.updateTenantDefaults('t1', { taxRateBps: 100 }, 999),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('passes the expected version through when it matches', async () => {
    const { svc, store } = make();
    await svc.updateTenantDefaults('t1', { taxRateBps: 100 }, DEFAULTS.version);
    expect(store.writes).toEqual(['updateTenantDefaults']);
  });
});
