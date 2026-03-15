import express from 'express';
import {
  CanaryManager,
  CanaryMetricsCollector,
  InMemoryStorage,
  canaryMiddleware,
  canaryMetricsMiddleware,
  canaryDashboard,
} from '@futurmille/canary';

const app = express();
app.use(express.json());

const storage = new InMemoryStorage();
const metrics = new CanaryMetricsCollector();
const manager = new CanaryManager({
  storage,
  hooks: {
    onAssignment: (e) => console.log(`[canary] ${e.user.id} -> ${e.variant} (${e.reason})`),
    onRollback: (e) => console.log(`[rollback] ${e.experiment}: cleared ${e.previousAssignments}`),
  },
});

// Canary middleware
app.use(canaryMiddleware(manager, {
  experimentName: 'product-page-v2',
  getUserFromRequest: (req) => {
    const userId = req.headers['x-user-id'];
    if (!userId || typeof userId !== 'string') return null;
    return {
      id: userId,
      attributes: {
        plan: (req.headers['x-user-plan'] as string) || 'free',
      },
    };
  },
}));

// Metrics middleware
app.use(canaryMetricsMiddleware(metrics, {
  experimentName: 'product-page-v2',
}));

// Product endpoint
app.get('/products/:id', (req, res) => {
  const variant = (req as any).canaryVariant;
  if (variant === 'canary') {
    res.json({
      id: req.params.id,
      name: 'Laptop Pro',
      price: 1299,
      variant: 'canary',
      reviews: { average: 4.7, count: 234 },
      aiSummary: '94% of buyers recommend this laptop.',
    });
  } else {
    res.json({
      id: req.params.id,
      name: 'Laptop Pro',
      price: 1299,
      variant: 'stable',
    });
  }
});

// Dashboard — this is all you need
app.use('/canary', canaryDashboard(manager, metrics));

async function bootstrap() {
  // Create experiments with different strategies
  await manager.createExperiment('product-page-v2', [
    { type: 'whitelist', userIds: ['admin-1', 'admin-2', 'qa-1'] },
    { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
    { type: 'percentage', percentage: 10 },
  ], 'New product page with AI reviews');

  await manager.createExperiment('checkout-v3', [
    { type: 'whitelist', userIds: ['qa-1'] },
    { type: 'percentage', percentage: 5 },
  ], 'Redesigned checkout flow');

  await manager.createExperiment('search-v2', [
    { type: 'attribute', attribute: 'plan', values: ['enterprise', 'business'] },
    { type: 'percentage', percentage: 0 },
  ], 'AI-powered search (not yet enabled for general users)');

  // Simulate some traffic so the dashboard has data to show
  console.log('Simulating traffic...\n');

  const users = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `ent-${i}`, attributes: { plan: 'enterprise' } })),
    ...Array.from({ length: 40 }, (_, i) => ({ id: `free-${i}`, attributes: { plan: 'free' } })),
  ];

  for (const user of users) {
    for (let r = 0; r < 3; r++) {
      for (const exp of ['product-page-v2', 'checkout-v3', 'search-v2']) {
        const variant = await manager.getVariant(user, exp);
        const isCanary = variant !== 'stable';
        const baseTime = isCanary ? 55 : 45;
        const jitter = Math.random() * 25;
        const isError = Math.random() < (isCanary ? 0.02 : 0.005);

        metrics.record({
          experiment: exp,
          variant,
          userId: user.id,
          endpoint: `GET /products/1`,
          responseTimeMs: baseTime + jitter,
          statusCode: isError ? 500 : 200,
          isError,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  app.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
    console.log('');
    console.log('Open the dashboard:');
    console.log('  http://localhost:3000/canary');
    console.log('');
    console.log('Test API endpoints:');
    console.log('  curl http://localhost:3000/products/1 -H "x-user-id: admin-1"');
    console.log('  curl http://localhost:3000/products/1 -H "x-user-id: user-42"');
  });
}

bootstrap().catch(console.error);
