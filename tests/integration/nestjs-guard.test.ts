import { CanaryManager } from '../../src/core/canary-manager';
import { InMemoryStorage } from '../../src/storage/in-memory';
import {
  CanaryGuard,
  CanaryExperiment,
  CanaryModule,
  CANARY_EXPERIMENT_KEY,
  CANARY_MANAGER,
  CANARY_MODULE_OPTIONS,
} from '../../src/adapters/nestjs';
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

function mockContext(handler: Function, userId?: string, attrs?: Record<string, string>): any {
  const req: Record<string, unknown> = {};
  if (userId) {
    req['user'] = { id: userId, ...attrs };
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

  it('falls back to stable when getVariant throws', async () => {
    jest.spyOn(manager, 'getVariant').mockRejectedValueOnce(new Error('explode'));

    const ctx = mockContext(controller.searchHandler, 'user-1');
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest()['canaryVariant']).toBe('stable');
  });

  it('falls back to stable when getUserFromRequest throws', async () => {
    const throwGuard = new CanaryGuard(manager, {
      getUserFromRequest: () => { throw new Error('parse error'); },
    });

    const ctx = mockContext(controller.searchHandler, 'user-1');
    const result = await throwGuard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest()['canaryVariant']).toBe('stable');
  });

  it('constructor works with just manager — default getUserFromRequest returns null', async () => {
    const minimalGuard = new CanaryGuard(manager);
    // With default options, getUserFromRequest returns null → user is null → stable
    const ctx = mockContext(controller.searchHandler, 'user-1');
    const result = await minimalGuard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest()['canaryVariant']).toBe('stable');
  });

  it('setOptions updates the guard configuration', async () => {
    const minimalGuard = new CanaryGuard(manager);
    minimalGuard.setOptions({ getUserFromRequest });

    const ctx = mockContext(controller.searchHandler, 'user-1');
    const result = await minimalGuard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx.switchToHttp().getRequest()['canaryVariant']).toBe('canary');
  });
});

// ── CanaryModule ─────────────────────────────────────────────

