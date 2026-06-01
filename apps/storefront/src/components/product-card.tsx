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

export function ProductCard({ product }: { product: ProductHit }) {
  const attrs = asRecord(product.attributes);
  const brand = typeof attrs['brand'] === 'string' ? attrs['brand'] : null;
  const color = typeof attrs['color'] === 'string' ? attrs['color'] : null;
  const size = typeof attrs['size'] === 'string' ? attrs['size'] : null;
  const price = formatPriceFromAttr(attrs['price']);
  const inStock = attrs['in_stock'] !== false;

  return (
    <Card className="group flex h-full flex-col hover:shadow-md focus-within:shadow-md">
      <div className="aspect-square bg-gradient-to-br from-slate-100 to-slate-200" aria-hidden="true">
        <div className="flex h-full items-center justify-center text-xs uppercase tracking-wider text-slate-400">
          {brand ?? 'no image'}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-tight text-slate-900">
          {product.name}
        </h3>
        <div className="flex flex-wrap gap-1">
          {brand ? <Badge className="capitalize">{brand}</Badge> : null}
          {color ? <Badge className="capitalize">{color}</Badge> : null}
          {size ? <Badge className="capitalize">{size}</Badge> : null}
        </div>
        <div className="mt-auto flex items-baseline justify-between pt-2">
          <span className="text-lg font-bold tracking-tight text-slate-900">{price}</span>
          <Badge variant={inStock ? 'success' : 'danger'}>
            {inStock ? 'In stock' : 'Out'}
          </Badge>
        </div>
        <div className="text-[11px] text-slate-400">{product.sku}</div>
      </div>
    </Card>
  );
}
