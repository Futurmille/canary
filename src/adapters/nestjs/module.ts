import { CanaryManager } from '../../core/canary-manager';
import { CanaryConfig, CanaryUser, StrategyConfig } from '../../types';
import { CanaryGuard } from './guard';
import { CANARY_MANAGER, CANARY_MODULE_OPTIONS } from './tokens';

// ── Minimal NestJS type shapes (zero dependency on @nestjs/common) ───
// These match NestJS's interfaces so TypeScript is happy,
// but we never import from @nestjs/common at compile or runtime.

interface Type<T = any> {
  new (...args: any[]): T;
}

interface DynamicModule {
  module: Type;
  global?: boolean;
  providers?: any[];
  exports?: any[];
}

// ── Module configuration ─────────────────────────────────────────────

export interface CanaryModuleOptions extends CanaryConfig {
  /** Extract a CanaryUser from the NestJS request object.
   *  This is set once at module level — all guards use it. */
  getUserFromRequest: (req: Record<string, unknown>) => CanaryUser | null;
  /** If true, the module is registered globally (available in all modules). Default: true */
  isGlobal?: boolean;
  /** If true, guards deny access to stable users (403). Default: false */
  denyStable?: boolean;
  /** Experiment definitions to create on module init */
  experiments?: Array<{
    name: string;
    strategies: StrategyConfig[];
    description?: string;
  }>;
}

export interface CanaryModuleAsyncOptions {
  /** If true, the module is registered globally. Default: true */
  isGlobal?: boolean;
  /** Injection tokens to pass to useFactory */
  inject?: any[];
  /** Factory function that returns CanaryModuleOptions */
  useFactory: (...args: any[]) => CanaryModuleOptions | Promise<CanaryModuleOptions>;
}

// ── The Module ───────────────────────────────────────────────────────

/**
 * NestJS dynamic module for @canary-node/core.
 *
 * Usage:
 * ```ts
 * // app.module.ts
 * @Module({
 *   imports: [
 *     CanaryModule.forRoot({
 *       storage: new InMemoryStorage(),
 *       getUserFromRequest: (req) => req['user'] ? { id: req['user'].id } : null,
 *       experiments: [
 *         { name: 'checkout-v2', strategies: [{ type: 'percentage', percentage: 10 }] },
 *       ],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * Or with async factory (e.g., inject ConfigService):
 * ```ts
 * CanaryModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (config: ConfigService) => ({
 *     storage: new RedisStorage({ client: new Redis(config.get('REDIS_URL')) }),
 *     getUserFromRequest: (req) => req['user'] ? { id: req['user'].id } : null,
 *   }),
 * })
 * ```
 */
export class CanaryModule {
  /**
   * Synchronous module registration.
   */
  static forRoot(options: CanaryModuleOptions): DynamicModule {
    const manager = new CanaryManager({
      storage: options.storage,
      hooks: options.hooks,
      defaultVariant: options.defaultVariant,
    });

    return {
      module: CanaryModule,
      global: options.isGlobal !== false, // default true
      providers: [
        { provide: CANARY_MODULE_OPTIONS, useValue: options },
        { provide: CANARY_MANAGER, useValue: manager },
        { provide: CanaryManager, useValue: manager },
        {
          provide: CanaryGuard,
          useFactory: () => new CanaryGuard(manager, {
            getUserFromRequest: options.getUserFromRequest,
            denyStable: options.denyStable,
          }),
        },
        // OnModuleInit provider — creates experiments on startup
        ...(options.experiments?.length ? [{
          provide: 'CANARY_MODULE_INIT',
          useFactory: () => {
            return {
              onModuleInit: async () => {
                for (const exp of options.experiments!) {
                  const existing = await manager.getExperiment(exp.name);
                  if (!existing) {
                    await manager.createExperiment(exp.name, exp.strategies, exp.description);
                  }
                }
              },
            };
          },
        }] : []),
      ],
      exports: [CANARY_MANAGER, CanaryManager, CanaryGuard],
    };
  }

  /**
   * Async module registration — for when you need to inject ConfigService, Redis, etc.
   */
  static forRootAsync(options: CanaryModuleAsyncOptions): DynamicModule {
    return {
      module: CanaryModule,
      global: options.isGlobal !== false,
      providers: [
        {
          provide: CANARY_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        {
          provide: CanaryManager,
          useFactory: (opts: CanaryModuleOptions) => {
            return new CanaryManager({
              storage: opts.storage,
              hooks: opts.hooks,
              defaultVariant: opts.defaultVariant,
            });
          },
          inject: [CANARY_MODULE_OPTIONS],
        },
        {
          provide: CANARY_MANAGER,
          useExisting: CanaryManager,
        },
        {
          provide: CanaryGuard,
          useFactory: (manager: CanaryManager, opts: CanaryModuleOptions) => {
            return new CanaryGuard(manager, {
              getUserFromRequest: opts.getUserFromRequest,
              denyStable: opts.denyStable,
            });
          },
          inject: [CanaryManager, CANARY_MODULE_OPTIONS],
        },
      ],
      exports: [CANARY_MANAGER, CanaryManager, CanaryGuard],
    };
  }
}
