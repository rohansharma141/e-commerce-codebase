/**
 * Storefront theme — per-tenant branding overrides.
 *
 * The public contract of the branding module. Storage still lives on
 * `pricing.tenant_config.theme` at this point in the extraction; moving the
 * type out first means every consumer is already importing from branding by
 * the time the table moves, so the storage change is invisible to them.
 *
 * Fields are intentionally narrow — enough to make multi-tenant skinning
 * visibly different. Cheap to grow: the column is jsonb, and every field has
 * a default, so an older row missing a new field still renders.
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
