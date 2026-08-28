import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type * as Contract from '@platform/modules/channels/contracts';

/**
 * The channels module's HTTP representation.
 *
 * Same reasoning as `cart.schema.ts`, `orders.schema.ts`, `pricing.schema.ts`
 * and `catalog.schema.ts`: `@nestjs/swagger` reads decorator metadata,
 * interfaces leave none, and `openapi-typescript` turns a `{}` schema into a
 * useless generated type. In `src/`, not `contracts/`, so `@nestjs/swagger`
 * stays out of the package a consumer imports.
 */

const TAX_DISPLAY = ['gross', 'net'];
const STATUS = ['draft', 'active', 'archived'];

export class ChannelConfigResponse implements Contract.ChannelConfig {
  @ApiProperty({ format: 'uuid' })
  readonly channelId!: string;

  @ApiProperty({ example: 't-fashion' })
  readonly tenantId!: string;

  @ApiProperty({ example: 'uk', description: 'Immutable once the channel leaves draft.' })
  readonly key!: string;

  @ApiProperty({ example: 'United Kingdom', description: 'Display only; freely mutable.' })
  readonly name!: string;

  @ApiProperty({ enum: STATUS })
  readonly status!: Contract.ChannelStatus;

  @ApiProperty()
  readonly isDefault!: boolean;

  @ApiProperty({ example: 'GBP', description: 'ISO 4217.' })
  readonly currencyCode!: string;

  @ApiProperty({
    example: 2,
    description:
      'Decimal places for currencyCode, derived from ISO 4217 rather than stored. Every money value in this API is an integer in minor units; a consumer that assumes 2 will be wrong for JPY.',
  })
  readonly currencyMinorUnits!: number;

  @ApiProperty({ example: 'en-GB', description: 'BCP 47. Drives formatting, not translation.' })
  readonly defaultLocale!: string;

  @ApiProperty({ type: [String], example: ['en-GB'] })
  readonly supportedLocales!: readonly string[];

  @ApiProperty({ example: 'GB', description: 'ISO 3166-1 alpha-2.' })
  readonly country!: string;

  @ApiProperty({ example: 'Europe/London', description: 'IANA.' })
  readonly timezone!: string;

  @ApiProperty({
    enum: TAX_DISPLAY,
    description:
      'Whether listed prices include tax. The engine computes both (C-29); until C-30 this reports what the tenant is configured for.',
  })
  readonly taxDisplay!: Contract.TaxDisplay;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 2000,
    description: 'Basis points. One flat rate per channel — no tax classes, no destination-based tax.',
  })
  readonly taxRateBps!: number | null;
}

export class ResolvedChannelResponse {
  @ApiProperty({ type: () => ChannelConfigResponse })
  readonly config!: ChannelConfigResponse;

  @ApiProperty({
    type: [String],
    example: ['country', 'timezone'],
    description:
      'Which fields came from tenant defaults rather than being overridden on this channel. An array, not a set: `inherited` is a Set in the domain model and JSON.stringify turns a Set into `{}`, so it is converted at this boundary. The back office needs this to distinguish "inherited" from "happens to equal the default" — the two look identical in `config` but behave differently when the defaults are edited.',
  })
  readonly inherited!: readonly string[];
}

export class ChannelListResponse {
  @ApiProperty({ type: () => [ResolvedChannelResponse] })
  readonly items!: readonly ResolvedChannelResponse[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque token for the next page, or null on the last page. Do not parse it — the sort key is `key`.',
  })
  readonly nextCursor!: string | null;
}

export class TenantDefaultsResponse implements Contract.TenantDefaults {
  @ApiProperty({ example: 't-fashion' })
  readonly tenantId!: string;

  @ApiProperty({ example: 'USD' })
  readonly currencyCode!: string;

  @ApiProperty({ example: 'en-US' })
  readonly defaultLocale!: string;

  @ApiProperty({ type: [String], example: ['en-US'] })
  readonly supportedLocales!: readonly string[];

  @ApiProperty({ example: 'US' })
  readonly country!: string;

  @ApiProperty({ example: 'America/New_York' })
  readonly timezone!: string;

  @ApiProperty({ enum: TAX_DISPLAY })
  readonly taxDisplay!: Contract.TaxDisplay;

  @ApiProperty({ type: Number, nullable: true, example: 875 })
  readonly taxRateBps!: number | null;

  @ApiProperty({
    example: 3,
    description: 'Send this back as `If-Match` on a write. A mismatch is a 409.',
  })
  readonly version!: number;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt!: string;
}

