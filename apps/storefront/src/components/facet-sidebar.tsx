import Link from 'next/link';

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
}

/**
 * URL-state-driven facets. No client JS — each bucket is a <Link> whose
 * href is the current querystring with that bucket toggled. The server
 * re-renders the page with the new filters applied. This is the cleanest
 * pattern for SEO + minimal-JS faceted browsing.
 */
export function FacetSidebar({
  facets,
  selections,
  baseSearchParams,
  basePath,
}: FacetSidebarProps) {
  const filterableFacets = facets.filter((f) => f.buckets.length > 0);

  if (filterableFacets.length === 0) {
    return null;
  }

  const hasAnySelection = selections.size > 0;

  return (
    <aside className="lg:sticky lg:top-4 lg:self-start" aria-label="Filters">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
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
