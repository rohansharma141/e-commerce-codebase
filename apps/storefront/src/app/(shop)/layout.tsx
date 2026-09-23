import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ChannelUnavailable } from '@/components/channel-unavailable';
import { getChannelKey, lookupChannel } from '@/lib/channel';

/**
 * Every page a shopper browses sits in this group, so what the api says about
 * the request's channel decides all of them at once, including pages added
 * later. The group adds nothing to the URL.
 *
 *   unknown key  → `404` (C-19a), never the default channel.
 *   unservable   → the market's own page (C-19d), and no page renders: the
 *                  children are not returned, so nothing under them asks the
 *                  api a question it has already refused.
 *
 * Why here and not in the root layout: a `notFound()` thrown by the root
 * layout is outside the root's own not-found boundary. It still answered
 * `404`, but the page carried no layout and no message — measured, against
 * the product page's `404`, which carries both. Thrown one level down, it is
 * caught by that boundary and drawn inside the root layout like any other.
 */
export async function generateMetadata(): Promise<Metadata> {
  const lookup = await lookupChannel();
  // A market that is not open should not be indexed. Metadata is resolved
  // separately from rendering, so this cannot be left to the component.
  return lookup.status === 'unservable' ? { robots: { index: false, follow: false } } : {};
}

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const lookup = await lookupChannel();
  if (lookup.status === 'unknown') notFound();
  if (lookup.status === 'unservable') return <ChannelUnavailable channelKey={getChannelKey()} />;
  return children;
}
