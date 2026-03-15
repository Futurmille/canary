import { CanaryManager } from '../../src/core/canary-manager';
import { InMemoryStorage } from '../../src/storage/in-memory';
import { canaryHonoMiddleware, canaryHonoGuard } from '../../src/adapters/hono';

function mockHonoContext(userId?: string): any {
  const store: Record<string, unknown> = {};
  const headers: Record<string, string> = {};

  return {
    req: {
      header: (name: string) => name === 'x-user-id' ? userId : undefined,
      url: '/products/1',
      method: 'GET',
    },
    header: jest.fn((name: string, value: string) => { headers[name] = value; }),
    set: jest.fn((key: string, value: unknown) => { store[key] = value; }),
    get: jest.fn((key: string) => store[key]),
    json: jest.fn((data: unknown, status?: number) => ({ data, status })),
    _store: store,
    _headers: headers,
  };
}

describe('canaryHonoMiddleware', () => {
  let manager: CanaryManager;

  beforeEach(async () => {
    const storage = new InMemoryStorage();
    manager = new CanaryManager({ storage });
    await manager.createExperiment('test-exp', [
      { type: 'percentage', percentage: 100 },
    ]);
  });

  it('sets canaryVariant in context and response header', async () => {
    const mw = canaryHonoMiddleware(manager, {
      experimentName: 'test-exp',
      getUserFromContext: (c) => {
        const id = c.req.header('x-user-id');
        return id ? { id } : null;
      },
    });

    const c = mockHonoContext('user-1');
    const next = jest.fn(async () => {});
    await mw(c, next);

    expect(c.set).toHaveBeenCalledWith('canaryVariant', 'canary');
    expect(c.header).toHaveBeenCalledWith('X-Canary-Variant', 'canary');
    expect(next).toHaveBeenCalled();
  });

  it('returns stable for unauthenticated requests', async () => {
    const mw = canaryHonoMiddleware(manager, {
      experimentName: 'test-exp',
      getUserFromContext: () => null,
    });

    const c = mockHonoContext();
    await mw(c, jest.fn(async () => {}));

    expect(c.set).toHaveBeenCalledWith('canaryVariant', 'stable');
  });

  it('suppresses header when setHeader is false', async () => {
    const mw = canaryHonoMiddleware(manager, {
      experimentName: 'test-exp',
      getUserFromContext: (c) => {
        const id = c.req.header('x-user-id');
        return id ? { id } : null;
      },
      setHeader: false,
    });

    const c = mockHonoContext('user-1');
    await mw(c, jest.fn(async () => {}));

    expect(c.header).not.toHaveBeenCalled();
  });

  it('falls back to stable on error', async () => {
    const mw = canaryHonoMiddleware(manager, {
      experimentName: 'test-exp',
      getUserFromContext: () => { throw new Error('boom'); },
    });

    const c = mockHonoContext('user-1');
    await mw(c, jest.fn(async () => {}));

    expect(c.set).toHaveBeenCalledWith('canaryVariant', 'stable');
  });
});

describe('canaryHonoGuard', () => {
  let manager: CanaryManager;

  beforeEach(async () => {
    const storage = new InMemoryStorage();
    manager = new CanaryManager({ storage });
    await manager.createExperiment('test-exp', [
      { type: 'percentage', percentage: 100 },
    ]);
  });

  it('allows canary users through', async () => {
    const guard = canaryHonoGuard(manager, {
      experimentName: 'test-exp',
      getUserFromContext: (c) => {
        const id = c.req.header('x-user-id');
        return id ? { id } : null;
      },
    });

    const c = mockHonoContext('user-1');
    const next = jest.fn(async () => {});
    await guard(c, next);

    expect(next).toHaveBeenCalled();
    expect(c.set).toHaveBeenCalledWith('canaryVariant', 'canary');
  });

  it('returns 404 for unauthenticated users', async () => {
    const guard = canaryHonoGuard(manager, {
      experimentName: 'test-exp',
      getUserFromContext: () => null,
    });

    const c = mockHonoContext();
    const next = jest.fn(async () => {});
    const result = await guard(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith({ error: 'Not found' }, 404);
  });

  it('returns 404 for stable users', async () => {
    const storage = new InMemoryStorage();
    const m = new CanaryManager({ storage });
    await m.createExperiment('test-exp', [
      { type: 'percentage', percentage: 0 },
    ]);

    const guard = canaryHonoGuard(m, {
      experimentName: 'test-exp',
      getUserFromContext: (c) => {
        const id = c.req.header('x-user-id');
        return id ? { id } : null;
      },
    });

    const c = mockHonoContext('user-1');
    const next = jest.fn(async () => {});
    await guard(c, next);

    expect(next).not.toHaveBeenCalled();
    expect(c.json).toHaveBeenCalledWith({ error: 'Not found' }, 404);
  });

  it('returns 404 on error', async () => {
    const guard = canaryHonoGuard(manager, {
      experimentName: 'test-exp',
      getUserFromContext: () => { throw new Error('boom'); },
    });

    const c = mockHonoContext('user-1');
    const next = jest.fn(async () => {});
    await guard(c, next);

    expect(next).not.toHaveBeenCalled();
  });
});
