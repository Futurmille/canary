# @ebutrera9103/canary-node — Integration Guide

## What is this?

A Node.js package that lets you ship new features to **specific users first** — without affecting everyone else. No separate deployments, no infrastructure changes, no load balancer config. Just install the package, define who should test the new feature, and deploy your code normally.

```
                    ONE deployment, ONE server

    Laura (enterprise)  ──GET /products/1──→  { name: "Laptop", reviews: {...}, aiSummary: "..." }  ← NEW version
    Pedro (free)        ──GET /products/1──→  { name: "Laptop" }                                     ← CURRENT version

    Same URL. Same server. Pedro doesn't know the new version exists.
```

---

## Table of Contents

1. [Installation](#1-installation)
2. [Quick Start (5 minutes)](#2-quick-start)
3. [Integration with NestJS](#3-integration-with-nestjs)
4. [Integration with Express](#4-integration-with-express)
5. [Defining Who Gets the New Version](#5-defining-who-gets-the-new-version)
6. [The Full Lifecycle](#6-the-full-lifecycle)
7. [Measuring Success](#7-measuring-success)
8. [Gradual Rollout](#8-gradual-rollout)
9. [Instant Rollback](#9-instant-rollback)
10. [Production Setup with Redis](#10-production-setup-with-redis)
11. [Admin API Endpoints](#11-admin-api-endpoints)
12. [Observability & Monitoring](#12-observability--monitoring)
13. [Testing](#13-testing)
14. [API Reference](#14-api-reference)
15. [FAQ](#15-faq)

---

## 1. Installation

### From GitHub Packages (private registry)

```bash
# Configure the registry for the @ebutrera9103 scope
echo "@ebutrera9103:registry=https://npm.pkg.github.com" >> .npmrc

# Install
npm install @ebutrera9103/canary-node
```

### For production with Redis (optional)

```bash
npm install ioredis
```

### Verify installation

```typescript
import { CanaryManager, InMemoryStorage } from '@ebutrera9103/canary-node';

const manager = new CanaryManager({ storage: new InMemoryStorage() });
console.log('canary-node installed successfully');
```

---

## 2. Quick Start

This is the minimum code to get canary releases working. In 3 steps:

```typescript
import { CanaryManager, InMemoryStorage } from '@ebutrera9103/canary-node';

// STEP 1: Create the manager
const manager = new CanaryManager({
  storage: new InMemoryStorage(),
});

// STEP 2: Define an experiment with targeting rules
await manager.createExperiment('checkout-v2', [
  // QA team always sees the new version
  { type: 'whitelist', userIds: ['qa-maria', 'qa-john'] },
  // Enterprise customers see the new version
  { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
  // 10% of everyone else
  { type: 'percentage', percentage: 10 },
]);

// STEP 3: Check which version a user should see
const variant = await manager.getVariant(
  { id: 'user-123', attributes: { plan: 'enterprise' } },
  'checkout-v2',
);

if (variant === 'canary') {
  // Show new checkout
} else {
  // Show current checkout
}
```

That's it. The rest of this guide covers how to integrate this into your actual NestJS or Express application.

---

## 3. Integration with NestJS

### 3.1 Register the module

Add `CanaryModule.forRoot()` to your root module. This makes `CanaryManager` and `CanaryGuard` available throughout your application via dependency injection.

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { CanaryModule, InMemoryStorage } from '@ebutrera9103/canary-node';
import { ProductsController } from './products.controller';

@Module({
  imports: [
    CanaryModule.forRoot({
      // Storage backend — use InMemoryStorage for dev, RedisStorage for production
      storage: new InMemoryStorage(),

      // How to extract the user from the incoming request.
      // This function is called on every request that goes through CanaryGuard.
      // It bridges YOUR auth system with the canary system.
      getUserFromRequest: (req) => {
        // req['user'] is set by your auth middleware (Passport, JWT guard, etc.)
        const user = req['user'] as any;
        if (!user) return null;

        return {
          id: user.sub || user.id,
          attributes: {
            plan: user.plan,       // used by attribute strategy
            role: user.role,       // used by attribute strategy
            country: user.country, // used by attribute strategy
          },
        };
      },

      // Experiments to create automatically on startup
      experiments: [
        {
          name: 'product-page-v2',
          description: 'New product page with AI reviews',
          strategies: [
            { type: 'whitelist', userIds: ['qa-1', 'qa-2'] },
            { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
            { type: 'percentage', percentage: 0 }, // start closed, open gradually
          ],
        },
      ],
    }),
  ],
  controllers: [ProductsController],
})
export class AppModule {}
```

### 3.2 Use in your controller

Add two decorators to any endpoint you want to canary:
- `@UseGuards(CanaryGuard)` — resolved from DI, no manual instantiation
- `@CanaryExperiment('experiment-name')` — tells the guard which experiment to evaluate

```typescript
// products.controller.ts
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import {
  CanaryGuard,
  CanaryExperiment,
  CanaryManager,
} from '@ebutrera9103/canary-node';

@Controller('products')
export class ProductsController {
  constructor(private readonly canaryManager: CanaryManager) {}

  @UseGuards(CanaryGuard)
  @CanaryExperiment('product-page-v2')
  @Get(':id')
  async getProduct(@Param('id') id: string, @Req() req: any) {
    // req.canaryVariant is set automatically by CanaryGuard
    // before this handler runs. You just read it.

    if (req.canaryVariant === 'canary') {
      // ── NEW VERSION ──
      // This code only runs for users targeted by the experiment.
      return {
        id,
        name: 'Laptop Pro',
        price: 1299,
        reviews: { average: 4.7, count: 234 },
        aiSummary: '94% of buyers recommend this laptop.',
      };
    }

    // ── CURRENT VERSION ──
    // This code runs for everyone else. Nothing changed for them.
    return {
      id,
      name: 'Laptop Pro',
      price: 1299,
    };
  }
}
```

### 3.3 What happens at runtime

```
Request: GET /products/laptop-1
Authorization: Bearer <laura's JWT>

    ┌──────────────────────────────────────────────────────────┐
    │ 1. YOUR AuthGuard runs first                             │
    │    Validates JWT, sets req.user = { sub: 'laura-001',    │
    │    plan: 'enterprise' }                                  │
    ├──────────────────────────────────────────────────────────┤
    │ 2. CanaryGuard runs second                               │
    │    Calls getUserFromRequest(req) → gets Laura's data     │
    │    Checks strategies:                                    │
    │      whitelist ['qa-1','qa-2'] → no match                │
    │      attribute plan=enterprise → MATCH → canary          │
    │    Saves assignment to storage (sticky)                   │
    │    Sets req.canaryVariant = 'canary'                     │
    ├──────────────────────────────────────────────────────────┤
    │ 3. YOUR controller runs third                            │
    │    Reads req.canaryVariant → 'canary'                    │
    │    Returns response with reviews + AI summary            │
    └──────────────────────────────────────────────────────────┘
```

### 3.4 Async configuration (for production)

When you need to inject `ConfigService` or create Redis connections from environment variables:

```typescript
import { CanaryModule, RedisStorage } from '@ebutrera9103/canary-node';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Module({
  imports: [
    ConfigModule.forRoot(),
    CanaryModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: new RedisStorage({
          client: new Redis(config.get('REDIS_URL')),
          prefix: `${config.get('APP_NAME')}:canary:`,
        }),
        getUserFromRequest: (req) => {
          const user = req['user'] as any;
          return user ? { id: user.sub, attributes: { plan: user.plan } } : null;
        },
      }),
    }),
  ],
})
export class AppModule {}
```

---

## 4. Integration with Express

### 4.1 Middleware setup

```typescript
import express from 'express';
import {
  CanaryManager,
  InMemoryStorage,
  CanaryMetricsCollector,
  canaryMiddleware,
  canaryMetricsMiddleware,
} from '@ebutrera9103/canary-node';

const app = express();
const storage = new InMemoryStorage();
const metrics = new CanaryMetricsCollector();
const manager = new CanaryManager({ storage });

// Apply canary middleware globally
app.use(
  canaryMiddleware(manager, {
    experimentName: 'product-page-v2',
    getUserFromRequest: (req) => {
      const user = (req as any).user; // from your auth middleware
      if (!user) return null;
      return { id: user.id, attributes: { plan: user.plan } };
    },
  }),
);

// Apply metrics middleware to track performance
app.use(
  canaryMetricsMiddleware(metrics, {
    experimentName: 'product-page-v2',
  }),
);

// Use in route handlers
app.get('/products/:id', (req, res) => {
  if ((req as any).canaryVariant === 'canary') {
    res.json({ id: req.params.id, name: 'Laptop', reviews: {...}, aiSummary: '...' });
  } else {
    res.json({ id: req.params.id, name: 'Laptop' });
  }
});
```

### 4.2 Route guard (canary-only endpoints)

If you have an endpoint that should only exist for canary users (returns 404 for everyone else):

```typescript
import { canaryGuard } from '@ebutrera9103/canary-node';

app.get(
  '/products/:id/ai-recommendations',
  canaryGuard(manager, {
    experimentName: 'product-page-v2',
    getUserFromRequest: (req) => {
      const user = (req as any).user;
      return user ? { id: user.id } : null;
    },
  }),
  (req, res) => {
    // Only canary users reach this handler.
    // Everyone else gets a 404.
    res.json({ recommendations: [...] });
  },
);
```

---

## 5. Defining Who Gets the New Version

The system decides who sees the new version based on **strategies**. Strategies are rules you define when creating an experiment. They are evaluated **top to bottom** — the first rule that matches wins.

### Available strategies

#### Whitelist — specific user IDs

Use for: QA team, internal testers, specific accounts.

```typescript
{ type: 'whitelist', userIds: ['qa-maria', 'qa-john', 'ceo-account'] }
```

#### Attribute — match on user properties

Use for: targeting by plan, country, role, company, or any custom property.

```typescript
// All enterprise customers
{ type: 'attribute', attribute: 'plan', values: ['enterprise'] }

// Users in US and Canada
{ type: 'attribute', attribute: 'country', values: ['US', 'CA'] }

// Admin users only
{ type: 'attribute', attribute: 'role', values: ['admin'] }

// A specific company
{ type: 'attribute', attribute: 'company', values: ['acme-corp'] }

// Users who opted into beta
{ type: 'attribute', attribute: 'betaOptIn', values: [true] }
```

The attribute values come from the `attributes` object you return in `getUserFromRequest`.

#### Percentage — random sample

Use for: gradual rollout to a percentage of all remaining users.

```typescript
{ type: 'percentage', percentage: 10 } // 10% of users
```

This is deterministic — the same user always gets the same result. It uses a hash of the user ID, so it's consistent across requests and server restarts.

### Combining strategies (priority chain)

Strategies are evaluated top to bottom. First match wins, rest are skipped:

```typescript
await manager.createExperiment('new-dashboard', [
  // Priority 1: QA team always gets canary
  { type: 'whitelist', userIds: ['qa-maria', 'qa-john'] },

  // Priority 2: Enterprise customers always get canary
  { type: 'attribute', attribute: 'plan', values: ['enterprise'] },

  // Priority 3: 5% of everyone else
  { type: 'percentage', percentage: 5 },
]);
```

| User | Matches | Variant |
|------|---------|---------|
| qa-maria (any plan) | Whitelist | `canary` |
| Laura (enterprise) | Attribute (plan) | `canary` |
| Pedro (free, in 5% bucket) | Percentage | `canary` |
| Carlos (free, not in bucket) | Nothing | `stable` |

### The getUserFromRequest bridge

This function connects YOUR auth system to the canary system. It tells canary-node what attributes the current user has, so strategies can match against them.

**With JWT / Passport:**
```typescript
getUserFromRequest: (req) => {
  const user = req['user'] as any; // Passport sets this
  if (!user) return null;
  return {
    id: user.sub,
    attributes: {
      plan: user.plan,
      role: user.role,
      country: user.country,
    },
  };
}
```

**With session-based auth:**
```typescript
getUserFromRequest: (req) => {
  const session = req['session'] as any;
  if (!session?.userId) return null;
  return {
    id: session.userId,
    attributes: { plan: session.plan },
  };
}
```

**With API key / header (for testing):**
```typescript
getUserFromRequest: (req) => {
  const headers = req['headers'] as Record<string, string>;
  const userId = headers['x-user-id'];
  if (!userId) return null;
  return {
    id: userId,
    attributes: { plan: headers['x-user-plan'] || 'free' },
  };
}
```

---

## 6. The Full Lifecycle

Here's how a canary release works from start to finish:

```
DAY 1                           DAY 2                     DAY 3-5                   DAY 7
┌──────────────┐  ┌─────────────────────┐  ┌────────────────────┐  ┌───────────────┐
│ Create       │  │ Measure             │  │ Gradual rollout    │  │ Cleanup       │
│ experiment   │  │ metrics             │  │                    │  │               │
│              │  │                     │  │ 5% → 25% → 50%    │  │ Delete        │
│ QA + enter-  │→ │ Compare latency     │→ │ → 100%             │→ │ experiment    │
│ prise only   │  │ and error rates     │  │                    │  │               │
│              │  │                     │  │ If bad at any      │  │ Remove        │
│ 0% rollout   │  │ Verdict: safe?      │  │ point → rollback   │  │ if/else       │
└──────────────┘  └─────────────────────┘  └────────────────────┘  └───────────────┘
```

### Day 1: Create experiment

```typescript
await manager.createExperiment('new-feature', [
  { type: 'whitelist', userIds: ['qa-1', 'qa-2'] },
  { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
  { type: 'percentage', percentage: 0 },
], 'New product page with AI reviews');
```

### Day 2: Monitor metrics

```typescript
const report = metrics.compare('new-feature');
console.log(report.verdict);
// 'canary-is-better' | 'canary-is-worse' | 'no-significant-difference' | 'insufficient-data'
```

### Day 3-5: Gradual rollout

```typescript
await manager.increaseRollout('new-feature', 5);   // open to 5%
await manager.increaseRollout('new-feature', 25);  // then 25%
await manager.increaseRollout('new-feature', 50);  // then 50%
await manager.increaseRollout('new-feature', 100); // everyone
```

Existing users keep their assigned variant (sticky sessions). New users get assigned based on the updated percentage.

### Day 7: Cleanup

```typescript
// 1. Delete the experiment (clears all assignments from storage)
await manager.deleteExperiment('new-feature');

// 2. Remove the if/else from your controller (keep only the v2 code)
// 3. Remove @UseGuards(CanaryGuard) and @CanaryExperiment decorators
```

---

## 7. Measuring Success

The `CanaryMetricsCollector` records response time and error rate for every request, grouped by variant. It then generates a comparison report.

### Setup

```typescript
import { CanaryMetricsCollector } from '@ebutrera9103/canary-node';

const metrics = new CanaryMetricsCollector({
  // Optional: forward every metric to your external system
  onMetric: (record) => {
    // Send to Datadog, Prometheus, CloudWatch, etc.
    statsd.histogram('canary.response_time', record.responseTimeMs, {
      experiment: record.experiment,
      variant: record.variant,
    });
  },
});
```

### With Express

Use the metrics middleware to automatically record every request:

```typescript
import { canaryMetricsMiddleware } from '@ebutrera9103/canary-node';

// Place AFTER canaryMiddleware
app.use(canaryMetricsMiddleware(metrics, {
  experimentName: 'product-page-v2',
}));
```

### With NestJS

Record metrics manually in your controller (or create a custom interceptor):

```typescript
@UseGuards(CanaryGuard)
@CanaryExperiment('product-page-v2')
@Get(':id')
async getProduct(@Param('id') id: string, @Req() req: any) {
  const start = Date.now();
  const variant = req.canaryVariant;

  try {
    const result = variant === 'canary'
      ? await this.productServiceV2.get(id)
      : await this.productService.get(id);

    this.metrics.record({
      experiment: 'product-page-v2',
      variant,
      userId: req.user.sub,
      endpoint: `GET /products/${id}`,
      responseTimeMs: Date.now() - start,
      statusCode: 200,
      isError: false,
      timestamp: new Date().toISOString(),
    });

    return result;
  } catch (err) {
    this.metrics.record({
      experiment: 'product-page-v2',
      variant,
      userId: req.user.sub,
      endpoint: `GET /products/${id}`,
      responseTimeMs: Date.now() - start,
      statusCode: 500,
      isError: true,
      timestamp: new Date().toISOString(),
    });
    throw err;
  }
}
```

### Reading the comparison report

```typescript
const report = metrics.compare('product-page-v2');
```

Returns:

```json
{
  "experiment": "product-page-v2",
  "stable": {
    "totalRequests": 1842,
    "uniqueUsers": 921,
    "avgResponseTimeMs": 48.3,
    "p50ResponseTimeMs": 45,
    "p95ResponseTimeMs": 72,
    "p99ResponseTimeMs": 95,
    "errorCount": 3,
    "errorRate": 0.16
  },
  "canary": {
    "totalRequests": 312,
    "uniqueUsers": 156,
    "avgResponseTimeMs": 52.1,
    "p50ResponseTimeMs": 49,
    "p95ResponseTimeMs": 78,
    "p99ResponseTimeMs": 102,
    "errorCount": 1,
    "errorRate": 0.32
  },
  "responseTimeDiffMs": 3.8,
  "errorRateDiffPercent": 0.16,
  "verdict": "no-significant-difference"
}
```

### Verdict logic

| Verdict | Condition | What to do |
|---------|-----------|------------|
| `insufficient-data` | Either variant has < 30 requests | Wait for more traffic |
| `canary-is-worse` | Error rate +2% higher OR p95 latency 1.5x slower | Rollback immediately |
| `canary-is-better` | Error rate 1% lower OR p95 latency < 90% of stable | Safe to increase rollout |
| `no-significant-difference` | Metrics are similar | Safe to increase rollout |

---

## 8. Gradual Rollout

Increase the canary percentage over time without affecting existing users:

```typescript
// Start at 5%
await manager.increaseRollout('product-page-v2', 5);

// Check metrics, then increase
const report = metrics.compare('product-page-v2');
if (report.verdict !== 'canary-is-worse') {
  await manager.increaseRollout('product-page-v2', 25);
}

// Keep going
await manager.increaseRollout('product-page-v2', 50);
await manager.increaseRollout('product-page-v2', 100); // full rollout
```

**How it preserves session integrity:**

- User A was assigned `canary` at 5% → still `canary` at 50% (sticky session in storage)
- User B was assigned `stable` at 5% → might become `canary` at 50% (if their hash bucket is now below the threshold)
- A user's assignment never flips from `canary` back to `stable` during a rollout increase

---

## 9. Instant Rollback

If something goes wrong, one call moves all users back to the current version:

```typescript
await manager.rollback('product-page-v2');
```

This does three things:
1. Deletes all persisted assignments (sticky sessions)
2. Disables the experiment
3. Fires the `onRollback` hook

No redeployment needed. The next request from any user will get `stable`.

To re-enable after fixing the issue:

```typescript
await manager.updateExperiment('product-page-v2', { enabled: true });
```

---

## 10. Production Setup with Redis

For multi-process deployments (PM2 cluster, Kubernetes, etc.), use Redis for shared storage:

```bash
npm install ioredis
```

```typescript
import Redis from 'ioredis';
import { CanaryManager, RedisStorage } from '@ebutrera9103/canary-node';

const manager = new CanaryManager({
  storage: new RedisStorage({
    client: new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD,
    }),
    prefix: 'myapp:canary:', // optional, defaults to 'canary:'
  }),
});
```

**Why Redis matters:**

- **Sticky sessions** are persisted in Redis — all server instances share the same assignments
- **Atomic SETNX** guarantees that when two processes assign the same user simultaneously, exactly one wins
- **Graceful degradation** — if Redis goes down, `getVariant()` returns `stable` instead of throwing

---

## 11. Admin API Endpoints

Add these endpoints to manage experiments at runtime without redeploying.

### NestJS

```typescript
import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { CanaryManager, CanaryMetricsCollector } from '@ebutrera9103/canary-node';

@Controller('admin/canary')
export class CanaryAdminController {
  private metrics = new CanaryMetricsCollector();

  constructor(private readonly manager: CanaryManager) {}

  @Get('experiments')
  list() {
    return this.manager.listExperiments();
  }

  @Get(':name/metrics')
  compare(@Param('name') name: string) {
    return this.metrics.compare(name);
  }

  @Post(':name/rollout')
  rollout(@Param('name') name: string, @Body() body: { percentage: number }) {
    return this.manager.increaseRollout(name, body.percentage);
  }

  @Post(':name/rollback')
  rollback(@Param('name') name: string) {
    return this.manager.rollback(name);
  }

  @Post(':name/enable')
  enable(@Param('name') name: string) {
    return this.manager.updateExperiment(name, { enabled: true });
  }

  @Delete(':name')
  delete(@Param('name') name: string) {
    return this.manager.deleteExperiment(name);
  }
}
```

### Usage with curl

```bash
# List all experiments
curl http://localhost:3000/admin/canary/experiments

# Compare stable vs canary performance
curl http://localhost:3000/admin/canary/product-page-v2/metrics

# Increase rollout to 50%
curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollout \
  -H "Content-Type: application/json" \
  -d '{"percentage": 50}'

# Instant rollback
curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollback

# Re-enable after rollback
curl -X POST http://localhost:3000/admin/canary/product-page-v2/enable

# Delete experiment (after full rollout)
curl -X DELETE http://localhost:3000/admin/canary/product-page-v2
```

---

## 12. Observability & Monitoring

### Hooks

Wire canary events to your monitoring stack:

```typescript
const manager = new CanaryManager({
  storage,
  hooks: {
    // Fires on every getVariant() call
    onAssignment: (event) => {
      // event.user       — { id, attributes }
      // event.experiment  — experiment name
      // event.variant     — 'stable' | 'canary'
      // event.reason      — 'whitelist' | 'attribute' | 'percentage' | 'no-strategy-matched'
      // event.cached      — true if this was a sticky session hit

      datadog.increment('canary.assignment', {
        experiment: event.experiment,
        variant: event.variant,
        reason: event.reason,
      });
    },

    // Fires when you call manager.recordExposure()
    onExposure: (event) => {
      amplitude.track('canary_exposure', {
        userId: event.user.id,
        experiment: event.experiment,
        variant: event.variant,
      });
    },

    // Fires on manager.rollback()
    onRollback: (event) => {
      slack.send(
        `Canary rollback: ${event.experiment} — cleared ${event.previousAssignments} assignments`
      );
    },
  },
});
```

### Tracking exposure

Assignment (deciding variant) and exposure (user actually sees it) are separate concepts. Track exposure when the user renders the canary feature:

```typescript
@Get(':id')
async getProduct(@Param('id') id: string, @Req() req: any) {
  if (req.canaryVariant === 'canary') {
    // Track that the user actually SAW the new version
    await this.canaryManager.recordExposure(
      { id: req.user.sub },
      'product-page-v2',
    );

    return { ...product, reviews, aiSummary };
  }
  return product;
}
```

### Response header

The Express middleware automatically sets `X-Canary-Variant: stable|canary` on every response. Use this for debugging in browser DevTools or in API gateway logs.

---

## 13. Testing

### Unit testing your controller

Use `InMemoryStorage` to control the experiment state in tests:

```typescript
import { CanaryManager, InMemoryStorage } from '@ebutrera9103/canary-node';

describe('ProductsController', () => {
  let manager: CanaryManager;
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    manager = new CanaryManager({ storage });
  });

  afterEach(() => {
    storage.clear();
  });

  it('returns reviews for canary users', async () => {
    await manager.createExperiment('product-page-v2', [
      { type: 'percentage', percentage: 100 }, // everyone gets canary
    ]);

    const variant = await manager.getVariant(
      { id: 'test-user' },
      'product-page-v2',
    );
    expect(variant).toBe('canary');
  });

  it('returns basic product for stable users', async () => {
    await manager.createExperiment('product-page-v2', [
      { type: 'percentage', percentage: 0 }, // nobody gets canary
    ]);

    const variant = await manager.getVariant(
      { id: 'test-user' },
      'product-page-v2',
    );
    expect(variant).toBe('stable');
  });

  it('whitelisted users always get canary', async () => {
    await manager.createExperiment('product-page-v2', [
      { type: 'whitelist', userIds: ['qa-1'] },
      { type: 'percentage', percentage: 0 },
    ]);

    expect(await manager.getVariant({ id: 'qa-1' }, 'product-page-v2')).toBe('canary');
    expect(await manager.getVariant({ id: 'random' }, 'product-page-v2')).toBe('stable');
  });

  it('sticky sessions persist across calls', async () => {
    await manager.createExperiment('product-page-v2', [
      { type: 'percentage', percentage: 100 },
    ]);

    const first = await manager.getVariant({ id: 'user-1' }, 'product-page-v2');
    const second = await manager.getVariant({ id: 'user-1' }, 'product-page-v2');
    expect(first).toBe(second);
  });
});
```

### Testing metrics

```typescript
import { CanaryMetricsCollector } from '@ebutrera9103/canary-node';

it('compares variants correctly', () => {
  const metrics = new CanaryMetricsCollector();

  // Record 50 stable requests
  for (let i = 0; i < 50; i++) {
    metrics.record({
      experiment: 'test',
      variant: 'stable',
      userId: `u-${i}`,
      endpoint: 'GET /test',
      responseTimeMs: 50,
      statusCode: 200,
      isError: false,
      timestamp: new Date().toISOString(),
    });
  }

  // Record 50 canary requests (faster, no errors)
  for (let i = 0; i < 50; i++) {
    metrics.record({
      experiment: 'test',
      variant: 'canary',
      userId: `u-${i}`,
      endpoint: 'GET /test',
      responseTimeMs: 30,
      statusCode: 200,
      isError: false,
      timestamp: new Date().toISOString(),
    });
  }

  const report = metrics.compare('test');
  expect(report.verdict).toBe('canary-is-better');
});
```

---

## 14. API Reference

### CanaryManager

| Method | Returns | Description |
|--------|---------|-------------|
| `createExperiment(name, strategies, description?)` | `Promise<CanaryExperiment>` | Create a new experiment |
| `getExperiment(name)` | `Promise<CanaryExperiment \| null>` | Get experiment by name |
| `listExperiments()` | `Promise<CanaryExperiment[]>` | List all experiments |
| `updateExperiment(name, updates)` | `Promise<CanaryExperiment>` | Update experiment config |
| `deleteExperiment(name)` | `Promise<void>` | Delete experiment and all assignments |
| `getVariant(user, experimentName)` | `Promise<Variant>` | Resolve variant (sticky) |
| `recordExposure(user, experimentName)` | `Promise<void>` | Fire onExposure hook |
| `increaseRollout(experimentName, pct)` | `Promise<CanaryExperiment>` | Increase canary percentage |
| `rollback(experimentName)` | `Promise<void>` | Clear assignments + disable |
| `registerStrategy(strategy)` | `void` | Add custom assignment strategy |

### CanaryMetricsCollector

| Method | Returns | Description |
|--------|---------|-------------|
| `record(metric)` | `void` | Record a request metric |
| `compare(experimentName)` | `CanaryComparisonReport` | Compare stable vs canary |
| `getExperiments()` | `string[]` | List experiments with data |
| `clear(experimentName)` | `void` | Clear data for one experiment |
| `clearAll()` | `void` | Clear all data |

### Types

```typescript
type Variant = 'stable' | 'canary';

interface CanaryUser {
  id: string;
  attributes?: Record<string, string | number | boolean>;
}

type StrategyConfig =
  | { type: 'percentage'; percentage: number }
  | { type: 'whitelist'; userIds: string[] }
  | { type: 'attribute'; attribute: string; values: Array<string | number | boolean> };
```

### NestJS Exports

| Export | Type | Description |
|--------|------|-------------|
| `CanaryModule` | Class | Dynamic module with `forRoot()` / `forRootAsync()` |
| `CanaryGuard` | Class | NestJS guard, resolved via DI |
| `CanaryExperiment(name)` | Decorator | Marks a handler with an experiment name |
| `CANARY_MANAGER` | Symbol | Injection token for CanaryManager |

### Express Exports

| Export | Type | Description |
|--------|------|-------------|
| `canaryMiddleware(manager, options)` | Function | Global middleware, sets `req.canaryVariant` |
| `canaryGuard(manager, options)` | Function | Route guard, returns 404 for stable users |
| `canaryMetricsMiddleware(collector, options)` | Function | Records response time per variant |

---

## 15. FAQ

### Does this require deploying two separate versions of my app?

No. You deploy ONE version that contains both code paths. The canary system decides which path runs based on who the user is. No separate servers, no load balancer config, no Kubernetes routing.

### What happens if Redis goes down?

`getVariant()` catches all storage errors and returns `'stable'`. Your app stays up. No user sees an error. When Redis comes back, sticky sessions resume normally.

### Will a user ever flip between stable and canary?

No. Once assigned, a user always gets the same variant for that experiment. The assignment is persisted in storage (Redis or in-memory). This is called a "sticky session."

The only exceptions:
- You call `rollback()` — clears all assignments
- You call `deleteExperiment()` — removes everything
- The storage data is lost (Redis restart without persistence)

### Can I run multiple experiments at the same time?

Yes. Each experiment is independent. A user can be `canary` for experiment A and `stable` for experiment B.

### What's the performance overhead?

- Assignment decision: < 1ms (hash computation)
- Storage lookup: depends on your Redis latency (typically 0.5-2ms)
- Sticky session hit: one Redis GET (no strategy evaluation)

### How do I target users without attributes?

If your `getUserFromRequest` returns a user with just an `id` (no attributes), you can still use:
- `whitelist` strategy (matches by user ID)
- `percentage` strategy (hashes the user ID)

### When should I clean up the experiment?

After the rollout reaches 100% and you've confirmed the new version is stable (usually 3-7 days), delete the experiment and remove the if/else from your controller.
