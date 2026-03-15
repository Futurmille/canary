export { CanaryManager } from './core/canary-manager';
export { CanaryMetricsCollector } from './core/metrics-collector';
export type { MetricRecord, VariantStats, CanaryComparisonReport } from './core/metrics-collector';

export type {
  Variant,
  BuiltInVariant,
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

export { InMemoryStorage } from './storage/in-memory';
export { RedisStorage } from './storage/redis';
export type { RedisStorageOptions } from './storage/redis';

export { PercentageStrategy } from './strategies/percentage';
export { WhitelistStrategy } from './strategies/whitelist';
export { AttributeStrategy } from './strategies/attribute';

export { canaryMiddleware, canaryGuard, canaryMetricsMiddleware } from './adapters/express';
export type { CanaryMiddlewareOptions, MetricsMiddlewareOptions } from './adapters/express';

export { canaryFastifyPlugin } from './adapters/fastify';
export type { CanaryFastifyPluginOptions } from './adapters/fastify';

export { canaryHonoMiddleware, canaryHonoGuard } from './adapters/hono';
export type { CanaryHonoMiddlewareOptions } from './adapters/hono';

export { CanaryGuard, CanaryExperiment, CanaryVariant, CanaryModule } from './adapters/nestjs';
export { CANARY_MANAGER, CANARY_MODULE_OPTIONS } from './adapters/nestjs';
export type { CanaryGuardOptions, CanaryModuleOptions, CanaryModuleAsyncOptions } from './adapters/nestjs';
