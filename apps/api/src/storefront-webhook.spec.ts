import { EventBus } from '@platform/shared/event-bus';
import { CHANNELS_EVENTS } from '@platform/modules/channels/contracts';
import { PRICING_EVENTS } from '@platform/modules/pricing/contracts';
import { StorefrontWebhookDispatcher } from './storefront-webhook.module';

/**
 * C-18b: the channel edits that change capabilities are owed to the storefront.
 *
 * Since C-18a capabilities are composed from channels, so pricing's
 * `tenant-config.updated` is no longer the only event that changes them. What
 * this checks is the api half: which events become a webhook owed, and which
 * do not. The storefront half — what those events invalidate — is its own spec.
 *
 * ── What it prints if the dispatcher did nothing new ──────────────────────
 *
 *   `[]` where a channel event was expected: the edit never leaves the api,
 *   and the storefront renders the old locale until its hourly fallback.
 */

const TENANT = 't-fashion';

function setup() {
  process.env['STOREFRONT_REVALIDATE_URL'] = 'http://storefront/api/revalidate';
  process.env['STOREFRONT_REVALIDATE_SECRET'] = 'test-secret';
  const bus = new EventBus();
  const owed: { event: string; tenantId: string }[] = [];
  const outbox = {
    enqueue: async (entry: { event: string; tenantId: string }) => {
      owed.push({ event: entry.event, tenantId: entry.tenantId });
    },
  };
  new StorefrontWebhookDispatcher(bus, outbox as never).onModuleInit();

  const publish = async (name: string, payload: object) => {
    await bus.publish({
      name,
      eventId: `${name}-${Math.random()}`,
      occurredAt: new Date().toISOString(),
      tenantId: TENANT,
      payload: payload as never,
    });
    // Handlers run on a microtask after publish returns; let them.
    await new Promise((r) => setTimeout(r, 0));
  };
  return { publish, owed };
}

afterEach(() => {
  delete process.env['STOREFRONT_REVALIDATE_URL'];
  delete process.env['STOREFRONT_REVALIDATE_SECRET'];
});

it('owes the storefront a webhook for a channel edit that changed something', async () => {
  const { publish, owed } = setup();
  await publish(CHANNELS_EVENTS.Updated, { changed: ['defaultLocale'] });
  expect(owed).toEqual([{ event: 'channels.updated', tenantId: TENANT }]);
});

it('does not for a channel edit that changed nothing — a no-op PATCH must not drop every page', async () => {
  const { publish, owed } = setup();
  await publish(CHANNELS_EVENTS.Updated, { changed: [] });
  expect(owed).toEqual([]);
});

it('owes one for a new default channel', async () => {
  const { publish, owed } = setup();
  await publish(CHANNELS_EVENTS.DefaultChanged, { tenantId: TENANT, newDefaultKey: 'trade' });
  expect(owed).toEqual([{ event: 'channels.default-changed', tenantId: TENANT }]);
});

it('owes one for a tenant-defaults edit that changed something, and not for one that did not', async () => {
  const { publish, owed } = setup();
  await publish(CHANNELS_EVENTS.TenantDefaultsUpdated, { changedFields: ['defaultLocale'] });
  await publish(CHANNELS_EVENTS.TenantDefaultsUpdated, { changedFields: [] });
  expect(owed).toEqual([{ event: 'channels.tenant-defaults.updated', tenantId: TENANT }]);
});

it('still owes one for a pricing config change, as before', async () => {
  const { publish, owed } = setup();
  await publish(PRICING_EVENTS.TenantConfigUpdated, {});
  expect(owed).toEqual([{ event: PRICING_EVENTS.TenantConfigUpdated, tenantId: TENANT }]);
});
