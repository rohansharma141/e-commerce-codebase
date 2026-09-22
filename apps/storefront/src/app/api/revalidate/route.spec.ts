/**
 * The webhook's event-to-tag mapping, for the events that change what
 * capabilities report.
 *
 * Since C-18a capabilities are composed from the channels module, so a channel
 * edit — not only `pricing.tenant-config.updated` — changes the currency and
 * locale every price is formatted with. An event this route does not know is
 * acknowledged and does nothing, which is the right answer for deploy skew and
 * exactly what hid this: a locale change reached the api at once and the
 * rendered page an hour later.
 *
 * ── What it prints if the mapping did nothing ─────────────────────────────
 *
 *   `invalidated: []` for each channel event — the default branch.
 */
const revalidateTag = jest.fn();
jest.mock('next/cache', () => ({ revalidateTag, revalidatePath: jest.fn() }));

// The route reads its secret when the module loads, so it is set first and the
// route imported after.
process.env['REVALIDATE_SECRET'] = 'test-secret';

type Post = (typeof import('./route'))['POST'];
let POST: Post;

beforeAll(async () => {
  ({ POST } = await import('./route'));
});

beforeEach(() => revalidateTag.mockClear());

async function deliver(event: string): Promise<string[]> {
  const { NextRequest } = await import('next/server');
  const res = await POST(
    new NextRequest('http://storefront/api/revalidate', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret', 'content-type': 'application/json' },
      // A fresh delivery id each time: the route ignores a repeated one.
      body: JSON.stringify({ event, tenantId: 't-fashion', deliveryId: `${event}-${Math.random()}` }),
    }),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { invalidated: string[] }).invalidated;
}

describe.each(['channels.updated', 'channels.default-changed', 'channels.tenant-defaults.updated'])(
  '%s',
  (event) => {
    it('drops the capabilities tag, and the browse pages formatted with it', async () => {
      const invalidated = await deliver(event);
      expect(invalidated).toEqual(
        expect.arrayContaining(['capabilities:t-fashion', 'browse:t-fashion', 'browse:t-fashion:all']),
      );
      expect(revalidateTag).toHaveBeenCalledWith('capabilities:t-fashion');
    });

    it('leaves the theme alone: branding is not a channel property', async () => {
      expect(await deliver(event)).not.toContain('theme:t-fashion');
    });
  },
);

it('still drops capabilities on a pricing config change, as before', async () => {
  expect(await deliver('pricing.tenant-config.updated')).toContain('capabilities:t-fashion');
});

it('does nothing for an event it does not know — the path channel events used to take', async () => {
  expect(await deliver('channels.something-new')).toEqual([]);
  expect(revalidateTag).not.toHaveBeenCalled();
});