export class ChannelResponse implements Contract.Channel {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 't-fashion' })
  readonly tenantId!: string;

  @ApiProperty({ example: 'uk' })
  readonly key!: string;

  @ApiProperty({ example: 'United Kingdom' })
  readonly name!: string;

  @ApiProperty({ enum: STATUS })
  readonly status!: Contract.ChannelStatus;

  @ApiProperty()
  readonly isDefault!: boolean;

  @ApiProperty({
    description:
      'Set once an order has been placed on this channel. Freezes currencyCode: changing it afterwards would reinterpret every existing order’s minor-unit integers.',
  })
  readonly hasTransacted!: boolean;

  @ApiProperty({ example: 1, description: 'Send back as `If-Match` on a write.' })
  readonly version!: number;

  // Nullable = inherit. Documented on every one of them, because a consumer
  // seeing `null` must not read it as "empty" or "not set".
  @ApiProperty({ type: String, nullable: true, description: 'null = inherit from tenant defaults.' })
  readonly currencyCode!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'null = inherit.' })
  readonly defaultLocale!: string | null;

  @ApiProperty({ type: [String], nullable: true, description: 'null = inherit.' })
  readonly supportedLocales!: readonly string[] | null;

  @ApiProperty({ type: String, nullable: true, description: 'null = inherit.' })
  readonly country!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'null = inherit.' })
  readonly timezone!: string | null;

  @ApiProperty({ enum: TAX_DISPLAY, nullable: true, description: 'null = inherit.' })
  readonly taxDisplay!: Contract.TaxDisplay | null;

  @ApiProperty({ type: Number, nullable: true, description: 'null = inherit.' })
  readonly taxRateBps!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque mapping to an ERP/OMS/PIM. The platform never interprets it.',
  })
  readonly externalRef!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  readonly updatedAt!: string;
}

export class CreateChannelBody implements Contract.CreateChannelDto {
  @ApiProperty({
    example: 'uk',
    description: 'Lowercase, URL-safe, unique per tenant. Immutable once the channel leaves draft.',
  })
  readonly key!: string;

  @ApiProperty({ example: 'United Kingdom' })
  readonly name!: string;

  @ApiPropertyOptional({
    enum: STATUS,
    default: 'draft',
    description: 'Defaults to draft, so a market can be prepared before it is exposed.',
  })
  readonly status?: Contract.ChannelStatus;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Omit or null to inherit.' })
  readonly currencyCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  readonly defaultLocale?: string | null;

  @ApiPropertyOptional({ type: [String], nullable: true })
  readonly supportedLocales?: readonly string[] | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  readonly country?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  readonly timezone?: string | null;

  @ApiPropertyOptional({ enum: TAX_DISPLAY, nullable: true })
  readonly taxDisplay?: Contract.TaxDisplay | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  readonly taxRateBps?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  readonly externalRef?: string | null;
}

/**
 * `PATCH` merge semantics, and why they are spelled out on the wire:
 *
 *   - **omitted**        → leave alone
 *   - **explicitly null** → resume inheriting
 *
 * JSON distinguishes an absent key from a null one, and this endpoint relies on
 * that. A client that normalises nulls away loses the ability to stop
 * overriding a field.
 */
export class UpdateChannelBody implements Contract.UpdateChannelDto {
  @ApiPropertyOptional({ example: 'UK & Ireland' })
  readonly name?: string;

  @ApiPropertyOptional({ enum: STATUS })
  readonly status?: Contract.ChannelStatus;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'null resumes inheriting.' })
  readonly currencyCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  readonly defaultLocale?: string | null;

  @ApiPropertyOptional({ type: [String], nullable: true })
  readonly supportedLocales?: readonly string[] | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  readonly country?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  readonly timezone?: string | null;

  @ApiPropertyOptional({ enum: TAX_DISPLAY, nullable: true })
  readonly taxDisplay?: Contract.TaxDisplay | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  readonly taxRateBps?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  readonly externalRef?: string | null;
}

export class UpdateTenantDefaultsBody implements Contract.UpdateTenantDefaultsDto {
  @ApiPropertyOptional({ example: 'USD' })
  readonly currencyCode?: string;

  @ApiPropertyOptional({ example: 'en-US' })
  readonly defaultLocale?: string;

  @ApiPropertyOptional({ type: [String] })
  readonly supportedLocales?: readonly string[];

  @ApiPropertyOptional({ example: 'US' })
  readonly country?: string;

  @ApiPropertyOptional({ example: 'America/New_York' })
  readonly timezone?: string;

  @ApiPropertyOptional({ enum: TAX_DISPLAY })
  readonly taxDisplay?: Contract.TaxDisplay;

  @ApiPropertyOptional({ type: Number, nullable: true })
  readonly taxRateBps?: number | null;
}
