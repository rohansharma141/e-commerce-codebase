import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PAGE_SIZE_FOR_DISPLAY,
  type StorefrontSearchParams,
  urlWithOverrides,
} from '@/lib/search-params';

interface PaginationProps {
  basePath: string;
  searchParams: StorefrontSearchParams;
  page: number;
  total: number;
}

/**
 * URL-driven pagination. Each link is a <Link href={...?page=N}>; server
 * re-renders with the new cursor. No client JS. Renders prev/next plus a
 * compact window of page numbers around the current page (1 ... 4 5 6 ... 50).
 *
 * Skipped entirely when total ≤ PAGE_SIZE_FOR_DISPLAY (one page or fewer).
 */
export function Pagination({ basePath, searchParams, page, total }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE_FOR_DISPLAY));
  if (totalPages <= 1) return null;

  const windowSize = 2; // pages either side of current
  const pages = pageWindow(page, totalPages, windowSize);

  const hrefFor = (p: number) =>
    urlWithOverrides(basePath, searchParams, { page: p === 1 ? null : String(p) });

  return (
    <nav className="mt-6 flex flex-wrap items-center justify-center gap-1" aria-label="Pagination">
      <PageLink href={hrefFor(Math.max(1, page - 1))} disabled={page === 1} ariaLabel="Previous page">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Prev</span>
      </PageLink>

      {pages.map((p, idx) =>
        p === '…' ? (
          <span key={`gap-${idx}`} className="px-2 text-sm opacity-50">…</span>
        ) : (
          <PageLink key={p} href={hrefFor(p)} active={p === page} ariaLabel={`Page ${p}`}>
            {p}
          </PageLink>
        ),
      )}

      <PageLink
        href={hrefFor(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        ariaLabel="Next page"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  children,
  active = false,
  disabled = false,
  ariaLabel,
}: {
  href: string;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const className = cn(
    'inline-flex h-9 min-w-[2.25rem] items-center justify-center gap-1 rounded-md border px-2.5 text-sm transition-colors',
    active
      ? 'border-brand bg-brand text-brand-fg font-semibold'
      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
    disabled && 'pointer-events-none opacity-40',
  );
  if (disabled) {
    return (
      <span aria-disabled="true" className={className}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}

/**
 * Returns the page numbers to render, with '…' standing in for gaps.
 * Example for current=5, total=20, w=2: [1, '…', 3, 4, 5, 6, 7, '…', 20]
 */
function pageWindow(current: number, total: number, w: number): Array<number | '…'> {
  const result: Array<number | '…'> = [];
  const start = Math.max(2, current - w);
  const end = Math.min(total - 1, current + w);

  result.push(1);
  if (start > 2) result.push('…');
  for (let p = start; p <= end; p++) result.push(p);
  if (end < total - 1) result.push('…');
  if (total > 1) result.push(total);

  return result;
}
