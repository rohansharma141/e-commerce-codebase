import { Field, ObjectType, Query, Resolver } from '@nestjs/graphql';
import { Injectable } from '@nestjs/common';
import { DEFAULT_THEME, type StorefrontTheme } from '@platform/modules/branding/contracts';
import { currentTenantOrThrow } from '@platform/shared/tenant-context';
import { ThemeRepository } from './theme.repository';

/**
 * Public `Query.theme` for the storefront. Returns the tenant's branding with
 * `DEFAULT_THEME` filling any unset field — the storefront layout always gets
 * a fully-populated object, so it never needs fallback logic of its own.
 *
 * Now served from `branding.theme` rather than the pricing config row. The
 * response shape is unchanged, which is the point: a module boundary moved
 * and no consumer can tell. The storefront's generated types, its cached
 * `theme:<tenant>` tag, and the query text are all exactly as they were.
 *
 * Still deliberately separate from the admin tenant-config endpoints: a
 * storefront has no business learning `taxRateBps` or `currency` from a
 * branding query, and that separation is easier to hold now that the two live
 * in different modules entirely.
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
  constructor(private readonly repo: ThemeRepository) {}

  @Query(() => StorefrontThemeType, { name: 'theme' })
  async theme(): Promise<StorefrontThemeType> {
    const tenant = currentTenantOrThrow();
    const partial = await this.repo.findByTenant(tenant.tenantId);
    return { ...DEFAULT_THEME, ...(partial ?? {}) };
  }
}
