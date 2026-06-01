import { formatPriceFromAttr } from './price';

/**
 * Grid card. Mobile-first inside a responsive grid. Reads tenant-defined
 * custom attributes off the product (brand / color / size / price /
 * in_stock) — they're a JSON blob on the GraphQL hit because the platform's
 * signature feature is tenant-defined typed attributes; the storefront
 * narrows defensively for display.
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

export function ProductCard({ product }: ProductCardProps) {
  const attrs = asRecord(product.attributes);
  const brand = typeof attrs['brand'] === 'string' ? attrs['brand'] : null;
  const color = typeof attrs['color'] === 'string' ? attrs['color'] : null;
  const size = typeof attrs['size'] === 'string' ? attrs['size'] : null;
  const price = formatPriceFromAttr(attrs['price']);
  const inStock = attrs['in_stock'] !== false;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-md focus-within:shadow-md">
      <div className="aspect-square bg-gradient-to-br from-slate-100 to-slate-200" aria-hidden="true">
        <div className="flex h-full items-center justify-center text-xs uppercase tracking-wider text-slate-400">
          {brand ?? 'no image'}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-tight text-slate-900">
          {product.name}
        </h3>
        <div className="flex flex-wrap gap-1 text-[11px] text-slate-500">
          {brand ? <Badge label={brand} /> : null}
          {color ? <Badge label={color} /> : null}
          {size ? <Badge label={size} /> : null}
        </div>
        <div className="mt-auto flex items-baseline justify-between pt-2">
          <span className="text-lg font-bold tracking-tight text-slate-900">{price}</span>
          <span className={inStock ? 'text-xs text-emerald-600' : 'text-xs text-rose-600'}>
            {inStock ? 'In stock' : 'Out'}
          </span>
        </div>
        <div className="text-[11px] text-slate-400">{product.sku}</div>
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
