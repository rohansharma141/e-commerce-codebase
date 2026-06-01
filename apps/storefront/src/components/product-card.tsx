/**
 * Single product tile. Mobile-first: takes the full grid cell width on small
 * screens, sits inside a responsive grid that grows columns at md/lg.
 *
 * Reads loose attributes off the product (`brand`, `color`, `size`, `price`)
 * — they're not in the GraphQL schema's typed projection because they're
 * tenant-defined custom attributes (the platform's signature feature). The
 * server's JSON scalar gives us `any`; we narrow defensively for display.
 */

interface ProductHit {
  id: string;
  sku: string;
  name: string;
  attributes: unknown;
}

interface ProductCardProps {
  product: ProductHit;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function formatCurrency(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function ProductCard({ product }: ProductCardProps) {
  const attrs = asRecord(product.attributes);
  const brand = typeof attrs['brand'] === 'string' ? attrs['brand'] : null;
  const color = typeof attrs['color'] === 'string' ? attrs['color'] : null;
  const size = typeof attrs['size'] === 'string' ? attrs['size'] : null;
  const price = formatCurrency(attrs['price']);
  const inStock = attrs['in_stock'] !== false;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-md focus-within:shadow-md">
      <div className="aspect-square bg-gradient-to-br from-slate-100 to-slate-200" aria-hidden="true">
        <div className="flex h-full items-center justify-center text-xs uppercase tracking-wider text-slate-400">
          {brand ?? 'no image'}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-medium leading-tight text-slate-900">
            {product.name}
          </h3>
          <span className="shrink-0 text-sm font-semibold text-slate-900">{price}</span>
        </div>
        <div className="flex flex-wrap gap-1 text-[11px] text-slate-500">
          {brand ? <Badge label={brand} /> : null}
          {color ? <Badge label={color} /> : null}
          {size ? <Badge label={size} /> : null}
        </div>
        <div className="mt-auto flex items-center justify-between pt-1 text-xs">
          <span className="text-slate-400">{product.sku}</span>
          <span className={inStock ? 'text-emerald-600' : 'text-rose-600'}>
            {inStock ? 'In stock' : 'Out of stock'}
          </span>
        </div>
      </div>
    </article>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 capitalize text-slate-600">
      {label}
    </span>
  );
}
