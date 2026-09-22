import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';
import { CHANNEL_QUERY, type IChannelsQuery } from '@platform/modules/channels/contracts';
import { TOTALS_SERVICE, type ITotalsService } from '@platform/modules/pricing/contracts';
import { requestChannel } from './request-channel';

/**
 * Refuses every storefront request made in a channel the tenant's price list
 * cannot serve (C-32b, gate G-4).
 *
 * C-32a stopped such a channel being *charged*. This stops it being *shown*:
 * once capabilities report a channel's own currency (C-18), a read in `de`
 * would put € in front of GBP integers — the money bug at display level. The
 * user chose to refuse the channel outright rather than serve it without
 * prices ("Refuse de, API should honor correct incoming request"), so a
 * request here gets the same `422 channel.unservable` a cart would.
 *
 * ── What it guards, and what it does not ──────────────────────────────────
 *
 * Mounted in the composition root on the storefront surfaces only: GraphQL,
 * `/storefront/*`, and `/system/capabilities`, which answers the same question
 * as GraphQL's `capabilities` and must not answer it differently. Admin is
 * not mounted, so an operator can still see an unservable channel and fix it.
 *
 * ── Honouring the correct request ─────────────────────────────────────────
 *
 * The rule follows the currencies, not the channel. A request that named no
 * channel is checked against the tenant default, so if the default itself
 * stops matching the price list, unscoped requests are refused too; and a
 * channel whose currency is brought into line is served again. Only a *known*
 * mismatch is refused:
 *
 *   - a tenant with no price list passes — `assertServable` has nothing to
 *     compare against, and money has its own answer for that case;
 *   - a tenant with no default channel passes, as it did before channels
 *     existed (the C-35 gap). That is `NoDefaultChannelError` specifically;
 *     any other failure still surfaces rather than being waved through;
 *   - a named channel that stopped resolving between being bound and this
 *     check passes on, and the handler answers for it.
 *
 * ── Order ─────────────────────────────────────────────────────────────────
 *
 * Runs after ChannelScopeMiddleware, which binds the named channel. Ahead of
 * it, every request would look unscoped, and `de` would be checked as `uk`
 * and served — which is also why the live check refusing `de` proves the order.
 */
@Injectable()
export class ChannelServabilityMiddleware implements NestMiddleware {
  constructor(
    // The event-fed read-model, as the cart uses: a warm channel is a map lookup.
    @Inject(CHANNEL_QUERY) private readonly channels: IChannelsQuery,
    @Inject(TOTALS_SERVICE) private readonly totals: ITotalsService,
  ) {}

  async use(_req: Request, _res: Response, next: NextFunction): Promise<void> {
    const { tenantId, channelId } = currentTenantOrThrow();
    const channel = await requestChannel(this.channels, tenantId, channelId);
    if (channel) await this.totals.assertServable(tenantId, channel);
    next();
  }
}
