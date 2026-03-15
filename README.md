# @futurmille/canary-node

Production-ready, feature-level canary releases for Node.js. Route specific users to specific features without affecting the rest of your user base.

```bash
npm install @futurmille/canary-node
```

## Table of Contents

- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
  - [Experiments](#experiments)
  - [Strategies](#strategies)
  - [How User Targeting Works](#how-user-targeting-works)
  - [Sticky Sessions](#sticky-sessions)
  - [Gradual Rollout](#gradual-rollout)
  - [Instant Rollback](#instant-rollback)
- [Storage Adapters](#storage-adapters)
  - [InMemoryStorage](#inmemorystorage)
  - [RedisStorage](#redisstorage)
  - [Custom Adapter](#custom-adapter)
- [Framework Integration](#framework-integration)
  - [Express](#express)
  - [NestJS](#nestjs)
  - [Fastify](#fastify)
  - [Hono](#hono)
  - [Other Frameworks](#other-frameworks-hapi-koa-etc)
- [Observability Hooks](#observability-hooks)
- [Custom Strategies](#custom-strategies)
- [Graceful Degradation](#graceful-degradation)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Real-World Scenario](#real-world-scenario)
- [Runnable Examples](#runnable-examples)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Your Application                     │
├─────────────┬───────────────────────────┬───────────────┤
│  Express    │       NestJS              │  Fastify /    │
│  Middleware │  Guard + Decorators       │  Hapi / any   │
├─────────────┴───────────────────────────┴───────────────┤
│                    CanaryManager                        │
│            (assignment, rollout, rollback)               │
├──────────────────┬──────────────────────────────────────┤
│   Strategies     │          Storage (Port)              │
│  ┌────────────┐  │  ┌──────────────┐ ┌──────────────┐  │
│  │ Percentage │  │  │ InMemory     │ │ Redis        │  │
│  │ Whitelist  │  │  │ (tests/dev)  │ │ (production) │  │
│  │ Attribute  │  │  └──────────────┘ └──────────────┘  │
│  │ Custom...  │  │  ┌──────────────┐                   │
│  └────────────┘  │  │ Your Adapter │                   │
│                  │  └──────────────┘                   │
├──────────────────┴──────────────────────────────────────┤
│              Observability Hooks                        │
│       onAssignment · onExposure · onRollback            │
└─────────────────────────────────────────────────────────┘
```

**Design principles:**
- **Ports & Adapters** — storage and strategies are interfaces; swap implementations without touching business logic
- **Dependency Inversion** — consumers depend on `ICanaryStorage` and `IAssignmentStrategy`, not concrete classes
- **Single Responsibility** — routing logic, storage, assignment, and observability are separate concerns
- **Zero dependencies** — the core package has no runtime dependencies; Redis is an optional peer dep

## Quick Start

```typescript
import { CanaryManager, InMemoryStorage } from '@futurmille/canary-node';

// 1. Create the manager with a storage backend
const manager = new CanaryManager({
  storage: new InMemoryStorage(), // Use RedisStorage in production
});

// 2. Define an experiment with assignment strategies
await manager.createExperiment('checkout-v2', [
  { type: 'whitelist', userIds: ['internal-tester'] },          // Always canary
  { type: 'attribute', attribute: 'plan', values: ['enterprise'] }, // Enterprise gets canary
  { type: 'percentage', percentage: 10 },                        // 10% of everyone else
]);

// 3. Resolve which variant a user should see
const variant = await manager.getVariant(
  { id: 'user-123', attributes: { plan: 'free', country: 'US' } },
  'checkout-v2',
);

if (variant === 'canary') {
  // Show new checkout
} else {
  // Show current checkout
}
```

## Core Concepts

### Experiments

An experiment represents a single feature you want to canary. Each experiment has:
- A unique **name** (identifier)
- An **enabled** flag (can be toggled without deleting)
- A list of **strategies** (evaluated in order)

```typescript
// Create
const exp = await manager.createExperiment('search-v2', strategies, 'New search engine');

// Read
const exp = await manager.getExperiment('search-v2');
const all = await manager.listExperiments();

// Update (partial)
await manager.updateExperiment('search-v2', { enabled: false });
await manager.updateExperiment('search-v2', {
  strategies: [{ type: 'percentage', percentage: 50 }],
});

// Delete (also removes all assignments)
await manager.deleteExperiment('search-v2');
```

### Strategies

Strategies determine which users get the canary variant. They are evaluated **in order** — the first match wins. If no strategy matches, the user gets `stable`.

#### Percentage

Deterministic hash-based bucketing using FNV-1a. The same user always lands in the same bucket for a given experiment, even across restarts.

```typescript
{ type: 'percentage', percentage: 25 } // 25% of users get canary
```

#### Whitelist

Explicit user IDs. Use for internal team testing, beta users, or specific accounts.

```typescript
{ type: 'whitelist', userIds: ['alice', 'bob', 'qa-account-1'] }
```

#### Attribute

Match on user attributes like country, plan tier, role, or any custom property.

```typescript
{ type: 'attribute', attribute: 'country', values: ['US', 'CA'] }
{ type: 'attribute', attribute: 'plan', values: ['enterprise', 'business'] }
{ type: 'attribute', attribute: 'beta', values: [true] }
```

#### Combining strategies

Strategies compose naturally. This configuration means:
1. Internal testers **always** get canary
2. Enterprise users **always** get canary
3. 10% of **remaining** users get canary
4. Everyone else gets stable

```typescript
await manager.createExperiment('checkout-v2', [
  { type: 'whitelist', userIds: ['qa-1', 'qa-2'] },
  { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
  { type: 'percentage', percentage: 10 },
]);
```

### How user targeting works

The system needs two things to decide who gets canary:

1. **`getUserFromRequest`** — extracts user identity + attributes from the incoming request
2. **Strategies** — rules that match against those attributes

The connection between them:

```
                  getUserFromRequest                              Strategies
                  ══════════════════                              ══════════
Request ──→ Extract from JWT/session/headers ──→ { id, attributes } ──→ Evaluate rules ──→ 'canary' | 'stable'
```

#### Real-world `getUserFromRequest` examples

**JWT / Passport (most common in production):**

```typescript
getUserFromRequest: (req) => {
  // Passport populates req.user after AuthGuard runs
  const user = req['user'] as any;
  if (!user) return null; // unauthenticated → stable

  return {
    id: user.sub,            // ← used by whitelist strategy
    attributes: {
      plan: user.plan,       // ← used by attribute strategy (plan = enterprise?)
      role: user.role,       // ← used by attribute strategy (role = admin?)
      country: user.country, // ← used by attribute strategy (country = US?)
      company: user.orgId,   // ← used by attribute strategy (specific company?)
    },
  };
},
```

**Session-based auth:**

```typescript
getUserFromRequest: (req) => {
  const session = req['session'] as any;
  if (!session?.userId) return null;

  return {
    id: session.userId,
    attributes: {
      plan: session.plan,
      role: session.role,
    },
  };
},
```

**API key / header-based (for testing or internal services):**

```typescript
getUserFromRequest: (req) => {
  const headers = req['headers'] as Record<string, string>;
  const userId = headers['x-user-id'];
  if (!userId) return null;

  return {
    id: userId,
    attributes: {
      plan: headers['x-user-plan'] || 'free',
      country: headers['x-user-country'] || 'US',
    },
  };
},
```

#### Targeting scenarios

| I want to canary... | Strategy to use | Example |
|---|---|---|
| Specific user IDs (QA, internal team) | `whitelist` | `{ type: 'whitelist', userIds: ['qa-1', 'dev-alice'] }` |
| All enterprise customers | `attribute` | `{ type: 'attribute', attribute: 'plan', values: ['enterprise'] }` |
| Users in US and Canada | `attribute` | `{ type: 'attribute', attribute: 'country', values: ['US', 'CA'] }` |
| Admin users only | `attribute` | `{ type: 'attribute', attribute: 'role', values: ['admin'] }` |
| A specific company/org | `attribute` | `{ type: 'attribute', attribute: 'company', values: ['acme-corp'] }` |
| 5% of all users randomly | `percentage` | `{ type: 'percentage', percentage: 5 }` |
| Beta opt-in users | `attribute` | `{ type: 'attribute', attribute: 'beta', values: [true] }` |

#### Combining strategies (priority chain)

Strategies are evaluated **top to bottom**. First match wins, rest are skipped:

```typescript
await manager.createExperiment('new-dashboard', [
  // Priority 1: QA team — always canary, regardless of anything else
  { type: 'whitelist', userIds: ['qa-maria', 'qa-john'] },

  // Priority 2: Enterprise customers — always canary
  { type: 'attribute', attribute: 'plan', values: ['enterprise', 'business'] },

  // Priority 3: US users only (not ready for other regions yet)
  { type: 'attribute', attribute: 'country', values: ['US'] },

  // Priority 4: 0% of remaining users (will increase gradually)
  { type: 'percentage', percentage: 0 },
]);

// Later: start rolling out to 5% of remaining users
await manager.increaseRollout('new-dashboard', 5);
```

In this example:
- `qa-maria` → **canary** (matched by whitelist, stops here)
- Enterprise user in France → **canary** (matched by attribute plan, stops here)
- Free user in US → **canary** (matched by attribute country, stops here)
- Free user in Germany → **stable** or **canary** (only if in the 5% bucket)

### Sticky Sessions

Once a user is assigned a variant, they **always** get the same variant for that experiment — even if you change the experiment config later. Assignments are persisted in storage.

```typescript
await manager.getVariant(user, 'exp');  // 'canary' (first call: evaluates strategies, persists)
await manager.getVariant(user, 'exp');  // 'canary' (returned from storage, no re-evaluation)
```

In multi-process deployments (Redis), sticky assignments use atomic `SETNX` operations to guarantee exactly one process wins the assignment race.

### Gradual Rollout

Increase the canary percentage over time without reassigning existing users:

```typescript
// Start small
await manager.createExperiment('search-v2', [
  { type: 'percentage', percentage: 5 },
]);

// Monitor metrics, then increase
await manager.increaseRollout('search-v2', 10);   // 5% → 10%
await manager.increaseRollout('search-v2', 25);   // 10% → 25%
await manager.increaseRollout('search-v2', 50);   // 25% → 50%
await manager.increaseRollout('search-v2', 100);  // Full rollout
```

**How it works:** The percentage strategy uses a deterministic hash. A user's bucket (0-99) never changes — only the threshold moves. So a user who was canary at 5% is still canary at 50%. Users who were stable at 5% might become canary at 50% if their bucket falls below the new threshold.

### Instant Rollback

One call to move all users back to stable. No redeployment needed:

```typescript
await manager.rollback('search-v2');
```

This:
1. Deletes all persisted assignments for the experiment
2. Disables the experiment (so new requests also get `stable`)
3. Fires the `onRollback` hook

To re-enable after a rollback:
```typescript
await manager.updateExperiment('search-v2', { enabled: true });
```

## Storage Adapters

### InMemoryStorage

Best for: tests, single-process dev servers, prototyping.

```typescript
import { InMemoryStorage } from '@futurmille/canary-node';

const storage = new InMemoryStorage();

// Test helper: wipe all data between tests
storage.clear();
```

### RedisStorage

Best for: production, multi-process deployments (PM2, cluster mode, Kubernetes).

```bash
npm install ioredis
```

```typescript
import Redis from 'ioredis';
import { RedisStorage } from '@futurmille/canary-node';

const storage = new RedisStorage({
  client: new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
  }),
  prefix: 'myapp:canary:',  // optional, defaults to "canary:"
});

const manager = new CanaryManager({ storage });
```

**Thread safety:** `saveAssignmentIfNotExists` uses Redis `SETNX` (set-if-not-exists), guaranteeing that exactly one process wins the assignment race in concurrent deployments.

### Custom Adapter

Implement the `ICanaryStorage` interface to use any backend (PostgreSQL, DynamoDB, MongoDB, etc.):

```typescript
import { ICanaryStorage, CanaryExperiment, Assignment } from '@futurmille/canary-node';

class PostgresStorage implements ICanaryStorage {
  constructor(private pool: Pool) {}

  async getExperiment(name: string): Promise<CanaryExperiment | null> {
    const { rows } = await this.pool.query(
      'SELECT data FROM canary_experiments WHERE name = $1',
      [name],
    );
    return rows[0]?.data ?? null;
  }

  async saveExperiment(experiment: CanaryExperiment): Promise<void> {
    await this.pool.query(
      `INSERT INTO canary_experiments (name, data) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET data = $2`,
      [experiment.name, experiment],
    );
  }

  async deleteExperiment(name: string): Promise<void> { /* ... */ }
  async listExperiments(): Promise<CanaryExperiment[]> { /* ... */ }
  async getAssignment(userId: string, experimentName: string): Promise<Assignment | null> { /* ... */ }
  async saveAssignment(assignment: Assignment): Promise<void> { /* ... */ }
  async deleteAssignment(userId: string, experimentName: string): Promise<void> { /* ... */ }
  async deleteAllAssignments(experimentName: string): Promise<number> { /* ... */ }

  // Use INSERT ... ON CONFLICT DO NOTHING + check affected rows for atomicity
  async saveAssignmentIfNotExists(assignment: Assignment): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO canary_assignments (user_id, experiment_name, data)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [assignment.userId, assignment.experimentName, assignment],
    );
    return (rowCount ?? 0) > 0;
  }
}
```

## Framework Integration

### Express

#### Middleware (recommended for global experiments)

Evaluates the experiment for every request and attaches the result to `req.canaryVariant`:

```typescript
import express from 'express';
import { CanaryManager, InMemoryStorage, canaryMiddleware } from '@futurmille/canary-node';

const app = express();
const manager = new CanaryManager({ storage: new InMemoryStorage() });

// Apply globally
app.use(canaryMiddleware(manager, {
  experimentName: 'checkout-v2',
  getUserFromRequest: (req) => {
    const user = (req as any).user; // from your auth middleware
    if (!user) return null;
    return {
      id: user.id,
      attributes: { plan: user.plan, country: user.country },
    };
  },
}));

// Use in any route handler
app.get('/checkout', (req, res) => {
  const variant = (req as any).canaryVariant; // 'stable' | 'canary'
  if (variant === 'canary') {
    return res.render('checkout-v2');
  }
  return res.render('checkout');
});
```

**Middleware options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `experimentName` | `string` | required | Experiment to evaluate |
| `getUserFromRequest` | `(req) => CanaryUser \| null` | required | Extract user from request |
| `requestProperty` | `string` | `'canaryVariant'` | Property name on `req` |
| `setHeader` | `boolean` | `true` | Set `X-Canary-Variant` response header |

#### Guard (for canary-only routes)

Returns 404 for non-canary users — the route doesn't exist for them:

```typescript
import { canaryGuard } from '@futurmille/canary-node';

app.get('/checkout/v2-preview',
  canaryGuard(manager, {
    experimentName: 'checkout-v2',
    getUserFromRequest: (req) => {
      const user = (req as any).user;
      return user ? { id: user.id } : null;
    },
  }),
  (req, res) => {
    // Only canary users reach this handler
    res.json({ message: 'Welcome to checkout v2!' });
  },
);
```

### NestJS

The package provides a proper `CanaryModule` with `forRoot()` and `forRootAsync()` — the standard NestJS dynamic module pattern.

#### Step 1: Register the module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { CanaryModule, InMemoryStorage } from '@futurmille/canary-node';

@Module({
  imports: [
    CanaryModule.forRoot({
      // Storage backend (swap to RedisStorage for production)
      storage: new InMemoryStorage(),

      // How to extract a user from the request — set once, used by all guards
      getUserFromRequest: (req) => {
        const user = req['user'] as any; // from your auth middleware / passport
        if (!user) return null;
        return {
          id: user.id,
          attributes: { plan: user.plan, country: user.country },
        };
      },

      // Auto-create experiments on startup (won't overwrite existing)
      experiments: [
        {
          name: 'product-page-v2',
          strategies: [
            { type: 'whitelist', userIds: ['admin-1', 'qa-1'] },
            { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
            { type: 'percentage', percentage: 10 },
          ],
        },
      ],

      // Observability hooks
      hooks: {
        onAssignment: (e) => console.log(`[canary] ${e.user.id} → ${e.variant}`),
        onRollback: (e) => console.log(`[rollback] ${e.experiment}`),
      },
    }),
  ],
})
export class AppModule {}
```

#### Step 2: Use in controllers

The `CanaryGuard` is resolved from DI — no `new`, no constructor args. The `@CanaryExperiment()` decorator tells the guard which experiment to evaluate.

```typescript
// products.controller.ts
import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { CanaryGuard, CanaryExperiment, CanaryManager, Variant } from '@futurmille/canary-node';

@Controller('products')
export class ProductsController {
  constructor(private readonly canaryManager: CanaryManager) {}

  @UseGuards(CanaryGuard)              // ← resolved from DI, no manual instantiation
  @CanaryExperiment('product-page-v2') // ← which experiment to evaluate
  @Get(':id')
  async getProduct(@Param('id') id: string, @Req() req: any) {
    const variant: Variant = req.canaryVariant; // set by CanaryGuard

    if (variant === 'canary') {
      return {
        id,
        name: 'Widget',
        price: 29.99,
        reviews: { average: 4.5, count: 128 },       // new canary feature
        aiSummary: 'Customers love this widget.',      // new canary feature
      };
    }

    return { id, name: 'Widget', price: 29.99 };
  }
}
```

#### Step 3 (optional): Admin endpoints for runtime control

```typescript
// admin.controller.ts
import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { CanaryManager } from '@futurmille/canary-node';

@Controller('admin/canary')
export class AdminController {
  constructor(private readonly canaryManager: CanaryManager) {}

  @Get('experiments')
  listExperiments() {
    return this.canaryManager.listExperiments();
  }

  @Post(':name/rollout')
  increaseRollout(@Param('name') name: string, @Body() body: { percentage: number }) {
    return this.canaryManager.increaseRollout(name, body.percentage);
  }

  @Post(':name/rollback')
  rollback(@Param('name') name: string) {
    return this.canaryManager.rollback(name);
  }
}
```

#### Async configuration (production)

For when you need to inject `ConfigService`, Redis connections, etc.:

```typescript
import { CanaryModule, RedisStorage } from '@futurmille/canary-node';
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

**Module options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `storage` | `ICanaryStorage` | required | Storage backend |
| `getUserFromRequest` | `(req) => CanaryUser \| null` | required | Extract user from request |
| `hooks` | `CanaryHooks` | `undefined` | Observability hooks |
| `defaultVariant` | `Variant` | `'stable'` | Fallback variant |
| `isGlobal` | `boolean` | `true` | Register globally (available in all modules) |
| `denyStable` | `boolean` | `false` | Guards deny non-canary users (403) |
| `experiments` | `Array<{name, strategies}>` | `undefined` | Auto-create experiments on init |

### Fastify

```typescript
import Fastify from 'fastify';
import { CanaryManager, InMemoryStorage, canaryFastifyPlugin } from '@futurmille/canary-node';

const fastify = Fastify();
const manager = new CanaryManager({ storage: new InMemoryStorage() });

canaryFastifyPlugin(fastify, manager, {
  experimentName: 'checkout-v2',
  getUserFromRequest: (request) => {
    const user = request.user as any; // from your auth plugin
    return user ? { id: user.id, attributes: { plan: user.plan } } : null;
  },
});

fastify.get('/checkout', async (request) => {
  const variant = (request as any).canaryVariant; // set by plugin
  if (variant === 'canary') {
    return { checkout: 'v2', aiRecommendations: true };
  }
  return { checkout: 'v1' };
});
```

### Hono

Works on Cloudflare Workers, Vercel Edge, Deno, Bun, and Node.js:

```typescript
import { Hono } from 'hono';
import { CanaryManager, InMemoryStorage, canaryHonoMiddleware } from '@futurmille/canary-node';

const app = new Hono();
const manager = new CanaryManager({ storage: new InMemoryStorage() });

app.use('*', canaryHonoMiddleware(manager, {
  experimentName: 'checkout-v2',
  getUserFromContext: (c) => {
    const userId = c.req.header('x-user-id');
    if (!userId) return null;
    return { id: userId, attributes: { plan: c.req.header('x-user-plan') || 'free' } };
  },
}));

app.get('/checkout', (c) => {
  const variant = c.get('canaryVariant'); // set by middleware
  if (variant === 'canary') {
    return c.json({ checkout: 'v2', aiRecommendations: true });
  }
  return c.json({ checkout: 'v1' });
});
```

### Other Frameworks (Hapi, Koa, etc.)

For any framework without a dedicated adapter, use `manager.getVariant()` directly. This also works for non-HTTP contexts like WebSockets, gRPC, or message queues:

```typescript
// Hapi example
server.ext('onPreHandler', async (request, h) => {
  const userId = request.headers['x-user-id'];
  if (userId) {
    request.app.canaryVariant = await manager.getVariant(
      { id: userId },
      'checkout-v2',
    );
  } else {
    request.app.canaryVariant = 'stable';
  }
  return h.continue;
});

// WebSocket example
ws.on('message', async (data) => {
  const variant = await manager.getVariant(
    { id: socket.userId },
    'realtime-v2',
  );
  // use variant to decide response format
});

// Message queue / worker example
async function processJob(job) {
  const variant = await manager.getVariant(
    { id: job.userId, attributes: { plan: job.userPlan } },
    'new-pipeline',
  );
  // use variant to decide processing logic
}
```

## Observability Hooks

Three hooks let you integrate with your metrics, analytics, and alerting systems:

```typescript
const manager = new CanaryManager({
  storage,
  hooks: {
    // Fires on every getVariant() call
    onAssignment: (event) => {
      // event.user      — the CanaryUser
      // event.experiment — experiment name
      // event.variant   — 'stable' | 'canary'
      // event.reason    — which strategy matched (e.g., 'percentage', 'whitelist')
      // event.cached    — true if this was a sticky session hit (no re-evaluation)
      metrics.increment('canary.assignment', {
        experiment: event.experiment,
        variant: event.variant,
        cached: String(event.cached),
      });
    },

    // Fires when you call recordExposure() — when the user actually *sees* the feature
    onExposure: (event) => {
      analytics.track('canary_exposure', {
        userId: event.user.id,
        experiment: event.experiment,
        variant: event.variant,
      });
    },

    // Fires on rollback()
    onRollback: (event) => {
      // event.experiment          — experiment name
      // event.previousAssignments — how many assignments were cleared
      slack.send(`Rolled back ${event.experiment}: cleared ${event.previousAssignments} assignments`);
    },
  },
});

// Track when a user actually sees the canary feature (not just assignment)
app.get('/checkout', async (req, res) => {
  const variant = await manager.getVariant(user, 'checkout-v2');
  if (variant === 'canary') {
    await manager.recordExposure(user, 'checkout-v2'); // fires onExposure
    return res.render('checkout-v2');
  }
  return res.render('checkout');
});
```

Hook errors are caught silently — they **never** break the request pipeline or throw to the caller.

## Custom Strategies

Register your own strategy by implementing the `IAssignmentStrategy` interface:

```typescript
import { IAssignmentStrategy, CanaryUser, StrategyConfig, Variant } from '@futurmille/canary-node';

interface TimeWindowConfig extends StrategyConfig {
  type: 'time-window';
  startHour: number; // 0-23
  endHour: number;   // 0-23
}

class TimeWindowStrategy implements IAssignmentStrategy {
  readonly type = 'time-window';

  evaluate(user: CanaryUser, config: StrategyConfig): Variant | null {
    if (config.type !== 'time-window') return null;
    const { startHour, endHour } = config as TimeWindowConfig;
    const hour = new Date().getUTCHours();
    return hour >= startHour && hour < endHour ? 'canary' : null;
  }
}

// Register it
manager.registerStrategy(new TimeWindowStrategy());

// Use it in an experiment
await manager.createExperiment('off-peak-feature', [
  { type: 'time-window', startHour: 2, endHour: 6 } as any,
]);
```

## Graceful Degradation

If storage is unavailable (Redis down, network error), `getVariant()` returns the default variant (`'stable'`) instead of throwing. Your application stays up.

```typescript
// Customize the fallback variant
const manager = new CanaryManager({
  storage,
  defaultVariant: 'stable', // default; could also set to 'canary' if you want fail-open
});
```

## API Reference

### `CanaryManager`

| Method | Returns | Description |
|--------|---------|-------------|
| `createExperiment(name, strategies, description?)` | `Promise<CanaryExperiment>` | Create a new experiment |
| `getExperiment(name)` | `Promise<CanaryExperiment \| null>` | Get experiment by name |
| `listExperiments()` | `Promise<CanaryExperiment[]>` | List all experiments |
| `updateExperiment(name, updates)` | `Promise<CanaryExperiment>` | Update experiment config |
| `deleteExperiment(name)` | `Promise<void>` | Delete experiment and all its assignments |
| `getVariant(user, experimentName)` | `Promise<Variant>` | Resolve variant with sticky sessions |
| `recordExposure(user, experimentName)` | `Promise<void>` | Fire the onExposure hook |
| `increaseRollout(experimentName, newPct)` | `Promise<CanaryExperiment>` | Increase canary percentage |
| `rollback(experimentName)` | `Promise<void>` | Clear assignments + disable experiment |
| `registerStrategy(strategy)` | `void` | Add a custom assignment strategy |

### Core Types

```typescript
type Variant = 'stable' | 'canary';

interface CanaryUser {
  id: string;
  attributes?: Record<string, string | number | boolean>;
}

interface CanaryConfig {
  storage: ICanaryStorage;
  hooks?: CanaryHooks;
  defaultVariant?: Variant; // defaults to 'stable'
}

interface CanaryExperiment {
  name: string;
  description?: string;
  enabled: boolean;
  strategies: StrategyConfig[];
  createdAt: string;
  updatedAt: string;
}
```

### Strategy Configs

```typescript
type StrategyConfig =
  | { type: 'percentage'; percentage: number }          // 0-100
  | { type: 'whitelist'; userIds: string[] }
  | { type: 'attribute'; attribute: string; values: Array<string | number | boolean> };
```

### Hook Event Types

```typescript
interface AssignmentEvent {
  user: CanaryUser;
  experiment: string;
  variant: Variant;
  reason: string;    // 'percentage' | 'whitelist' | 'attribute' | 'no-strategy-matched'
  cached: boolean;   // true = sticky session hit
}

interface ExposureEvent {
  user: CanaryUser;
  experiment: string;
  variant: Variant;
}

interface RollbackEvent {
  experiment: string;
  previousAssignments: number; // how many assignments were cleared
}
```

## Testing

The package ships with `InMemoryStorage` specifically for test environments:

```typescript
import { CanaryManager, InMemoryStorage } from '@futurmille/canary-node';

describe('checkout feature', () => {
  let manager: CanaryManager;
  let storage: InMemoryStorage;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    manager = new CanaryManager({ storage });
    await manager.createExperiment('checkout-v2', [
      { type: 'percentage', percentage: 100 }, // everyone gets canary in tests
    ]);
  });

  afterEach(() => {
    storage.clear(); // reset between tests
  });

  it('serves new checkout to canary users', async () => {
    const variant = await manager.getVariant({ id: 'test-user' }, 'checkout-v2');
    expect(variant).toBe('canary');
  });
});
```

## Real-World Scenario

Here's how a typical canary rollout works end-to-end:

```typescript
// Day 1: Create experiment, internal team only
await manager.createExperiment('new-payment-flow', [
  { type: 'whitelist', userIds: ['eng-alice', 'eng-bob', 'qa-charlie'] },
  { type: 'percentage', percentage: 0 },
]);

// Day 2: QA passes, open to 1% of users
await manager.increaseRollout('new-payment-flow', 1);

// Day 3: Metrics look good, increase to 10%
await manager.increaseRollout('new-payment-flow', 10);

// Day 3 (later): Error rate spikes — instant rollback
await manager.rollback('new-payment-flow');
// All users immediately see stable. No deploy needed.

// Day 4: Bug fixed, re-enable at 5%
await manager.updateExperiment('new-payment-flow', { enabled: true });
await manager.increaseRollout('new-payment-flow', 5);

// Day 7: 50%, then 100%
await manager.increaseRollout('new-payment-flow', 50);
await manager.increaseRollout('new-payment-flow', 100);

// Day 14: Fully rolled out — clean up
await manager.deleteExperiment('new-payment-flow');
```

## Runnable Examples

The repo includes complete, runnable example apps:

- **`examples/express-app/`** — Express server with canary middleware, guards, and admin endpoints
- **`examples/nestjs-app/`** — NestJS app with `CanaryModule.forRoot()`, guard + decorator pattern, and admin controller

```bash
# Express
cd examples/express-app && npm install && npm start

# NestJS
cd examples/nestjs-app && npm install && npm start
```

Both examples run on `http://localhost:3000` with curl-friendly endpoints for testing.

## License

MIT
