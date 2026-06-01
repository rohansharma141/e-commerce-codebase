import { Field, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { Injectable } from '@nestjs/common';
import { DEFAULT_THEME, type StorefrontTheme } from '@platform/modules/pricing/contracts';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';
import { TenantConfigRepository } from '../tenant-config/tenant-config.repository';

/**
 * Public `Query.theme` for the storefront. Returns the tenant's branding
 * with `DEFAULT_THEME` filling any unset field — the storefront layout
 * always gets a fully-populated theme object, so it never needs its own
 * fallback logic.
 *
 * Deliberately a separate resolver from the admin TenantConfigController:
 * a storefront should not learn `taxRateBps` or `currency` via a public
 * GraphQL surface, and admin endpoints should not leak through the public
 * graph. The shared storage (one row per tenant on pricing.tenant_config)
 * is an implementation detail.
 */
@ObjectType()
export class StorefrontThemeType implements StorefrontTheme {
  @Field(() => String) brandName!: string;
  @Field(() => String) tagline!: string;
  @Field(() => String) logoMark!: string;
  @Field(() => String) brandHsl!: string;
  @Field(() => String) brandFgHsl!: string;
  @Field(() => String) pageBgHsl!: string;
  @Field(() => String) fontSans!: string;
}

@Injectable()
@Resolver()
export class BrandingResolver {
  constructor(private readonly repo: TenantConfigRepository) {}

  @Query(() => StorefrontThemeType, { name: 'theme' })
  async theme(): Promise<StorefrontThemeType> {
    const tenant = currentTenantOrThrow();
    const partial = await this.repo.findThemeByTenant(tenant.tenantId);
    return { ...DEFAULT_THEME, ...(partial ?? {}) };
  }
}
