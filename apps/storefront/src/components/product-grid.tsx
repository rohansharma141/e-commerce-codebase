import Link from 'next/link';
import { ProductCard } from './product-card';

interface ProductHit {
  id: string;
  sku: string;
  name: string;
  attributes: unknown;
}

interface ProductGridProps {
  items: readonly ProductHit[];
  total: number;
  latencyMs?: number;
}

export function ProductGrid({ items, total, latencyMs }: ProductGridProps) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-8 text-center">
        <p className="text-base font-medium text-slate-700">No results</p>
        <p className="mt-1 text-sm text-slate-500">Try clearing some filters.</p>
      </div>
    );
  }

  return (
    <section aria-labelledby="results-heading">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 id="results-heading" className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{total.toLocaleString()}</span> products
        </h2>
        {typeof latencyMs === 'number' ? (
          <span className="text-xs text-slate-400">{latencyMs} ms</span>
        ) : null}
      </div>
      <ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4"
        role="list"
      >
        {items.map((p) => (
          <li key={p.id}>
            <Link
              href={`/p/${p.id}`}
              prefetch={false}
              className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 rounded-lg"
            >
              <ProductCard product={p} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
