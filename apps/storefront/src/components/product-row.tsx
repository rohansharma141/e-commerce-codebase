import { Badge } from './ui/badge';
import { Card } from './ui/card';
import { formatPriceFromAttr } from './price';

interface ProductHit {
  id: string;
  sku: string;
  name: string;
  attributes: unknown;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export function ProductRow({ product }: { product: ProductHit }) {
  const attrs = asRecord(product.attributes);
  const brand = typeof attrs['brand'] === 'string' ? attrs['brand'] : null;
  const price = formatPriceFromAttr(attrs['price']);
  const inStock = attrs['in_stock'] !== false;

  const promoted = new Set(['brand', 'price', 'in_stock']);
  const secondary = Object.entries(attrs).filter(
    ([k, v]) => !promoted.has(k) && (typeof v === 'string' || typeof v === 'number'),
  );

  return (
    <Card className="group flex gap-4 p-3 hover:shadow-md focus-within:shadow-md sm:p-4">
      <div className="hidden h-24 w-24 shrink-0 items-center justify-center rounded bg-gradient-to-br from-slate-100 to-slate-200 text-xs uppercase tracking-wider text-slate-400 sm:flex">
        {brand ?? 'no image'}
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <h3 className="text-base font-semibold text-slate-900">{product.name}</h3>
        <p className="text-xs text-slate-500">
          {product.sku}
          {brand ? <span> · {brand}</span> : null}
        </p>
        {secondary.length > 0 ? (
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {secondary.slice(0, 6).map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-1">
                <dt className="font-medium capitalize text-slate-500">{k.replace(/_/g, ' ')}:</dt>
                <dd className="text-slate-700">{String(v)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
      <div className="flex flex-col items-end justify-between gap-1 text-right">
        <span className="text-xl font-bold tracking-tight text-slate-900">{price}</span>
        <Badge variant={inStock ? 'success' : 'danger'}>
          {inStock ? 'In stock' : 'Out of stock'}
        </Badge>
      </div>
    </Card>
  );
}
