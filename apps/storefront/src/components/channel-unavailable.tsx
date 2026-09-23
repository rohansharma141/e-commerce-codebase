import Link from 'next/link';

/**
 * What a shopper sees in a channel the api refuses (C-19d).
 *
 * The api answers `422 channel.unservable` for every storefront request in a
 * channel whose currency its price list cannot serve (C-32b, gate G-4). Until
 * C-19d that reached the shopper as a server error, which is both alarming and
 * wrong: nothing is broken, the market is not open.
 *
 * `200`, not `404`: the page exists and the link a shopper followed was valid,
 * so they are told why rather than told it does not exist. `noindex` on the
 * segment keeps it out of search results, which is what a `404` would have
 * bought. Next's app router gives a page those two answers and no third —
 * the api's `422` cannot be passed through.
 */
export function ChannelUnavailable({ channelKey }: { channelKey: string | null }) {
  return (
    <main className="container mx-auto px-4 py-16">
      <div className="mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Not available in this market
        </h1>
        <p className="mt-4 text-base opacity-80">
          {channelKey ? (
            <>
              The <code className="rounded bg-white/40 px-1.5 py-0.5">{channelKey}</code> store is
              not open for orders yet.
            </>
          ) : (
            <>This store is not open for orders yet.</>
          )}
        </p>
        <p className="mt-2 text-sm opacity-60">
          Its prices are not set in the currency it sells in, so we show nothing here rather than
          prices that would be wrong.
        </p>
        {channelKey ? (
          <Link
            href="/"
            className="mt-8 inline-flex items-center rounded-md bg-brand px-4 py-2 text-sm font-semibold text-brand-fg hover:opacity-90"
          >
            Go to the main store
          </Link>
        ) : null}
      </div>
    </main>
  );
}
