import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Accessible breadcrumb trail. The last crumb is the current page and is
 * rendered without a link. Items with an `href` are clickable; items without
 * are treated as non-navigable (e.g. uncategorised products that still want
 * to surface the brand or section title).
 */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="mb-3 text-xs">
      <ol className="flex flex-wrap items-center gap-1 opacity-70">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.href && !isLast ? (
                <Link href={c.href} className="hover:opacity-100">{c.label}</Link>
              ) : (
                <span className={isLast ? 'opacity-100 capitalize' : 'capitalize'}>
                  {c.label}
                </span>
              )}
              {!isLast ? <ChevronRight className="h-3 w-3 opacity-40" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
