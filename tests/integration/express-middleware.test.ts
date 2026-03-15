import { CanaryManager } from '../../src/core/canary-manager';
import { InMemoryStorage } from '../../src/storage/in-memory';
import { canaryMiddleware, canaryGuard } from '../../src/adapters/express';
import { CanaryUser } from '../../src/types';

// ── Helpers to simulate Express req/res/next ─────────────────

function mockReq(userId?: string, attrs?: Record<string, string>): any {
  return {
    headers: { 'x-user-id': userId },
    user: userId ? { id: userId, attributes: attrs } : undefined,
  };
}

function mockRes(): any {
  const headers: Record<string, string> = {};
  const res: any = {
    headers,
    setHeader: (name: string, value: string) => { headers[name] = value; },
    status: (code: number) => { res.statusCode = code; return res; },
    json: (body: unknown) => { res.body = body; },
    statusCode: 200,
    body: undefined,
  };
  return res;
}

function nextFn(): jest.Mock {
  return jest.fn();
}

const getUserFromRequest = (req: any): CanaryUser | null => {
  if (!req.user) return null;
  return { id: req.user.id, attributes: req.user.attributes };
};

// ─────────────────────────────────────────────────────────────

describe('Express middleware', () => {
  let storage: InMemoryStorage;
  let manager: CanaryManager;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    manager = new CanaryManager({ storage });
    await manager.createExperiment('checkout-v2', [
      { type: 'percentage', percentage: 100 },
    ]);
  });

  describe('canaryMiddleware', () => {
    it('attaches variant to req and sets header', async () => {
      const mw = canaryMiddleware(manager, {
        getUserFromRequest,
        experimentName: 'checkout-v2',
      });

      const req = mockReq('user-1');
      const res = mockRes();
      const next = nextFn();

      await mw(req, res, next);

      expect(req.canaryVariant).toBe('canary');
      expect(res.headers['X-Canary-Variant']).toBe('canary');
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('returns stable for unauthenticated requests', async () => {
      const mw = canaryMiddleware(manager, {
        getUserFromRequest,
        experimentName: 'checkout-v2',
      });

      const req = mockReq(); // no user
      const res = mockRes();
      const next = nextFn();

      await mw(req, res, next);

      expect(req.canaryVariant).toBe('stable');
      expect(next).toHaveBeenCalled();
    });

    it('custom requestProperty name', async () => {
      const mw = canaryMiddleware(manager, {
        getUserFromRequest,
        experimentName: 'checkout-v2',
        requestProperty: 'featureVariant',
      });

      const req = mockReq('user-1');
      const res = mockRes();
      await mw(req, res, nextFn());

      expect(req.featureVariant).toBe('canary');
    });

    it('setHeader: false suppresses response header', async () => {
      const mw = canaryMiddleware(manager, {
        getUserFromRequest,
        experimentName: 'checkout-v2',
        setHeader: false,
      });

      const req = mockReq('user-1');
      const res = mockRes();
      await mw(req, res, nextFn());

      expect(res.headers['X-Canary-Variant']).toBeUndefined();
    });
  });

  describe('canaryGuard', () => {
    it('allows canary users through', async () => {
      const guard = canaryGuard(manager, {
        getUserFromRequest,
        experimentName: 'checkout-v2',
      });

      const req = mockReq('user-1');
      const res = mockRes();
      const next = nextFn();

      await guard(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.canaryVariant).toBe('canary');
    });

    it('returns 404 for stable users', async () => {
      await manager.updateExperiment('checkout-v2', {
        strategies: [{ type: 'percentage', percentage: 0 }],
      });

      const guard = canaryGuard(manager, {
        getUserFromRequest,
        experimentName: 'checkout-v2',
      });

      const req = mockReq('user-1');
      const res = mockRes();
      const next = nextFn();

      await guard(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 for unauthenticated users', async () => {
      const guard = canaryGuard(manager, {
        getUserFromRequest,
        experimentName: 'checkout-v2',
      });

      const req = mockReq();
      const res = mockRes();
      const next = nextFn();

      await guard(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when manager.getVariant throws', async () => {
      jest.spyOn(manager, 'getVariant').mockRejectedValueOnce(new Error('explode'));

      const guard = canaryGuard(manager, {
        getUserFromRequest,
        experimentName: 'checkout-v2',
      });

      const req = mockReq('user-1');
      const res = mockRes();
      const next = nextFn();

      await guard(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
    });
  });

  describe('canaryMiddleware error handling', () => {
    it('falls back to stable when getUserFromRequest throws', async () => {
      const mw = canaryMiddleware(manager, {
        getUserFromRequest: () => { throw new Error('parse error'); },
        experimentName: 'checkout-v2',
      });

      const req = mockReq('user-1');
      const res = mockRes();
      const next = nextFn();

      await mw(req, res, next);

      expect(req.canaryVariant).toBe('stable');
      expect(next).toHaveBeenCalled();
    });
  });
});
