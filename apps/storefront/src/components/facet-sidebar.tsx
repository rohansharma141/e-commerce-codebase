import Link from 'next/link';
import { urlWithOverrides } from '@/lib/search-params';

interface FacetBucket {
  value: string;
  count: number;
}

interface Facet {
  attribute: string;
  buckets: readonly FacetBucket[];
}

interface FacetSidebarProps {
  facets: readonly Facet[];
  selections: ReadonlyMap<string, ReadonlySet<string>>;
  baseSearchParams: Record<string, string | string[] | undefined>;
  basePath: string;
  priceMin: number | null;
  priceMax: number | null;
  inStockOnly: boolean;
}

/**
 * URL-state-driven facets + range + boolean filters. No client JS — every
 * facet bucket is a <Link>, the price range is a small <form method="get">,
 * the in-stock toggle is a <Link>. Server re-renders on every change.
 * Active filters survive every interaction (carried as hidden inputs / extra
 * querystring values).
 */
export function FacetSidebar({
  facets,
  selections,
  baseSearchParams,
  basePath,
  priceMin,
  priceMax,
  inStockOnly,
}: FacetSidebarProps) {
  const filterableFacets = facets.filter((f) => f.buckets.length > 0);
  const hasAnySelection =
    selections.size > 0 ||
    priceMin !== null ||
    priceMax !== null ||
    inStockOnly;

  return (
    <aside className="lg:sticky lg:top-4 lg:self-start" aria-label="Filters">
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-slate-800">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
          {hasAnySelection ? (
            <Link
              href={basePath}
              className="text-xs text-brand hover:underline"
              prefetch={false}
            >
              Clear all
            </Link>
          ) : null}
        </div>
        <div className="flex flex-col gap-5">
          <PriceRange
            priceMin={priceMin}
            priceMax={priceMax}
            basePath={basePath}
            baseSearchParams={baseSearchParams}
          />
          <InStockToggle
            inStockOnly={inStockOnly}
            basePath={basePath}
            baseSearchParams={baseSearchParams}
          />
          {filterableFacets.map((facet) => {
            const selected = selections.get(facet.attribute) ?? new Set<string>();
            return (
              <FacetGroup
                key={facet.attribute}
                facet={facet}
                selected={selected}
                baseSearchParams={baseSearchParams}
                basePath={basePath}
              />
            );
          })}
        </div>
      </div>
    </aside>
  );
}

function PriceRange({
  priceMin,
  priceMax,
  basePath,
  baseSearchParams,
}: {
  priceMin: number | null;
  priceMax: number | null;
  basePath: string;
  baseSearchParams: Record<string, string | string[] | undefined>;
}) {
  // Hidden inputs carry the rest of the URL state so a price submit doesn't
  // wipe facets / query / sort. We DROP `page` since changing the price
  // band should jump back to page 1.
  const hidden: Array<{ name: string; value: string }> = [];
  for (const [k, v] of Object.entries(baseSearchParams)) {
    if (k === 'price-min' || k === 'price-max' || k === 'page' || v === undefined) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const val of values) hidden.push({ name: k, value: val });
  }

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Price
      </legend>
      <form action={basePath} method="get" className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="price-min">Minimum price</label>
          <span className="text-xs text-slate-500">$</span>
          <input
            id="price-min"
            name="price-min"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            defaultValue={priceMin ?? ''}
            placeholder="Min"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand focus:outline-none"
          />
          <span className="text-xs text-slate-400">–</span>
          <label className="sr-only" htmlFor="price-max">Maximum price</label>
          <span className="text-xs text-slate-500">$</span>
          <input
            id="price-max"
            name="price-max"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            defaultValue={priceMax ?? ''}
            placeholder="Max"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm focus:border-brand focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-between">
          <button
            type="submit"
            className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800"
          >
            Apply
          </button>
          {priceMin !== null || priceMax !== null ? (
            <Link
              href={urlWithOverrides(basePath, baseSearchParams, {
                'price-min': null,
                'price-max': null,
                page: null,
              })}
              prefetch={false}
              className="text-xs text-slate-500 hover:text-slate-900"
            >
              Clear
            </Link>
          ) : null}
        </div>
        {hidden.map((f, i) => (
          <input key={`${f.name}-${i}`} type="hidden" name={f.name} value={f.value} />
        ))}
      </form>
    </fieldset>
  );
}

function InStockToggle({
  inStockOnly,
  basePath,
  baseSearchParams,
}: {
  inStockOnly: boolean;
  basePath: string;
  baseSearchParams: Record<string, string | string[] | undefined>;
}) {
  const href = urlWithOverrides(basePath, baseSearchParams, {
    in_stock: inStockOnly ? null : '1',
    page: null,
  });
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Availability
      </legend>
      <Link
        href={href}
        prefetch={false}
        className={
          'flex items-center gap-2 rounded px-2 py-1 text-sm transition-colors ' +
          (inStockOnly
            ? 'bg-brand/10 text-brand font-medium'
            : 'text-slate-700 hover:bg-slate-100')
        }
      >
        <span
          className={
            'inline-block h-3.5 w-3.5 rounded border ' +
            (inStockOnly ? 'border-brand bg-brand' : 'border-slate-300 bg-white')
          }
          aria-hidden="true"
        />
        In stock only
      </Link>
    </fieldset>
  );
}

function FacetGroup({
  facet,
  selected,
  baseSearchParams,
  basePath,
}: {
  facet: Facet;
  selected: ReadonlySet<string>;
  baseSearchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {facet.attribute}
      </legend>
      <ul className="flex flex-col gap-1.5" role="list">
        {facet.buckets.slice(0, 10).map((bucket) => {
          const isSelected = selected.has(bucket.value);
          const href = toggleFacetHref({
            basePath,
            baseSearchParams,
            attribute: facet.attribute,
            value: bucket.value,
            isSelected,
          });
          return (
            <li key={bucket.value}>
              <Link
                href={href}
                prefetch={false}
                className={
                  'flex items-center justify-between gap-2 rounded px-2 py-1 text-sm transition-colors ' +
                  (isSelected
                    ? 'bg-brand/10 text-brand font-medium'
                    : 'text-slate-700 hover:bg-slate-100')
                }
              >
                <span className="flex items-center gap-2 capitalize">
                  <span
                    className={
                      'inline-block h-3.5 w-3.5 rounded border ' +
                      (isSelected
                        ? 'border-brand bg-brand'
                        : 'border-slate-300 bg-white')
                    }
                    aria-hidden="true"
                  />
                  {bucket.value}
                </span>
                <span className="text-xs text-slate-400">{bucket.count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function toggleFacetHref({
  basePath,
  baseSearchParams,
  attribute,
  value,
  isSelected,
}: {
  basePath: string;
  baseSearchParams: Record<string, string | string[] | undefined>;
  attribute: string;
  value: string;
  isSelected: boolean;
}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(baseSearchParams)) {
    if (k === 'page') continue; // filter change resets pagination
    if (v === undefined) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const val of values) {
      if (k === attribute && val === value) continue; // we're rewriting this one below
      params.append(k, val);
    }
  }
  if (!isSelected) {
    params.append(attribute, value);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
