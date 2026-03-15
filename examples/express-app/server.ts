/**
 * Express + @futurmille/canary-node — Complete canary release example
 *
 * This server demonstrates the FULL lifecycle:
 * 1. Define WHO gets canary (strategies + getUserFromRequest)
 * 2. Route SAME endpoint to different behavior based on variant
 * 3. MEASURE performance difference between stable vs canary
 * 4. DECIDE to increase rollout or rollback based on metrics
 *
 * Run:
 *   cd examples/express-app
 *   npm install
 *   npm start
 *
 * Test the flow:
 *   # 1. Stable user sees basic product
 *   curl http://localhost:3000/products/1 -H "x-user-id: user-42"
 *
 *   # 2. Whitelisted QA sees canary (new features)
 *   curl http://localhost:3000/products/1 -H "x-user-id: admin-1"
 *
 *   # 3. Enterprise customer sees canary
 *   curl http://localhost:3000/products/1 -H "x-user-id: corp-user" -H "x-user-plan: enterprise"
 *
 *   # 4. Check performance comparison
 *   curl http://localhost:3000/admin/canary/product-page-v2/metrics
 *
 *   # 5. Metrics look good? Increase rollout
 *   curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollout \
 *     -d '{"percentage":50}' -H "Content-Type: application/json"
 *
 *   # 6. Something wrong? Instant rollback
 *   curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollback
 */

import express, { Request, Response } from 'express';
import {
  CanaryManager,
  CanaryMetricsCollector,
  InMemoryStorage,
  canaryMiddleware,
  canaryGuard,
  canaryMetricsMiddleware,
  CanaryUser,
} from '@futurmille/canary-node';

const app = express();
app.use(express.json());

// ══════════════════════════════════════════════════════════════
// STEP 1: Initialize the canary system
// ══════════════════════════════════════════════════════════════

const storage = new InMemoryStorage();

const metrics = new CanaryMetricsCollector({
  onMetric: (record) => {
    // In production, forward to Datadog/Prometheus/CloudWatch:
    // statsd.histogram('canary.response_time', record.responseTimeMs, {
    //   experiment: record.experiment,
    //   variant: record.variant,
    // });
  },
});

const manager = new CanaryManager({
  storage,
  hooks: {
    onAssignment: (event) => {
      console.log(
        `[canary] ${event.user.id} → ${event.variant} ` +
        `(reason=${event.reason}, cached=${event.cached})`,
      );
    },
    onRollback: (event) => {
      console.log(`[ROLLBACK] ${event.experiment}: cleared ${event.previousAssignments} assignments`);
      metrics.clear(event.experiment);
    },
  },
});

// ══════════════════════════════════════════════════════════════
// STEP 2: Define HOW to identify users from incoming requests
// ══════════════════════════════════════════════════════════════
//
// This is the bridge between YOUR auth system and the canary system.
// The attributes you extract here are what strategies match against.

function extractUser(req: Request): CanaryUser | null {
  // In production, this reads from JWT / Passport / session:
  //   const user = req.user;  // populated by passport
  //   return { id: user.sub, attributes: { plan: user.plan, role: user.role } };
  //
  // For this demo, we use headers:
  const userId = req.headers['x-user-id'];
  if (!userId || typeof userId !== 'string') return null;

  return {
    id: userId,
    attributes: {
      plan: (req.headers['x-user-plan'] as string) || 'free',
      country: (req.headers['x-user-country'] as string) || 'US',
    },
  };
}

// ══════════════════════════════════════════════════════════════
// STEP 3: Apply middleware chain
// ══════════════════════════════════════════════════════════════
//
// Request flow:
//   → canaryMiddleware: resolves variant, sets req.canaryVariant
//   → canaryMetricsMiddleware: starts timer, records on response finish
//   → your route handler: uses req.canaryVariant to branch logic

app.use(
  canaryMiddleware(manager, {
    experimentName: 'product-page-v2',
    getUserFromRequest: extractUser as any,
  }),
);

app.use(
  canaryMetricsMiddleware(metrics, {
    experimentName: 'product-page-v2',
    getUserId: (req) => {
      const header = (req as any).headers?.['x-user-id'];
      return typeof header === 'string' ? header : 'anonymous';
    },
  }),
);

