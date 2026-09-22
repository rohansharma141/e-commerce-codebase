'use client';

import { useState, useTransition } from 'react';
import type { CartWithTotals } from '@platform/api-client';
import { formatMinorUnitsIn, type MoneyFormat } from '@/lib/money';
import {
  applyCoupon,
  checkout,
  removeCoupon,
  setLineQty,
} from './actions';

/**
 * Client cart view. Holds the React-side optimistic state (transition
 * pending flags for each action) and renders the cart that the server
 * fetched. Mutations call server actions; on success the server-action
 * call revalidates this path so the next render reflects new state.
 */
export function CartView({ cart, money }: { cart: CartWithTotals; money: MoneyFormat }) {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px]">
      <section aria-labelledby="lines-heading">
        <h2 id="lines-heading" className="sr-only">Items</h2>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white text-slate-800" role="list">
          {cart.lines.map((line) => {
            const priced = cart.totals.lines.find((l) => l.productId === line.productId);
            return (
              <CartLineRow
                key={line.productId}
                productId={line.productId}
                sku={line.sku}
                name={line.name}
                qty={line.qty}
                unitPriceCents={priced?.unitPriceCents}
                lineTotalCents={priced?.lineTotalCents}
                currency={cart.totals.currency}
                money={money}
              />
            );
          })}
        </ul>
      </section>
      <aside>
        <CouponBlock
          couponCode={cart.couponCode}
          discountCents={cart.totals.discountCents}
          currency={cart.totals.currency}
                money={money}
        />
        <TotalsBlock totals={cart.totals} money={money} />
        <CheckoutButton lineCount={cart.lines.length} />
      </aside>
    </div>
  );
}

function CartLineRow({
  productId,
  sku,
  name,
  qty,
  unitPriceCents,
  lineTotalCents,
  currency,
  money,
}: {
  productId: string;
  sku: string;
  name: string;
  qty: number;
  unitPriceCents: number | undefined;
  lineTotalCents: number | undefined;
  currency: string;
  money: MoneyFormat;
}) {
  const [pending, startTransition] = useTransition();

  const update = (newQty: number) =>
    startTransition(() => {
      void setLineQty(productId, Math.max(0, newQty));
    });

  return (
    <li className={'flex items-start gap-4 p-4 ' + (pending ? 'opacity-60' : '')}>
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-900">{name}</p>
        <p className="mt-1 text-xs text-slate-500">{sku}</p>
        <p className="mt-1 text-xs text-slate-600">
          {unitPriceCents !== undefined ? formatMinorUnitsIn(unitPriceCents, currency, money) : '—'} ea
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => update(qty - 1)}
          disabled={pending || qty <= 1}
          className="h-7 w-7 rounded border border-slate-300 text-sm leading-none text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          aria-label="Decrease quantity"
        >
          −
        </button>
        <span className="w-6 text-center text-sm tabular-nums">{qty}</span>
        <button
          type="button"
          onClick={() => update(qty + 1)}
          disabled={pending}
          className="h-7 w-7 rounded border border-slate-300 text-sm leading-none text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
      <div className="w-24 text-right">
        <p className="text-sm font-semibold text-slate-900">
          {lineTotalCents !== undefined ? formatMinorUnitsIn(lineTotalCents, currency, money) : '—'}
        </p>
        <button
          type="button"
          onClick={() => update(0)}
          disabled={pending}
          className="mt-1 text-xs text-slate-500 hover:text-rose-600 disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function CouponBlock({
  couponCode,
  discountCents,
  currency,
  money,
}: {
  couponCode: string | null;
  discountCents: number;
  currency: string;
  money: MoneyFormat;
}) {
  const [pending, startTransition] = useTransition();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    if (!code.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await applyCoupon(code.trim());
      if (!res.ok) setError(res.error ?? 'invalid coupon');
      else setCode('');
    });
  };

  const remove = () =>
    startTransition(() => {
      void removeCoupon();
    });

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-slate-800">
      <h2 className="text-sm font-semibold text-slate-900">Coupon</h2>
      {couponCode ? (
        <div className="mt-2 flex items-center justify-between rounded bg-emerald-50 px-3 py-2">
          <div className="text-sm">
            <code className="font-mono text-emerald-700">{couponCode}</code>
            {discountCents > 0 ? (
              <span className="ml-2 text-emerald-700">
                −{formatMinorUnitsIn(discountCents, currency, money)}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="text-xs text-slate-500 hover:text-rose-600 disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code"
            className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            onClick={apply}
            disabled={pending || !code.trim()}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      )}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

function TotalsBlock({
  totals,
  money,
}: {
  totals: CartWithTotals['totals'];
  money: MoneyFormat;
}) {
  return (
    <dl className="mt-4 space-y-1.5 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800">
      <Row label="Subtotal" value={formatMinorUnitsIn(totals.subtotalCents, totals.currency, money)} />
      {totals.discountCents > 0 ? (
        <Row
          label="Discount"
          value={`−${formatMinorUnitsIn(totals.discountCents, totals.currency, money)}`}
          tone="positive"
        />
      ) : null}
      <Row
        label={`Tax (${(totals.taxRateBps / 100).toFixed(2)}%)`}
        value={formatMinorUnitsIn(totals.taxCents, totals.currency, money)}
      />
      <div className="my-2 border-t border-slate-200" />
      <Row
        label="Total"
        value={formatMinorUnitsIn(totals.grandTotalCents, totals.currency, money)}
        tone="emphasis"
      />
    </dl>
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

function CheckoutButton({ lineCount }: { lineCount: number }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() =>
        startTransition(async () => {
          // checkout() redirects on success — the promise never resolves on
          // the client (the React tree is replaced). We don't need finally.
          await checkout();
        })
      }
      disabled={pending || lineCount === 0}
      className="mt-4 w-full rounded-md bg-brand py-3 text-base font-semibold text-brand-fg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? 'Placing order…' : 'Checkout'}
    </button>
  );
}
