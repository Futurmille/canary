# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-03-15

### Added

- npm version and provenance badges in README

### Fixed

- `ICanaryStorage.saveAssignment()` now accepts optional `ttlSeconds` parameter
- `RedisStorage.saveAssignment()` sets EXPIRE when TTL is provided
- `InMemoryStorage.saveAssignment()` stores expiry when TTL is provided

### Changed

- Publish workflow uses OIDC trusted publishing with `--provenance` flag

## [1.2.0] - 2026-03-15

### Added

- **Dashboard**: built-in browser dashboard at `/canary` — self-contained HTML, dark theme, auto-refresh
  - Side-by-side stable vs canary metrics with visual bars and verdicts
  - Action buttons: Increase Rollout, Rollback, Re-enable, Delete
  - JSON API at `/canary/api/data`
- CI badges, separate CI jobs (Lint, Test, Build, Security Audit)
- Dashboard screenshot in README

### Fixed

- Guards use `=== 'stable'` instead of `!== 'canary'` for multi-variant compatibility
- `forRootAsync()` now supports experiments auto-creation
- All package references updated to `@futurmille/canary`

## [1.0.0] - 2026-03-15

### Added

- **Core**: `CanaryManager` — experiment CRUD, variant resolution with sticky sessions, gradual rollout, instant rollback
- **Strategies**: Percentage (FNV-1a hash), Whitelist, Attribute-based targeting
- **Multi-variant**: strategies accept optional `variant` field for A/B/C testing
- **Storage**: `InMemoryStorage` (dev/test), `RedisStorage` (production with atomic SETNX)
- **Redis**: SCAN instead of KEYS, batched DEL, TTL via EXPIRE
- **Assignment TTL**: `assignmentTTLSeconds` config option
- **Express adapter**: `canaryMiddleware()`, `canaryGuard()`, `canaryMetricsMiddleware()`
- **NestJS adapter**: `CanaryModule.forRoot()` / `forRootAsync()`, `CanaryGuard`, `@CanaryExperiment()`
- **Fastify adapter**: `canaryFastifyPlugin()`
- **Hono adapter**: `canaryHonoMiddleware()`, `canaryHonoGuard()`
- **Metrics**: `CanaryMetricsCollector` with comparison reports and verdicts
- **Observability hooks**: `onAssignment`, `onExposure`, `onRollback`
- **Graceful degradation**: storage failure returns default variant
- **Zero runtime dependencies**: ioredis is optional peer dep
