import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Order } from '@platform/api-client';
import { apiFetch } from '@/lib/api-rest';
import { formatMinorUnitsIn } from '@/lib/money';
import { getMoneyFormat } from '@/lib/capabilities';

/**
 * Order confirmation page — server-rendered. Reads via /admin/orders/:id
 * since there's no /storefront/orders/:id endpoint yet (it's a known
 * follow-up: storefront-scoped order reads gated by something stronger
 * than "tenant id matches", once we have customer auth). For the demo
 * flow, the order id is fresh from the just-completed checkout, so the
 * admin endpoint is a fine read source.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Order placed',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: { id: string };
}

export default async function OrderConfirmationPage({ params }: PageProps) {
  const money = await getMoneyFormat();
  const order = await apiFetch<Order | null>(`/admin/orders/${params.id}`, {
    throwOn404: false,
  });
  if (!order) notFound();

  return (
    <main className="container mx-auto px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700">
          ✓
        </div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Order placed</h1>
        <p className="mt-2 text-slate-600">
          Order <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm">{order.id}</code> is captured.
          The totals on this page are the immutable snapshot taken at checkout — they will not move if the catalog price changes.
        </p>

        <section className="mt-8 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <header className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Lines
          </header>
          <ul className="divide-y divide-slate-200" role="list">
            {order.lines.map((line) => (
              <li key={line.id} className="flex items-start gap-4 px-4 py-3 text-sm">
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{line.name}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {line.sku} · qty {line.qty} · {formatMinorUnitsIn(line.unitPriceCents, order.currency, money)} ea
                  </p>
                </div>
                <p className="font-semibold text-slate-900">
                  {formatMinorUnitsIn(line.lineTotalCents, order.currency, money)}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <dl className="mt-6 space-y-1.5 text-sm">
          <Row label="Subtotal" value={formatMinorUnitsIn(order.subtotalCents, order.currency, money)} />
          {order.discountCents > 0 ? (
            <Row
              label={order.appliedPromotion?.code ? `Discount (${order.appliedPromotion.code})` : 'Discount'}
              value={`−${formatMinorUnitsIn(order.discountCents, order.currency, money)}`}
              tone="positive"
            />
          ) : null}
          <Row
            label={`Tax (${(order.taxRateBps / 100).toFixed(2)}%)`}
            value={formatMinorUnitsIn(order.taxCents, order.currency, money)}
          />
          <div className="my-2 border-t border-slate-200" />
          <Row
            label="Total"
            value={formatMinorUnitsIn(order.grandTotalCents, order.currency, money)}
            tone="emphasis"
          />
        </dl>

        <Link
          href="/"
          className="mt-8 inline-flex items-center text-sm text-brand hover:underline"
        >
          ← Continue shopping
        </Link>
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'emphasis' | 'positive';
}) {
  const valueClass =
    tone === 'emphasis'
      ? 'text-base font-semibold text-slate-900'
      : tone === 'positive'
        ? 'text-emerald-700'
        : 'text-slate-900';
  return (
    <div className="flex items-baseline justify-between">
      <dt className={tone === 'emphasis' ? 'text-base font-semibold text-slate-900' : 'text-slate-600'}>
        {label}
      </dt>
      <dd className={valueClass}>{value}</dd>
    </div>
  );
}
