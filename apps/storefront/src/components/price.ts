/**
 * Convert a tenant-attribute price into a formatted string.
 * Accepts a number (dollars) or undefined / null / wrong-type. Falls back
 * to an em-dash so the layout doesn't collapse on missing data.
 */
export function formatPriceFromAttr(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(v);
}
