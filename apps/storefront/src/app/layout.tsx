import type { Metadata } from 'next';
import { getTenantId } from '@/lib/tenant';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s · Commerce',
    default: 'Commerce',
  },
  description: 'Multi-tenant headless commerce storefront.',
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const tenantId = getTenantId();
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-800">
        <header className="border-b border-slate-200 bg-white">
          <div className="container mx-auto flex items-center justify-between px-4 py-4">
            <a href="/" className="text-lg font-semibold tracking-tight">
              <span className="text-brand">Commerce</span>
              <span className="ml-2 text-xs font-normal text-slate-500">
                {tenantId}
              </span>
            </a>
            <nav className="text-sm">
              <a href="/" className="text-slate-600 hover:text-slate-900">
                Browse
              </a>
            </nav>
          </div>
        </header>
        {children}
        <footer className="border-t border-slate-200 bg-slate-50 py-6 text-center text-xs text-slate-500">
          Tenant <code className="rounded bg-white px-1.5 py-0.5">{tenantId}</code> · powered by the platform
        </footer>
      </body>
    </html>
  );
}
