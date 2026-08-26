'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatMajorUnits, type MoneyFormat } from '@/lib/money';

/**
 * Search input with debounced live suggestions.
 *
 * The native <form method="get"> still works without JS — submitting falls
 * back to a regular browser navigation with `?q=<value>` against the
 * current path. With JS, a debounced fetch to /api/suggest renders a
 * dropdown of the top 8 hits; clicking one navigates to the PDP.
 *
 * Active facet selections etc. survive submit via hidden inputs (same as
 * the pre-autocomplete version).
 */

interface Suggestion {
  id: string;
  name: string;
  sku: string;
  price: number | null;
}

interface SearchBarProps {
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  /** Passed down because this is a client component and cannot reach the
   *  api itself — the server page resolves capabilities once per render. */
  money: MoneyFormat;
}

const DEBOUNCE_MS = 200;
const MIN_QUERY = 2;

export function SearchBar({ basePath, searchParams, money }: SearchBarProps) {
  const initialQ =
    typeof searchParams['q'] === 'string'
      ? searchParams['q']
      : Array.isArray(searchParams['q'])
        ? searchParams['q'][0] ?? ''
        : '';

  const [value, setValue] = useState(initialQ);
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Re-sync from props if the page navigates with a different q.
  useEffect(() => {
    setValue(initialQ);
  }, [initialQ]);

  // Debounced suggest fetch.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/suggest?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('suggest failed');
        const json = (await res.json()) as { items: Suggestion[] };
        setSuggestions(json.items);
      } catch {
        // ignored: typing fast cancels in-flight, we don't want to spam UI
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const hiddenFields: Array<{ name: string; value: string }> = [];
  for (const [k, v] of Object.entries(searchParams)) {
    if (k === 'q' || k === 'page' || v === undefined) continue;
    const values = Array.isArray(v) ? v : [v];
    for (const val of values) hiddenFields.push({ name: k, value: val });
  }

  const showDropdown = open && value.trim().length >= MIN_QUERY;

  return (
    <div ref={containerRef} className="relative w-full">
      <form action={basePath} method="get" role="search" className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50"
            aria-hidden="true"
          />
          <Input
            name="q"
            type="search"
            autoComplete="off"
            placeholder="Search products, e.g. shirt, camera, novel"
            className="pl-9 pr-9"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            aria-expanded={showDropdown}
            aria-autocomplete="list"
            aria-controls="search-suggestions"
          />
          {value ? (
            <button
              type="button"
              onClick={() => {
                setValue('');
                setSuggestions([]);
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-slate-500 hover:bg-slate-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <Button type="submit">Search</Button>
        {hiddenFields.map((f, i) => (
          <input key={`${f.name}-${i}`} type="hidden" name={f.name} value={f.value} />
        ))}
      </form>

      {showDropdown ? (
        <div
          id="search-suggestions"
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-slate-200 bg-white text-slate-800 shadow-lg"
        >
          {loading && suggestions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500">Searching…</div>
          ) : suggestions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-500">No matches.</div>
          ) : (
            <ul>
              {suggestions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/p/${s.id}`}
                    prefetch={false}
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-slate-100"
                    role="option"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{s.name}</p>
                      <p className="truncate text-xs text-slate-500">{s.sku}</p>
                    </div>
                    {s.price !== null ? (
                      <span className="shrink-0 text-sm font-semibold text-slate-900">
                        {formatMajorUnits(s.price, money)}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
