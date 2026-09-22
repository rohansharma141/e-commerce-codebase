import { resolveChannel } from '@/lib/channel';

/**
 * Every page a shopper browses sits in this group, so a channel prefix the api
 * does not recognise is a `404` on all of them, including pages added later
 * (C-19a). The group adds nothing to the URL.
 *
 * Why here and not in the root layout: a `notFound()` thrown by the root
 * layout is outside the root's own not-found boundary. It still answered
 * `404`, but the page carried no layout and no message — measured, against
 * the product page's `404`, which carries both. Thrown one level down, it is
 * caught by that boundary and drawn inside the root layout like any other.
 */
export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  await resolveChannel();
  return children;
}