// ══════════════════════════════════════════════════════════════
// STEP 4: Route handlers — SAME endpoint, DIFFERENT behavior
// ══════════════════════════════════════════════════════════════
//
// Both stable and canary users hit the SAME URL.
// The variant decides what they see.

app.get('/products/:id', async (req: Request, res: Response) => {
  const variant = (req as any).canaryVariant; // 'stable' | 'canary'
  const productId = req.params.id;

  // Record that the user actually SAW this variant (for analytics)
  const user = extractUser(req);
  if (user) await manager.recordExposure(user, 'product-page-v2');

  if (variant === 'canary') {
    // ── NEW version: richer product data ──
    res.json({
      id: productId,
      name: 'Premium Widget',
      price: 29.99,
      variant: 'canary',
      reviews: { average: 4.5, count: 128 },
      relatedProducts: ['widget-2', 'widget-3'],
      aiSummary: 'Customers love this widget for its durability.',
    });
  } else {
    // ── CURRENT version: basic product data ──
    res.json({
      id: productId,
      name: 'Premium Widget',
      price: 29.99,
      variant: 'stable',
    });
  }
});

// Canary-only route — returns 404 for stable users
app.get(
  '/products/:id/recommendations',
  canaryGuard(manager, {
    experimentName: 'product-page-v2',
    getUserFromRequest: extractUser as any,
  }),
  (_req: Request, res: Response) => {
    res.json({
      recommendations: [
        { id: 'rec-1', name: 'Deluxe Widget', score: 0.95 },
        { id: 'rec-2', name: 'Widget Pro', score: 0.87 },
      ],
    });
  },
);

// ══════════════════════════════════════════════════════════════
// STEP 5: Admin endpoints — manage experiments at runtime
// ══════════════════════════════════════════════════════════════

// List all experiments
app.get('/admin/canary/experiments', async (_req, res) => {
  res.json({ experiments: await manager.listExperiments() });
});

// Compare performance between stable and canary
app.get('/admin/canary/:name/metrics', (req, res) => {
  const report = metrics.compare(req.params.name);
  res.json(report);
});

// Increase canary percentage
app.post('/admin/canary/:name/rollout', async (req: Request, res: Response) => {
  try {
    const updated = await manager.increaseRollout(req.params.name, req.body.percentage);
    res.json({ message: `Rollout updated to ${req.body.percentage}%`, experiment: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Instant rollback
app.post('/admin/canary/:name/rollback', async (req: Request, res: Response) => {
  await manager.rollback(req.params.name);
  res.json({ message: `Rolled back ${req.params.name}. All users now see stable.` });
});

// ══════════════════════════════════════════════════════════════
// STEP 6: Bootstrap — define experiments and targeting rules
// ══════════════════════════════════════════════════════════════

async function bootstrap() {
  await manager.createExperiment('product-page-v2', [
    // WHO gets canary? Evaluated top-to-bottom, first match wins:

    // Rule 1: QA team always gets canary (by user ID)
    { type: 'whitelist', userIds: ['admin-1', 'admin-2', 'qa-1'] },

    // Rule 2: Enterprise customers always get canary (by user attribute)
    { type: 'attribute', attribute: 'plan', values: ['enterprise'] },

    // Rule 3: 10% of remaining users (deterministic: same user = same bucket)
    { type: 'percentage', percentage: 10 },

    // Everyone else → stable (no rule matched)
  ], 'New product page with AI recommendations');

  app.listen(3000, () => {
    console.log('\n🚀 Express canary example running on http://localhost:3000\n');
    console.log('Try the full lifecycle:\n');
    console.log('  1. See stable version:');
    console.log('     curl http://localhost:3000/products/1 -H "x-user-id: user-42"\n');
    console.log('  2. See canary version (QA whitelist):');
    console.log('     curl http://localhost:3000/products/1 -H "x-user-id: admin-1"\n');
    console.log('  3. See canary version (enterprise):');
    console.log('     curl http://localhost:3000/products/1 -H "x-user-id: corp" -H "x-user-plan: enterprise"\n');
    console.log('  4. Compare performance:');
    console.log('     curl http://localhost:3000/admin/canary/product-page-v2/metrics\n');
    console.log('  5. Increase rollout:');
    console.log('     curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollout -d \'{"percentage":50}\' -H "Content-Type: application/json"\n');
    console.log('  6. Rollback:');
    console.log('     curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollback\n');
  });
}

bootstrap().catch(console.error);
