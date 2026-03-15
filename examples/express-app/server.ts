/**
 * Express + @canary-node/core — Real-world canary release example
 *
 * This server demonstrates:
 * - Setting up canary experiments on startup
 * - Global middleware to resolve variant for every request
 * - Route guards for canary-only endpoints
 * - Admin endpoints to manage experiments at runtime
 * - Gradual rollout and instant rollback
 *
 * Run:
 *   cd examples/express-app
 *   npm install
 *   npm start
 *
 * Test:
 *   # Get product (stable user)
 *   curl http://localhost:3000/products/1 -H "x-user-id: user-42"
 *
 *   # Get product (whitelisted canary user)
 *   curl http://localhost:3000/products/1 -H "x-user-id: admin-1"
 *
 *   # Get product (enterprise user → canary)
 *   curl http://localhost:3000/products/1 -H "x-user-id: corp-user" -H "x-user-plan: enterprise"
 *
 *   # Canary-only route (404 for non-canary users)
 *   curl http://localhost:3000/products/1/recommendations -H "x-user-id: admin-1"
 *
 *   # Admin: increase rollout
 *   curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollout -d '{"percentage":50}' -H "Content-Type: application/json"
 *
 *   # Admin: rollback
 *   curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollback
 *
 *   # Admin: list experiments
 *   curl http://localhost:3000/admin/canary/experiments
 */

import express, { Request, Response, NextFunction } from 'express';
import {
  CanaryManager,
  InMemoryStorage,
  canaryMiddleware,
  canaryGuard,
  CanaryUser,
} from '@canary-node/core';

const app = express();
app.use(express.json());

// ── 1. Initialize CanaryManager ──────────────────────────────

const storage = new InMemoryStorage();
const manager = new CanaryManager({
  storage,
  hooks: {
    onAssignment: (event) => {
      console.log(
        `[canary] ${event.user.id} → ${event.variant} ` +
        `(experiment=${event.experiment}, reason=${event.reason}, cached=${event.cached})`,
      );
    },
    onExposure: (event) => {
      console.log(`[exposure] ${event.user.id} saw ${event.experiment} as ${event.variant}`);
    },
    onRollback: (event) => {
      console.log(`[rollback] ${event.experiment}: cleared ${event.previousAssignments} assignments`);
    },
  },
});

// ── 2. User extractor ────────────────────────────────────────
// In production, you'd extract from JWT / session / auth middleware.
// Here we use headers for easy testing with curl.

function extractUser(req: Request): CanaryUser | null {
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

// ── 3. Apply canary middleware globally ───────────────────────

app.use(
  canaryMiddleware(manager, {
    experimentName: 'product-page-v2',
    getUserFromRequest: extractUser as any,
  }),
);

// ── 4. Product routes ────────────────────────────────────────

app.get('/products/:id', async (req: Request, res: Response) => {
  const variant = (req as any).canaryVariant;
  const productId = req.params.id;

  // Track that the user actually SAW the variant
  const user = extractUser(req);
  if (user) {
    await manager.recordExposure(user, 'product-page-v2');
  }

  if (variant === 'canary') {
    res.json({
      id: productId,
      name: 'Premium Widget',
      price: 29.99,
      variant: 'canary',
      // New canary features
      reviews: { average: 4.5, count: 128 },
      relatedProducts: ['widget-2', 'widget-3'],
      aiSummary: 'Customers love this widget for its durability.',
    });
  } else {
    res.json({
      id: productId,
      name: 'Premium Widget',
      price: 29.99,
      variant: 'stable',
    });
  }
});

// ── 5. Canary-only route (returns 404 for stable users) ──────

app.get(
  '/products/:id/recommendations',
  canaryGuard(manager, {
    experimentName: 'product-page-v2',
    getUserFromRequest: extractUser as any,
  }),
  (req: Request, res: Response) => {
    res.json({
      productId: req.params.id,
      recommendations: [
        { id: 'rec-1', name: 'Deluxe Widget', score: 0.95 },
        { id: 'rec-2', name: 'Widget Pro', score: 0.87 },
      ],
    });
  },
);

// ── 6. Admin endpoints for runtime experiment management ─────

app.get('/admin/canary/experiments', async (_req: Request, res: Response) => {
  const experiments = await manager.listExperiments();
  res.json({ experiments });
});

app.post('/admin/canary/:name/rollout', async (req: Request, res: Response) => {
  try {
    const { percentage } = req.body;
    const updated = await manager.increaseRollout(req.params.name, percentage);
    res.json({ message: `Rollout updated to ${percentage}%`, experiment: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/admin/canary/:name/rollback', async (req: Request, res: Response) => {
  await manager.rollback(req.params.name);
  res.json({ message: `Rolled back ${req.params.name}` });
});

// ── 7. Bootstrap: create experiments on startup ──────────────

async function bootstrap() {
  // Create the experiment with a strategy chain:
  // 1. Internal testers always get canary
  // 2. Enterprise plan users get canary
  // 3. 10% of everyone else
  await manager.createExperiment('product-page-v2', [
    { type: 'whitelist', userIds: ['admin-1', 'admin-2', 'qa-1'] },
    { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
    { type: 'percentage', percentage: 10 },
  ], 'New product page with AI recommendations');

  app.listen(3000, () => {
    console.log('Express canary example running on http://localhost:3000');
    console.log('');
    console.log('Try these requests:');
    console.log('  curl http://localhost:3000/products/1 -H "x-user-id: admin-1"        # canary (whitelist)');
    console.log('  curl http://localhost:3000/products/1 -H "x-user-id: user-42"         # stable (10% chance)');
    console.log('  curl http://localhost:3000/products/1 -H "x-user-id: corp" -H "x-user-plan: enterprise"  # canary (attribute)');
    console.log('  curl http://localhost:3000/admin/canary/experiments                    # list experiments');
    console.log('  curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollout -d \'{"percentage":50}\' -H "Content-Type: application/json"');
  });
}

bootstrap().catch(console.error);
