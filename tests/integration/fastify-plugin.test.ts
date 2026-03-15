import { CanaryManager } from '../../src/core/canary-manager';
import { InMemoryStorage } from '../../src/storage/in-memory';
import { canaryFastifyPlugin } from '../../src/adapters/fastify';

function mockFastifyInstance() {
  const hooks: Record<string, Function[]> = {};
  const decorations: Record<string, unknown> = {};
  return {
    hooks,
    decorations,
    addHook: jest.fn((name: string, handler: Function) => {
      if (!hooks[name]) hooks[name] = [];
      hooks[name].push(handler);
    }),
    decorateRequest: jest.fn((name: string, value: unknown) => {
      decorations[name] = value;
    }),
  };
}

function mockRequest(userId?: string): any {
  return {
    headers: { 'x-user-id': userId },
    url: '/products/1',
    method: 'GET',
    user: userId ? { id: userId, plan: 'enterprise' } : undefined,
  };
}

function mockReply(): any {
  const headers: Record<string, string> = {};
  return {
    headers,
    header: jest.fn((name: string, value: string) => { headers[name] = value; }),
  };
}

describe('canaryFastifyPlugin', () => {
  let manager: CanaryManager;

  beforeEach(async () => {
    const storage = new InMemoryStorage();
    manager = new CanaryManager({ storage });
    await manager.createExperiment('test-exp', [
      { type: 'percentage', percentage: 100 },
    ]);
  });

  it('registers preHandler hook and decorates request', () => {
    const fastify = mockFastifyInstance();
    canaryFastifyPlugin(fastify as any, manager, {
      experimentName: 'test-exp',
      getUserFromRequest: (req) => req.user ? { id: (req.user as any).id } : null,
    });

    expect(fastify.addHook).toHaveBeenCalledWith('preHandler', expect.any(Function));
    expect(fastify.decorateRequest).toHaveBeenCalledWith('canaryVariant', 'stable');
  });

  it('sets canaryVariant on request and header on reply', async () => {
    const fastify = mockFastifyInstance();
    canaryFastifyPlugin(fastify as any, manager, {
      experimentName: 'test-exp',
      getUserFromRequest: (req) => {
        const user = req.user as any;
        return user ? { id: user.id } : null;
      },
    });

    const req = mockRequest('user-1');
    const reply = mockReply();
    const handler = fastify.hooks['preHandler'][0];
    await handler(req, reply);

    expect(req.canaryVariant).toBe('canary');
    expect(reply.headers['X-Canary-Variant']).toBe('canary');
  });

  it('returns stable for unauthenticated requests', async () => {
    const fastify = mockFastifyInstance();
    canaryFastifyPlugin(fastify as any, manager, {
      experimentName: 'test-exp',
      getUserFromRequest: () => null,
    });

    const req = mockRequest();
    const reply = mockReply();
    await fastify.hooks['preHandler'][0](req, reply);

    expect(req.canaryVariant).toBe('stable');
  });

  it('suppresses header when setHeader is false', async () => {
    const fastify = mockFastifyInstance();
    canaryFastifyPlugin(fastify as any, manager, {
      experimentName: 'test-exp',
      getUserFromRequest: (req) => {
        const user = req.user as any;
        return user ? { id: user.id } : null;
      },
      setHeader: false,
    });

    const req = mockRequest('user-1');
    const reply = mockReply();
    await fastify.hooks['preHandler'][0](req, reply);

    expect(reply.header).not.toHaveBeenCalled();
  });

  it('falls back to stable on error', async () => {
    const fastify = mockFastifyInstance();
    canaryFastifyPlugin(fastify as any, manager, {
      experimentName: 'test-exp',
      getUserFromRequest: () => { throw new Error('boom'); },
    });

    const req = mockRequest('user-1');
    const reply = mockReply();
    await fastify.hooks['preHandler'][0](req, reply);

    expect(req.canaryVariant).toBe('stable');
  });
});
