import { CanaryManager } from '../../core/canary-manager';
import { CanaryConfig, CanaryUser, StrategyConfig } from '../../types';
import { CanaryGuard } from './guard';
import { CANARY_MANAGER, CANARY_MODULE_OPTIONS } from './tokens';

interface Type<T = any> {
  new (...args: any[]): T;
}

interface DynamicModule {
  module: Type;
  global?: boolean;
  providers?: any[];
  exports?: any[];
}

export interface CanaryModuleOptions extends CanaryConfig {
  getUserFromRequest: (req: Record<string, unknown>) => CanaryUser | null;
  isGlobal?: boolean;
  denyStable?: boolean;
  experiments?: Array<{
    name: string;
    strategies: StrategyConfig[];
    description?: string;
  }>;
}

export interface CanaryModuleAsyncOptions {
  isGlobal?: boolean;
  inject?: any[];
  useFactory: (...args: any[]) => CanaryModuleOptions | Promise<CanaryModuleOptions>;
}

export class CanaryModule {
  static forRoot(options: CanaryModuleOptions): DynamicModule {
    const manager = new CanaryManager({
      storage: options.storage,
      hooks: options.hooks,
      defaultVariant: options.defaultVariant,
    });

    return {
      module: CanaryModule,
      global: options.isGlobal !== false,
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
        ...(options.experiments?.length ? [{
          provide: 'CANARY_MODULE_INIT',
          useFactory: () => ({
            onModuleInit: async () => {
              for (const exp of options.experiments!) {
                const existing = await manager.getExperiment(exp.name);
                if (!existing) {
                  await manager.createExperiment(exp.name, exp.strategies, exp.description);
                }
              }
            },
          }),
        }] : []),
      ],
      exports: [CANARY_MANAGER, CanaryManager, CanaryGuard],
    };
  }

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
          useFactory: (opts: CanaryModuleOptions) => new CanaryManager({
            storage: opts.storage,
            hooks: opts.hooks,
            defaultVariant: opts.defaultVariant,
          }),
          inject: [CANARY_MODULE_OPTIONS],
        },
        {
          provide: CANARY_MANAGER,
          useExisting: CanaryManager,
        },
        {
          provide: CanaryGuard,
          useFactory: (manager: CanaryManager, opts: CanaryModuleOptions) => new CanaryGuard(manager, {
            getUserFromRequest: opts.getUserFromRequest,
            denyStable: opts.denyStable,
          }),
          inject: [CanaryManager, CANARY_MODULE_OPTIONS],
        },
        {
          provide: 'CANARY_MODULE_INIT',
          useFactory: (manager: CanaryManager, opts: CanaryModuleOptions) => ({
            onModuleInit: async () => {
              if (opts.experiments?.length) {
                for (const exp of opts.experiments) {
                  const existing = await manager.getExperiment(exp.name);
                  if (!existing) {
                    await manager.createExperiment(exp.name, exp.strategies, exp.description);
                  }
                }
              }
            },
          }),
          inject: [CanaryManager, CANARY_MODULE_OPTIONS],
        },
      ],
      exports: [CANARY_MANAGER, CanaryManager, CanaryGuard],
    };
  }
}