describe('CanaryModule', () => {
  describe('forRoot', () => {
    it('returns a valid DynamicModule shape', () => {
      const storage = new InMemoryStorage();
      const mod = CanaryModule.forRoot({
        storage,
        getUserFromRequest: (req) => {
          const u = req['user'] as { id: string } | undefined;
          return u ? { id: u.id } : null;
        },
      });

      expect(mod.module).toBe(CanaryModule);
      expect(mod.global).toBe(true);
      expect(mod.providers).toBeDefined();
      expect(mod.exports).toBeDefined();

      // Should export CanaryManager and CanaryGuard
      expect(mod.exports).toContain(CanaryManager);
      expect(mod.exports).toContain(CanaryGuard);
      expect(mod.exports).toContain(CANARY_MANAGER);
    });

    it('respects isGlobal: false', () => {
      const mod = CanaryModule.forRoot({
        storage: new InMemoryStorage(),
        getUserFromRequest: () => null,
        isGlobal: false,
      });
      expect(mod.global).toBe(false);
    });

    it('provides CanaryManager as a real instance', () => {
      const storage = new InMemoryStorage();
      const mod = CanaryModule.forRoot({
        storage,
        getUserFromRequest: () => null,
      });

      // Find the CanaryManager provider
      const managerProvider = mod.providers!.find(
        (p: any) => p.provide === CanaryManager,
      );
      expect(managerProvider).toBeDefined();
      expect(managerProvider.useValue).toBeInstanceOf(CanaryManager);
    });

    it('provides CanaryGuard via factory', () => {
      const mod = CanaryModule.forRoot({
        storage: new InMemoryStorage(),
        getUserFromRequest: () => null,
      });

      const guardProvider = mod.providers!.find(
        (p: any) => p.provide === CanaryGuard,
      );
      expect(guardProvider).toBeDefined();
      expect(guardProvider.useFactory).toBeInstanceOf(Function);
      // Invoke the factory — should return a CanaryGuard
      const guard = guardProvider.useFactory();
      expect(guard).toBeInstanceOf(CanaryGuard);
    });

    it('includes experiment init provider when experiments are specified', () => {
      const mod = CanaryModule.forRoot({
        storage: new InMemoryStorage(),
        getUserFromRequest: () => null,
        experiments: [
          { name: 'test-exp', strategies: [{ type: 'percentage', percentage: 50 }] },
        ],
      });

      const initProvider = mod.providers!.find(
        (p: any) => p.provide === 'CANARY_MODULE_INIT',
      );
      expect(initProvider).toBeDefined();
    });

    it('experiment init creates experiments that do not exist', async () => {
      const storage = new InMemoryStorage();
      const mod = CanaryModule.forRoot({
        storage,
        getUserFromRequest: () => null,
        experiments: [
          { name: 'exp-a', strategies: [{ type: 'percentage', percentage: 10 }], description: 'Test' },
          { name: 'exp-b', strategies: [{ type: 'whitelist', userIds: ['alice'] }] },
        ],
      });

      const initProvider = mod.providers!.find(
        (p: any) => p.provide === 'CANARY_MODULE_INIT',
      );
      const initService = initProvider.useFactory();
      await initService.onModuleInit();

      // Experiments should be created
      const managerProvider = mod.providers!.find((p: any) => p.provide === CanaryManager);
      const manager = managerProvider.useValue as CanaryManager;
      expect(await manager.getExperiment('exp-a')).not.toBeNull();
      expect(await manager.getExperiment('exp-b')).not.toBeNull();
    });

    it('experiment init does not overwrite existing experiments', async () => {
      const storage = new InMemoryStorage();
      const mod = CanaryModule.forRoot({
        storage,
        getUserFromRequest: () => null,
        experiments: [
          { name: 'exp-a', strategies: [{ type: 'percentage', percentage: 99 }] },
        ],
      });

      // Pre-create the experiment with different config
      const managerProvider = mod.providers!.find((p: any) => p.provide === CanaryManager);
      const manager = managerProvider.useValue as CanaryManager;
      await manager.createExperiment('exp-a', [{ type: 'percentage', percentage: 5 }]);

      const initProvider = mod.providers!.find(
        (p: any) => p.provide === 'CANARY_MODULE_INIT',
      );
      const initService = initProvider.useFactory();
      await initService.onModuleInit();

      // Should keep the original config (percentage: 5), not overwrite
      const exp = await manager.getExperiment('exp-a');
      expect(exp!.strategies[0]).toEqual({ type: 'percentage', percentage: 5 });
    });

    it('does not include init provider when no experiments specified', () => {
      const mod = CanaryModule.forRoot({
        storage: new InMemoryStorage(),
        getUserFromRequest: () => null,
      });

      const initProvider = mod.providers!.find(
        (p: any) => p.provide === 'CANARY_MODULE_INIT',
      );
      expect(initProvider).toBeUndefined();
    });
  });

  describe('forRootAsync', () => {
    it('returns a valid DynamicModule shape', () => {
      const mod = CanaryModule.forRootAsync({
        useFactory: () => ({
          storage: new InMemoryStorage(),
          getUserFromRequest: () => null,
        }),
      });

      expect(mod.module).toBe(CanaryModule);
      expect(mod.global).toBe(true);
      expect(mod.providers).toBeDefined();
      expect(mod.exports).toContain(CanaryManager);
      expect(mod.exports).toContain(CanaryGuard);
    });

    it('respects isGlobal: false', () => {
      const mod = CanaryModule.forRootAsync({
        isGlobal: false,
        useFactory: () => ({
          storage: new InMemoryStorage(),
          getUserFromRequest: () => null,
        }),
      });
      expect(mod.global).toBe(false);
    });

    it('provides options via factory', () => {
      const mod = CanaryModule.forRootAsync({
        inject: ['CONFIG_TOKEN'],
        useFactory: (config: any) => ({
          storage: new InMemoryStorage(),
          getUserFromRequest: () => null,
        }),
      });

      const optionsProvider = mod.providers!.find(
        (p: any) => p.provide === CANARY_MODULE_OPTIONS,
      );
      expect(optionsProvider).toBeDefined();
      expect(optionsProvider.inject).toEqual(['CONFIG_TOKEN']);
    });

    it('CanaryManager factory receives options and returns instance', () => {
      const mod = CanaryModule.forRootAsync({
        useFactory: () => ({
          storage: new InMemoryStorage(),
          getUserFromRequest: () => null,
        }),
      });

      const managerProvider = mod.providers!.find(
        (p: any) => p.provide === CanaryManager,
      );
      expect(managerProvider.useFactory).toBeInstanceOf(Function);
      expect(managerProvider.inject).toEqual([CANARY_MODULE_OPTIONS]);

      // Call the factory with mock options
      const opts = {
        storage: new InMemoryStorage(),
        getUserFromRequest: () => null,
      };
      const result = managerProvider.useFactory(opts);
      expect(result).toBeInstanceOf(CanaryManager);
    });

    it('CanaryGuard factory receives manager + options', () => {
      const mod = CanaryModule.forRootAsync({
        useFactory: () => ({
          storage: new InMemoryStorage(),
          getUserFromRequest: () => null,
        }),
      });

      const guardProvider = mod.providers!.find(
        (p: any) => p.provide === CanaryGuard,
      );
      expect(guardProvider.inject).toEqual([CanaryManager, CANARY_MODULE_OPTIONS]);

      const manager = new CanaryManager({ storage: new InMemoryStorage() });
      const opts = { getUserFromRequest: () => null, denyStable: false };
      const guard = guardProvider.useFactory(manager, opts);
      expect(guard).toBeInstanceOf(CanaryGuard);
    });

    it('CANARY_MANAGER token uses same instance as CanaryManager class', () => {
      const mod = CanaryModule.forRootAsync({
        useFactory: () => ({
          storage: new InMemoryStorage(),
          getUserFromRequest: () => null,
        }),
      });

      const tokenProvider = mod.providers!.find(
        (p: any) => p.provide === CANARY_MANAGER,
      );
      expect(tokenProvider.useExisting).toBe(CanaryManager);
    });
  });
});

// ── CanaryVariant decorator ──────────────────────────────────

describe('CanaryVariant decorator', () => {
  it('stores parameter indices as metadata', () => {
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
