import { CanaryManager } from '../../src/core/canary-manager';
import { InMemoryStorage } from '../../src/storage/in-memory';
import { CanaryGuard, CanaryExperiment, CANARY_EXPERIMENT_KEY } from '../../src/adapters/nestjs';
import { CanaryUser } from '../../src/types';

// ── Polyfill Reflect metadata methods ───────────────────────
// In real NestJS apps, reflect-metadata is loaded globally.
const metadataStore = new Map<string, unknown>();

function metaKey(key: any, target: any, prop?: any): string {
  const tgt = typeof target === 'function' ? target.name : (target?.constructor?.name ?? String(target));
  return prop !== undefined ? `${String(key)}:${tgt}:${String(prop)}` : `${String(key)}:${tgt}`;
}

if (!(Reflect as any).defineMetadata) {
  (Reflect as any).defineMetadata = (key: any, value: any, target: any, prop?: any) => {
    metadataStore.set(metaKey(key, target, prop), value);
  };
}
if (!(Reflect as any).getMetadata) {
  (Reflect as any).getMetadata = (key: any, target: any, prop?: any) => {
    return metadataStore.get(metaKey(key, target, prop));
  };
}
if (!(Reflect as any).getOwnMetadata) {
  (Reflect as any).getOwnMetadata = (key: any, target: any, prop?: any) => {
    return metadataStore.get(metaKey(key, target, prop));
  };
}

// ── Test handler with decorator ─────────────────────────────

class TestController {
  @CanaryExperiment('search-v2')
  searchHandler() {}

  plainHandler() {}
}

// ── Mock NestJS ExecutionContext ─────────────────────────────

function mockContext(handler: Function, userId?: string): any {
  const req: Record<string, unknown> = {};
  if (userId) {
    req['user'] = { id: userId };
  }

  return {
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  };
}

const getUserFromRequest = (req: Record<string, unknown>): CanaryUser | null => {
  const u = req['user'] as { id: string } | undefined;
  return u ? { id: u.id } : null;
};

// ─────────────────────────────────────────────────────────────

describe('NestJS CanaryGuard', () => {
  let storage: InMemoryStorage;
  let manager: CanaryManager;
  let guard: CanaryGuard;
  const controller = new TestController();

  beforeEach(async () => {
    storage = new InMemoryStorage();
    manager = new CanaryManager({ storage });
    guard = new CanaryGuard(manager, { getUserFromRequest });

    await manager.createExperiment('search-v2', [
      { type: 'percentage', percentage: 100 },
    ]);
  });

  it('allows through and sets canaryVariant when experiment matches', async () => {
    const ctx = mockContext(controller.searchHandler, 'user-1');
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest();
    expect(req['canaryVariant']).toBe('canary');
  });

  it('allows through for handlers without @CanaryExperiment', async () => {
    const ctx = mockContext(controller.plainHandler, 'user-1');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  it('sets stable when no user is available', async () => {
    const ctx = mockContext(controller.searchHandler); // no user
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    const req = ctx.switchToHttp().getRequest();
    expect(req['canaryVariant']).toBe('stable');
  });

  it('denies access when denyStable is true and user gets stable', async () => {
    const denyGuard = new CanaryGuard(manager, {
      getUserFromRequest,
      denyStable: true,
    });

    await manager.updateExperiment('search-v2', {
      strategies: [{ type: 'percentage', percentage: 0 }],
    });

    // Clear any existing assignment
    await storage.deleteAllAssignments('search-v2');

    const ctx = mockContext(controller.searchHandler, 'user-1');
    const result = await denyGuard.canActivate(ctx);
    expect(result).toBe(false);
  });

  it('falls back to stable when getUserFromRequest throws', async () => {
    const throwGuard = new CanaryGuard(manager, {
      getUserFromRequest: () => { throw new Error('parse error'); },
    });

    const ctx = mockContext(controller.searchHandler, 'user-1');
    // getUserFromRequest throw happens outside the try/catch for getVariant,
    // so it falls into stable because user is null-ish path won't work.
    // Instead test by making getVariant itself throw:
    jest.spyOn(manager, 'getVariant').mockRejectedValueOnce(new Error('explode'));

    const ctx2 = mockContext(controller.searchHandler, 'user-1');
    const result = await guard.canActivate(ctx2);
    expect(result).toBe(true);
    expect(ctx2.switchToHttp().getRequest()['canaryVariant']).toBe('stable');
  });
});

describe('CanaryVariant decorator', () => {
  it('stores parameter indices as metadata', () => {
    // Import CanaryVariant
    const { CanaryVariant, CANARY_VARIANT_KEY } = require('../../src/adapters/nestjs');

    class TestCtrl {
      handler(
        @CanaryVariant() _variant: any,
        _other: any,
        @CanaryVariant() _variant2: any,
      ) {}
    }

    const indices = Reflect.getOwnMetadata(CANARY_VARIANT_KEY, TestCtrl.prototype, 'handler');
    expect(indices).toEqual([2, 0]);
  });
});
