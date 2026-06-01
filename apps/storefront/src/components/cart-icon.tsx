import Link from 'next/link';
import { getCart } from '@/lib/cart';
import { getTenantId } from '@/lib/tenant';

/**
 * Header cart icon. Server-renders the current line count from the api.
 * Cart-mutating server actions revalidate '/' as a layout to force this to
 * re-render on the next request.
 */
export async function CartIcon() {
  const tenantId = getTenantId();
  const cart = await getCart(tenantId);
  const count = cart?.lines.reduce((sum, l) => sum + l.qty, 0) ?? 0;

  return (
    <Link
      href="/cart"
      className="relative inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      aria-label={`Cart (${count} item${count === 1 ? '' : 's'})`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
      </svg>
      <span className="hidden sm:inline">Cart</span>
      {count > 0 ? (
        <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-fg">
          {count}
        </span>
      ) : null}
    </Link>
  );
}
