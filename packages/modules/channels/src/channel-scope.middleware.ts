import { Inject, Injectable, NotFoundException, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { bindChannel } from '@platform/shared/tenant-context';
import type { ChannelConfig, IChannelsQuery } from '@platform/modules/channels/contracts';
import { CHANNEL_QUERY } from './channel-read-model.provider';

export const CHANNEL_HEADER = 'x-channel-id';

/**
 * Resolves the request's channel and binds it to the tenant context (C-12).
 *
 * ── Why this lives in the channels module, not in `tenant.middleware.ts` ──
 *
 * A boundary constraint, not a preference. `scope:shared` may only depend on
 * `scope:shared`, so the shared tenant middleware cannot reach the channels
 * contracts. It also could not do the work if it wanted to: resolution needs
 * the tenant-bound database connection, which `TenantBindingMiddleware` binds
 * *after* the tenant context exists. So this runs third, and writes into the
 * context the first one created — one AsyncLocalStorage, a field on the
 * existing context, not a parallel mechanism (CHANNEL-MODEL §2).
 *
 * ── What the header carries ──────────────────────────────────────────────
 *
 * `x-channel-id` carries the channel **key**, not the UUID, and the name is
 * the ADR's. Two reasons the value is the key. ADR-0014 §4 defines `id` as
 * "what other modules store" and `key` as "what humans and integrations use" —
 * a request header is an integration surface. And `x-tenant-id` already sets
 * the precedent: it carries `t-fashion`, a human-readable identifier, not a
 * surrogate. Requiring a gateway to know channel UUIDs would also make it do a
 * lookup to build a URL whose segment is the key anyway.
 *
 * ── Absent versus unknown ────────────────────────────────────────────────
 *
 * These are deliberately different, and conflating them is the failure this
 * whole design is arranged against:
 *
 *   - **absent** → leave the context unset. Consumers fall back to the tenant
 *     default, which keeps the shipped storefront working unchanged. The
 *     fallback carries a stated expiry (CAVEATS) precisely so it does not
 *     quietly become permanent.
 *   - **unknown, archived, or belonging to another tenant** → `404`, never a
 *     fallback. Silent fallback means a typo serves a different market's prices
 *     and looks like it worked. Cross-tenant needs no special case: RLS never
 *     returns the row, so it is indistinguishable from unknown, which is the
 *     correct answer rather than a compromise.
 *
 * Resolution is skipped entirely when no header is present, so a request that
 * names no channel costs no query.
 */
@Injectable()
export class ChannelScopeMiddleware implements NestMiddleware {
  /**
   * Depends on the read-model behind CHANNEL_QUERY, not on ChannelsService.
   *
   * This runs on every channel-scoped request, so it is the hot path the
   * replica exists for: a warm entry answers without touching the database at
   * all, and a miss falls through to the source rather than failing.
   */
  constructor(@Inject(CHANNEL_QUERY) private readonly channels: IChannelsQuery) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const raw = req.headers[CHANNEL_HEADER];
    const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!key) {
      next();
      return;
    }

    const tenantId = resolveTenantFromRequest(req);
    const config = await this.channels.findByKey(tenantId, key);
    assertResolved(config, key);
    bindChannel(config.channelId, config.key);
    next();
  }
}

/**
 * The tenant, read back off the header rather than from the context.
 *
 * `TenantMiddleware` has already validated its shape and bound it, so this
 * cannot disagree with what the rest of the request uses — and reading the
 * header keeps this middleware independent of context internals.
 */
function resolveTenantFromRequest(req: Request): string {
  const raw = req.headers['x-tenant-id'];
  const tenantId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!tenantId) {
    // Unreachable in the wired chain: TenantMiddleware rejects this first.
    // Asserted anyway, because "unreachable" is a claim about middleware order
    // that a future reorder could quietly falsify.
    throw new Error('channel scope resolved before the tenant was bound');
  }
  return tenantId;
}

/**
 * Extracted so the absent/unknown distinction can be tested without an HTTP
 * layer — the part most likely to be got wrong is a branch, not the plumbing.
 */
export function assertResolved(
  config: ChannelConfig | null,
  key: string,
): asserts config is ChannelConfig {
  if (!config) {
    throw new NotFoundException(
      `no active channel "${key}" for this tenant. Unknown, archived and ` +
        `cross-tenant channels all report as not found, and none of them falls ` +
        `back to the tenant default — a typo must not silently serve another ` +
        `market's prices.`,
    );
  }
}
