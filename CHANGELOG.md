# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-15

### Added

- **Core**: `CanaryManager` — experiment CRUD, variant resolution with sticky sessions, gradual rollout, instant rollback
- **Strategies**: Percentage (FNV-1a hash), Whitelist, Attribute-based targeting
- **Multi-variant**: strategies accept optional `variant` field for A/B/C testing (not just stable/canary)
- **Storage**: `InMemoryStorage` (dev/test), `RedisStorage` (production with atomic SETNX)
- **Redis**: uses SCAN instead of KEYS for pattern matching (safe for large keyspaces), batched DEL
- **Assignment TTL**: `assignmentTTLSeconds` config option — sticky sessions auto-expire
- **Express adapter**: `canaryMiddleware()`, `canaryGuard()`, `canaryMetricsMiddleware()`
- **NestJS adapter**: `CanaryModule.forRoot()` / `forRootAsync()`, `CanaryGuard`, `@CanaryExperiment()` decorator
- **Fastify adapter**: `canaryFastifyPlugin()` with preHandler hook
- **Hono adapter**: `canaryHonoMiddleware()`, `canaryHonoGuard()` — works on Cloudflare Workers, Vercel Edge, Deno, Bun
- **Metrics**: `CanaryMetricsCollector` with comparison reports (avg/p50/p95/p99, error rates, verdict)
- **Observability hooks**: `onAssignment`, `onExposure`, `onRollback`
- **Graceful degradation**: storage failure returns default variant, never throws
- **Zero runtime dependencies**: ioredis is optional peer dep

### Non-functional

- 156 tests, 14 suites, 100% line coverage
- TypeScript strict mode, full declaration maps
- CI pipeline with Node.js 18, 20, 22
- Automated npm publish on GitHub Release
