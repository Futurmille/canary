# Complete Example: Canary Release End-to-End

## The Story

**MyStore.com** is an e-commerce platform with two active users:
- **Laura** (plan: `enterprise`, userId: `laura-001`) — corporate customer
- **Pedro** (plan: `free`, userId: `pedro-042`) — free tier customer

Both use the same product API. Today, the backend team is shipping a
**new version of the product endpoint** that includes AI-powered reviews.

The challenge: **Laura must test v2 without Pedro noticing anything changed.**

---

## Phase 1: Current State (no canary)

```
Pedro  ──GET /products/1──→  { name: "Laptop Pro", price: 1299 }
Laura  ──GET /products/1──→  { name: "Laptop Pro", price: 1299 }
```

Both see the same response. One controller, one code path.

→ See: `01-before-canary.ts`

---

## Phase 2: Developer integrates @futurmille/canary-node

The developer:
1. Installs the package
2. Configures `CanaryModule.forRoot()` with targeting rules
3. Adds `@UseGuards(CanaryGuard)` + `@CanaryExperiment('product-v2')` to the controller
4. Adds an `if (variant === 'canary')` to branch the logic

```
Pedro  ──GET /products/1──→  { name: "Laptop Pro", price: 1299 }              ← STABLE (nothing changed)
Laura  ──GET /products/1──→  { name: "Laptop Pro", price: 1299, reviews: ..., aiSummary: ... }  ← CANARY
```

→ See: `02-with-canary.ts`

---

## Phase 3: Measure performance

The developer compares metrics between stable and canary:

```
GET /admin/canary/product-v2/metrics

{
  stable: { avgResponseTimeMs: 45, p95: 62, errorRate: 0.1 },
  canary: { avgResponseTimeMs: 52, p95: 71, errorRate: 0.2 },
  verdict: "no-significant-difference"
}
```

→ See: `03-measure.ts`

---

## Phase 4: Gradual rollout

Metrics look good. The developer opens canary to more users:

```
POST /admin/canary/product-v2/rollout  { percentage: 25 }
POST /admin/canary/product-v2/rollout  { percentage: 50 }
POST /admin/canary/product-v2/rollout  { percentage: 100 }  ← Everyone sees v2
```

---

## Phase 5: Shut down the experiment

v2 is now the stable version. The developer cleans up:

1. Removes the `if/else` from the controller — keeps only v2 code
2. Deletes the experiment: `DELETE /admin/canary/product-v2`
3. Removes the `@CanaryExperiment` decorator

The code is clean, no trace of canary left.

→ See: `04-cleanup.ts`

---

## Run the examples

```bash
npx tsx examples/full-scenario/01-before-canary.ts
npx tsx examples/full-scenario/02-with-canary.ts
npx tsx examples/full-scenario/03-measure.ts
npx tsx examples/full-scenario/04-cleanup.ts
```
