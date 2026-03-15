// Core
export { CanaryManager } from './core/canary-manager';

// Types & interfaces
export type {
  Variant,
  CanaryUser,
  CanaryExperiment as CanaryExperimentConfig,
  CanaryConfig,
  CanaryHooks,
  Assignment,
  AssignmentEvent,
  ExposureEvent,
  RollbackEvent,
  StrategyConfig,
  PercentageStrategyConfig,
  WhitelistStrategyConfig,
  AttributeStrategyConfig,
  ICanaryStorage,
  IAssignmentStrategy,
} from './types';

// Storage adapters
export { InMemoryStorage } from './storage/in-memory';
export { RedisStorage } from './storage/redis';
export type { RedisStorageOptions } from './storage/redis';

// Strategies
export { PercentageStrategy } from './strategies/percentage';
export { WhitelistStrategy } from './strategies/whitelist';
export { AttributeStrategy } from './strategies/attribute';

// Express adapter
export { canaryMiddleware, canaryGuard } from './adapters/express';
export type { CanaryMiddlewareOptions } from './adapters/express';

// NestJS adapter
export { CanaryGuard, CanaryExperiment, CanaryVariant, CanaryModule } from './adapters/nestjs';
export { CANARY_MANAGER, CANARY_MODULE_OPTIONS } from './adapters/nestjs';
export type { CanaryGuardOptions, CanaryModuleOptions, CanaryModuleAsyncOptions } from './adapters/nestjs';
