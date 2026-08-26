import Link from 'next/link';
import { ProductCard } from './product-card';
import { ProductRow } from './product-row';
import type { ViewMode } from '@/lib/search-params';
import type { MoneyFormat } from '@/lib/money';

interface ProductHit {
  id: string;
  sku: string;
  name: string;
  attributes: unknown;
}

interface ProductGridProps {
  items: readonly ProductHit[];
  view: ViewMode;
  /** How to render prices. Comes from Query.capabilities, threaded down
   *  rather than re-fetched per card. */
  money: MoneyFormat;
}

const linkClass =
  'block focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 rounded-lg';

/**
 * Branches on `view`. Grid is a responsive 2/3/4-column tile layout; list is
 * a stacked one-per-row layout that fits more attributes per item. Both
 * wrap each item in a <Link prefetch={false}> to the PDP — the same path
 * regardless of how the item is rendered.
 */
export function ProductGrid({ items, view, money }: ProductGridProps) {
  if (items.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-8 text-center">
        <p className="text-base font-medium opacity-80">No results</p>
        <p className="mt-1 text-sm opacity-60">Try clearing some filters.</p>
      </div>
    );
  }

  if (view === 'list') {
    return (
      <ul className="flex flex-col gap-3" role="list">
        {items.map((p) => (
          <li key={p.id}>
            <Link href={`/p/${p.id}`} prefetch={false} className={linkClass}>
              <ProductRow money={money} product={p} />
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4" role="list">
      {items.map((p) => (
        <li key={p.id}>
          <Link href={`/p/${p.id}`} prefetch={false} className={linkClass}>
            <ProductCard money={money} product={p} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
