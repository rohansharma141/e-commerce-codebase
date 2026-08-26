import Link from 'next/link';
import {
  type SortKey,
  type StorefrontSearchParams,
  type ViewMode,
  urlWithOverrides,
} from '@/lib/search-params';

interface ToolbarProps {
  basePath: string;
  searchParams: StorefrontSearchParams;
  sort: SortKey;
  view: ViewMode;
  total: number;
  latencyMs?: number;
}

const SORT_OPTIONS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'price-asc', label: 'Price: low to high' },
  { key: 'price-desc', label: 'Price: high to low' },
  { key: 'name-asc', label: 'Name: A to Z' },
];

/**
 * The bar above the product grid. URL-state-driven like the rest of the
 * browse page — sort and view selections are <Link>s with the corresponding
 * URL override, no client JS. The native <details> element backs the sort
 * dropdown so it works without any framework primitives.
 */
export function Toolbar({
  basePath,
  searchParams,
  sort,
  view,
  total,
  latencyMs,
}: ToolbarProps) {
  const currentSort = SORT_OPTIONS.find((s) => s.key === sort) ?? SORT_OPTIONS[0];

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="text-sm opacity-70">
        <span className="font-semibold opacity-100">{total.toLocaleString()}</span> products
        {typeof latencyMs === 'number' ? (
          <span className="ml-2 text-xs opacity-50">· {latencyMs} ms</span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <details className="group relative">
          <summary className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white/90 px-3 py-1.5 text-sm text-slate-800 marker:hidden hover:bg-slate-100">
            <span className="opacity-60">Sort:</span>
            <span className="font-medium">{currentSort.label}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="opacity-60 group-open:rotate-180 transition-transform"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </summary>
          <ul
            className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white text-slate-800 shadow-lg"
            role="listbox"
          >
            {SORT_OPTIONS.map((opt) => {
              const active = opt.key === sort;
              const href = urlWithOverrides(basePath, searchParams, {
                sort: opt.key === 'relevance' ? null : opt.key,
                page: null,
              });
              return (
                <li key={opt.key}>
                  <Link
                    href={href}
                    prefetch={false}
                    role="option"
                    aria-selected={active}
                    className={
                      'block px-3 py-2 text-sm hover:bg-slate-100 ' +
                      (active ? 'font-semibold text-brand' : 'text-slate-700')
                    }
                  >
                    {opt.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
        <ViewToggle basePath={basePath} searchParams={searchParams} view={view} />
      </div>
    </div>
  );
}

function ViewToggle({
  basePath,
  searchParams,
  view,
}: {
  basePath: string;
  searchParams: StorefrontSearchParams;
  view: ViewMode;
}) {
  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-slate-300 bg-white/90 text-slate-800"
      role="group"
      aria-label="View"
    >
      <ViewOption
        href={urlWithOverrides(basePath, searchParams, { view: null })}
        active={view === 'grid'}
        label="Grid"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </ViewOption>
      <ViewOption
        href={urlWithOverrides(basePath, searchParams, { view: 'list' })}
        active={view === 'list'}
        label="List"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </ViewOption>
    </div>
  );
}

function ViewOption({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      className={
        'flex items-center gap-1 px-2.5 py-1.5 text-xs ' +
        (active ? 'bg-brand text-brand-fg' : 'text-slate-600 hover:bg-slate-100')
      }
    >
      {children}
    </Link>
  );
}
