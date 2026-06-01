/**
 * Storefront theme — per-tenant branding overrides.
 *
 * Lives on `pricing.tenant_config.theme` (JSONB) for storage convenience;
 * the concept is independent of pricing and would migrate to a dedicated
 * branding module in a real extraction. See docs/CAVEATS.md.
 *
 * Fields are intentionally narrow today — enough to make the multi-tenant
 * skinning visibly different on the demo. Easy to grow without a migration
 * because the column is jsonb.
 */
export interface StorefrontTheme {
  /** Display name shown in the header. */
  readonly brandName: string;
  /** Short tagline rendered under the brand name on hero areas. */
  readonly tagline: string;
  /** Emoji or single character used in lieu of a real logo. */
  readonly logoMark: string;
  /** Primary accent color. HSL "h s% l%" tuple ready for CSS var injection. */
  readonly brandHsl: string;
  /** Text color on the primary accent. HSL tuple. */
  readonly brandFgHsl: string;
  /** Page background tint. HSL tuple. */
  readonly pageBgHsl: string;
  /**
   * Font stack. Use CSS-safe entries; the storefront sets `--font-sans` to
   * this value and the layout's `<html>` reads it.
   */
  readonly fontSans: string;
}

export const DEFAULT_THEME: StorefrontTheme = {
  brandName: 'Commerce',
  tagline: 'Multi-tenant headless storefront.',
  logoMark: '◇',
  brandHsl: '220 90% 56%',
  brandFgHsl: '0 0% 100%',
  pageBgHsl: '0 0% 100%',
  fontSans: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
};
