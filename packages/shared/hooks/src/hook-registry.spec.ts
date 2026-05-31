import { HookRegistry } from './hook-registry';

const ctx = { tenantId: 't', requestId: 'r' };

describe('HookRegistry', () => {
  it('dispatches to all registered handlers in order', async () => {
    const reg = new HookRegistry();
    const calls: string[] = [];
    reg.register<string>('x', (p) => {
      calls.push(`a:${p}`);
    });
    reg.register<string>('x', async (p) => {
      calls.push(`b:${p}`);
    });
    await reg.dispatch('x', 'hi', ctx);
    expect(calls).toEqual(['a:hi', 'b:hi']);
  });

  it('isolates failures: one throwing handler does not block siblings', async () => {
    const reg = new HookRegistry();
    const good = jest.fn();
    reg.register('x', () => {
      throw new Error('boom');
    });
    reg.register('x', good);
    await expect(reg.dispatch('x', 1, ctx)).resolves.toBeUndefined();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('unregister disposer removes the handler', async () => {
    const reg = new HookRegistry();
    const h = jest.fn();
    const off = reg.register('x', h);
    off();
    await reg.dispatch('x', 1, ctx);
    expect(h).not.toHaveBeenCalled();
  });

  it('dispatch with no handlers is a no-op', async () => {
    const reg = new HookRegistry();
    await expect(reg.dispatch('nobody', 0, ctx)).resolves.toBeUndefined();
  });
});
