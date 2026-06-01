/**
 * Text-search bar. Plain HTML form — no client JS needed. Submitting emits
 * a GET to the same path with `?q=<value>` (browser turns the form fields
 * into querystring on method="get"), the server re-renders with the new
 * `q`, the api applies a match query against the product name field.
 *
 * Active facet selections survive a search submit: each non-`q` searchParam
 * is rendered as a hidden input so the form preserves them.
 *
 * Server component on purpose — no client bundle cost, URL state is the
 * single source of truth, the back button works.
 */

interface SearchBarProps {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}

export function SearchBar({ basePath, searchParams }: SearchBarProps) {
  const currentQ =
    typeof searchParams['q'] === 'string'
      ? searchParams['q']
      : Array.isArray(searchParams['q'])
        ? searchParams['q'][0] ?? ''
        : '';

  const hiddenFields: Array<{ name: string; value: string }> = [];
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === 'q' || k === 'page' || v === undefined) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const val of values) hiddenFields.push({ name: k, value: val });
  }

  return (
    <form action={basePath} method="get" role="search" className="w-full">
      <div className="flex gap-2">
        <label htmlFor="search-q" className="sr-only">
          Search products
        </label>
        <div className="relative flex-1">
          <input
            id="search-q"
            type="search"
            name="q"
            defaultValue={currentQ}
            placeholder="Search products, e.g. shirt, camera, novel"
            autoComplete="off"
            className="w-full rounded-md border border-slate-300 bg-white/90 px-3 py-2 text-sm placeholder:opacity-50 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
          {currentQ ? (
            <a
              href={resetHref(basePath, searchParams)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs opacity-50 hover:opacity-90"
              aria-label="Clear search"
            >
              ×
            </a>
          ) : null}
        </div>
        <button
          type="submit"
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:opacity-90"
        >
          Search
        </button>
        {hiddenFields.map((f, i) => (
          <input key={`${f.name}-${i}`} type="hidden" name={f.name} value={f.value} />
        ))}
      </div>
    </form>
  );
}

function resetHref(
  basePath: string,
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === 'q' || k === 'page' || v === undefined) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const val of values) params.append(k, val);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
