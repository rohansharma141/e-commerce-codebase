import { EventBus } from './event-bus';
import { IdempotencyTracker } from './idempotency';
import type { DomainEvent } from './types';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const makeEvent = (name: string, payload: Record<string, unknown> = {}): DomainEvent => ({
  name,
  payload: payload as DomainEvent['payload'],
  eventId: `evt-${Math.random().toString(36).slice(2)}`,
  occurredAt: new Date().toISOString(),
  tenantId: 'tenant-a',
});

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('delivers published events to subscribers', async () => {
    const handler = jest.fn();
    bus.subscribe('order.created', handler);
    await bus.publish(makeEvent('order.created', { id: 'o1' }));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('clones the payload so handler mutation cannot leak back to other consumers', async () => {
    const event = makeEvent('order.created', { items: ['a'] });
    let receivedA: DomainEvent | null = null;
    let receivedB: DomainEvent | null = null;

    bus.subscribe('order.created', (e) => {
      receivedA = e;
      (e.payload as { items: string[] }).items.push('mutated');
    });
    bus.subscribe('order.created', (e) => {
      receivedB = e;
    });

    await bus.publish(event);
    await flush();

    expect(receivedA).not.toBe(event);
    expect(receivedB).not.toBe(receivedA);
    expect((event.payload as { items: string[] }).items).toEqual(['a']);
    expect((receivedB!.payload as { items: string[] }).items).toEqual(['a']);
  });

  it('isolates handler errors so the publisher and other handlers are unaffected', async () => {
    const good = jest.fn();
    bus.subscribe('order.created', () => {
      throw new Error('boom');
    });
    bus.subscribe('order.created', good);

    await expect(bus.publish(makeEvent('order.created'))).resolves.toBeUndefined();
    await flush();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes via the returned disposer', async () => {
    const handler = jest.fn();
    const off = bus.subscribe('x', handler);
    off();
    await bus.publish(makeEvent('x'));
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does nothing when there are no subscribers', async () => {
    await expect(bus.publish(makeEvent('nobody.listening'))).resolves.toBeUndefined();
  });
});

describe('IdempotencyTracker', () => {
  it('runs work exactly once per eventId', async () => {
    const tracker = new IdempotencyTracker();
    const work = jest.fn().mockResolvedValue(undefined);

    const first = await tracker.runOnce('evt-1', work);
    const second = await tracker.runOnce('evt-1', work);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
