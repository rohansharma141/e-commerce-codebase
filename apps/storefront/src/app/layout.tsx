import type { Metadata } from 'next';
import { Suspense } from 'react';
import { getTenantId } from '@/lib/tenant';
import { getTenantTheme } from '@/lib/theme';
import { CartIcon } from '@/components/cart-icon';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s · Storefront',
    default: 'Storefront',
  },
  description: 'Multi-tenant headless commerce storefront.',
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * Per-tenant theme is fetched once per request and injected via an inline
 * <style> block on :root. CSS vars then drive Tailwind's `text-brand` /
 * `bg-brand` / `bg-page` / `font-sans` utilities (see tailwind.config.ts).
 *
 * Inline <style> is safe under our dev CSP (which allows 'unsafe-inline'
 * for style-src). Production CSP needs the same nonce treatment we owe
 * for inline scripts (see CAVEATS.md "CSP in production breaks
 * hydration"); the style nonce slots into the same per-request nonce.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenantId = getTenantId();
  const theme = await getTenantTheme();

  const themeCss = `:root {
  --brand: ${theme.brandHsl};
  --brand-fg: ${theme.brandFgHsl};
  --page-bg: ${theme.pageBgHsl};
  --page-fg: ${theme.pageFgHsl};
  --font-sans: ${theme.fontSans};
}`;

  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body className="min-h-screen bg-page font-sans text-page-fg">
        <header className="border-b border-slate-200/70 bg-page/80 backdrop-blur">
          <div className="container mx-auto flex items-center justify-between px-4 py-4">
            <a href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span aria-hidden="true" className="text-brand text-xl">{theme.logoMark}</span>
              <span className="text-brand">{theme.brandName}</span>
              <span className="ml-2 text-xs font-normal opacity-60">
                {tenantId}
              </span>
            </a>
            <nav className="flex items-center gap-1 text-sm">
              <a href="/" className="rounded-md px-2 py-1.5 opacity-70 hover:bg-slate-100 hover:opacity-100">
                Browse
              </a>
              <Suspense fallback={<span className="px-2 py-1.5 text-sm opacity-40">Cart</span>}>
                <CartIcon />
              </Suspense>
            </nav>
          </div>
        </header>
        {children}
        <footer className="border-t border-slate-200/70 py-6 text-center text-xs opacity-60">
          {theme.tagline} · tenant <code className="rounded bg-white/40 px-1.5 py-0.5">{tenantId}</code>
        </footer>
      </body>
    </html>
  );
}
