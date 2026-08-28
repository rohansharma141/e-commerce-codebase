import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentTenant, type TenantContext } from '@platform/shared/tenant-context';
import type { ResolvedChannel } from '@platform/modules/channels/contracts';
import { ChannelsService } from './channels.service';
import {
  ChannelListResponse,
  ChannelResponse,
  CreateChannelBody,
  ResolvedChannelResponse,
  TenantDefaultsResponse,
  UpdateChannelBody,
  UpdateTenantDefaultsBody,
} from './channels.schema';

/**
 * Admin surface for channels, following the C-1 conventions
 * (`docs/design/ADMIN-API.md`): cursor pagination in the shared shape, the
 * standard Nest error envelope, `PATCH` merging with explicit-null meaning
 * inherit, and `409` carrying `currentVersion`.
 *
 * **Tenant-scoped only, deliberately.** No `/api/{tenant}/{channel}` segment
 * here even after C-2b lands: admin *manages* channels, and scoping a
 * channel-management call to a single channel is theatre. Recorded as a
 * non-goal in ADR-0014 §2 and gate G-2 so nobody later "completes" the pattern.
 *
 * Optimistic concurrency travels as `If-Match`. The value is the `version` from
 * a prior read — a weak ETag would be equivalent, and the plain integer is what
 * the 409 body returns, so a client re-reads and retries with one value rather
 * than translating between two representations.
 */
@ApiTags('Channels (admin)')
@Controller('admin')
export class ChannelsController {
  constructor(private readonly service: ChannelsService) {}

  /** Sets are not JSON. Converted once, at the boundary that has to serialise. */
  private static present(r: ResolvedChannel): ResolvedChannelResponse {
    return { config: r.config, inherited: [...r.inherited] } as ResolvedChannelResponse;
  }

  /**
   * A missing or unparseable `If-Match` is a 400, never a silent unconditional
   * write. Treating an absent precondition as "no precondition" is how
   * optimistic concurrency quietly stops applying to the one client that forgot
   * it — which is the client that overwrites someone else's edit.
   */
  private static expectedVersion(ifMatch: string | undefined): number {
    if (!ifMatch) {
      throw new BadRequestException(
        'If-Match is required on writes. Send the `version` from a prior read; ' +
          'a mismatch returns 409 with the current version.',
      );
    }
    const parsed = Number.parseInt(ifMatch.replace(/^W\/|"/g, '').trim(), 10);
    if (!Number.isInteger(parsed)) {
      throw new BadRequestException(`If-Match must be an integer version, got "${ifMatch}"`);
    }
    return parsed;
  }

  // ── channels ────────────────────────────────────────────────────────────

  @Get('channels')
  @ApiOperation({ summary: 'List channels (by key, cursor-paginated; includes drafts and archived)' })
  @ApiQuery({ name: 'limit', required: false, example: 50, description: 'Defaults to 50, max 100.' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Opaque token from a previous response\'s nextCursor. Do not parse it.',
  })
  @ApiOkResponse({ type: ChannelListResponse })
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<ChannelListResponse> {
    const page = await this.service.listPage(tenant.tenantId, {
      limit: limit === undefined ? undefined : Number.parseInt(limit, 10),
      cursor,
    });
    return {
      items: page.items.map(ChannelsController.present),
      nextCursor: page.nextCursor,
    };
  }

  @Get('channels/:id')
  @ApiOperation({ summary: 'Get one channel, with which fields are inherited' })
  @ApiOkResponse({ type: ResolvedChannelResponse })
  async get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ResolvedChannelResponse> {
    const found = await this.service.get(tenant.tenantId, id);
    // A channel belonging to another tenant is invisible rather than
    // forbidden — RLS never returned it, and "forbidden" would confirm it
    // exists.
    if (!found) throw new NotFoundException(`no channel ${id}`);
    const raw = await this.service.getRawVersion(tenant.tenantId, id);
    if (raw !== null) res.setHeader('ETag', String(raw));
    return ChannelsController.present(found);
  }

  @Post('channels')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a channel (defaults to draft)' })
  @ApiOkResponse({ type: ChannelResponse })
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: CreateChannelBody,
  ): Promise<ChannelResponse> {
    return this.service.create(tenant.tenantId, dto) as Promise<ChannelResponse>;
  }

  @Patch('channels/:id')
  @ApiOperation({
    summary: 'Update a channel. Omitted fields are left alone; explicit null resumes inheriting.',
  })
  @ApiHeader({
    name: 'If-Match',
    required: true,
    description: 'The `version` from a prior read. Required — an absent precondition is a 400.',
  })
  @ApiOkResponse({ type: ChannelResponse })
  @ApiConflictResponse({
    description:
      'Someone else wrote first. The body carries `currentVersion` so a client can re-read and retry in one more round trip.',
  })
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateChannelBody,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ChannelResponse> {
    return this.service.update(
      tenant.tenantId,
      id,
      dto,
      ChannelsController.expectedVersion(ifMatch),
    ) as Promise<ChannelResponse>;
  }

  @Post('channels/:id/archive')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Archive a channel. Rejected for the default and for the last active channel.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: ChannelResponse })
  archive(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Headers('if-match') ifMatch?: string,
  ): Promise<ChannelResponse> {
    return this.service.archive(
      tenant.tenantId,
      id,
      ChannelsController.expectedVersion(ifMatch),
    ) as Promise<ChannelResponse>;
  }

  /**
   * Promotion carries no `If-Match`.
   *
   * It is not a field edit: it moves a flag between two rows in one
   * transaction, and the meaningful precondition is "this channel is active",
   * which the service checks against current state. Demanding a version here
   * would make two operators promoting the same channel a conflict, when they
   * agree about the outcome.
   */
  @Post('channels/:id/promote-default')
  @HttpCode(200)
  @ApiOperation({ summary: 'Make this the tenant default. Must be active.' })
  @ApiOkResponse({ type: ChannelResponse })
  promoteDefault(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ChannelResponse> {
    return this.service.promoteDefault(tenant.tenantId, id) as Promise<ChannelResponse>;
  }

  // ── tenant defaults ─────────────────────────────────────────────────────
  //
  // Distinct from `/admin/tenant-config`, which is pricing's and predates this.
  // The two overlap on currency, locale and tax rate during the transition;
  // C-18 makes `capabilities` compose from the channels contract instead, after
  // which pricing's copy stops being read on this path.

  @Get('tenant-defaults')
  @ApiOperation({ summary: 'The per-tenant baseline every channel inherits from' })
  @ApiOkResponse({ type: TenantDefaultsResponse })
  async getDefaults(
    @CurrentTenant() tenant: TenantContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TenantDefaultsResponse> {
    const defaults = await this.service.getTenantDefaults(tenant.tenantId);
    res.setHeader('ETag', String(defaults.version));
    return defaults as TenantDefaultsResponse;
  }

  @Patch('tenant-defaults')
  @ApiOperation({
    summary: 'Update the baseline. Changes every channel that has not overridden the edited field.',
  })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOkResponse({ type: TenantDefaultsResponse })
  updateDefaults(
    @CurrentTenant() tenant: TenantContext,
    @Body() dto: UpdateTenantDefaultsBody,
    @Headers('if-match') ifMatch?: string,
  ): Promise<TenantDefaultsResponse> {
    return this.service.updateTenantDefaults(
      tenant.tenantId,
      dto,
      ChannelsController.expectedVersion(ifMatch),
    ) as Promise<TenantDefaultsResponse>;
  }
}
