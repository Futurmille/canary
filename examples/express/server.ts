/**
 * Express example — canary release for a new checkout flow.
 *
 * Run: npx ts-node examples/express/server.ts
 */
import { CanaryManager, InMemoryStorage, canaryMiddleware, canaryGuard } from '../../src';

// 1. Initialize
const manager = new CanaryManager({
  storage: new InMemoryStorage(),
  hooks: {
    onAssignment: (event) => {
      console.log(`[canary] ${event.user.id} → ${event.variant} (${event.reason}, cached=${event.cached})`);
    },
    onRollback: (event) => {
      console.log(`[canary] ROLLBACK ${event.experiment}: cleared ${event.previousAssignments} assignments`);
    },
  },
});

// 2. Create experiment on startup
async function bootstrap() {
  await manager.createExperiment('checkout-v2', [
    // Internal team always gets canary
    { type: 'whitelist', userIds: ['admin-1', 'admin-2'] },
    // Enterprise customers get canary
    { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
    // 10% of remaining users
    { type: 'percentage', percentage: 10 },
  ]);

  // ── Express app ──────────────────────────────────────────

  // Simulated Express-like app (replace with real express())
  const app = {
    use: (..._args: any[]) => {},
    get: (..._args: any[]) => {},
    listen: (port: number, cb: () => void) => cb(),
  };

  // 3. Apply middleware globally
  app.use(
    canaryMiddleware(manager, {
      experimentName: 'checkout-v2',
      getUserFromRequest: (req) => {
        const userId = req.headers['x-user-id'];
        if (!userId || typeof userId !== 'string') return null;
        return { id: userId, attributes: (req as any).userAttributes };
      },
    }),
  );

  // 4. Use variant in route handlers
  app.get('/checkout', (req: any, _res: any) => {
    if (req.canaryVariant === 'canary') {
      // Render new checkout
    } else {
      // Render current checkout
    }
  });

  // 5. Guard a canary-only route (returns 404 for stable users)
  app.get(
    '/checkout/v2-preview',
    canaryGuard(manager, {
      experimentName: 'checkout-v2',
      getUserFromRequest: (req) => {
        const userId = req.headers['x-user-id'];
        if (!userId || typeof userId !== 'string') return null;
        return { id: userId };
      },
    }),
    (_req: any, _res: any) => {
      // Only canary users reach here
    },
  );

  // 6. Gradual rollout — increase to 25% without reassigning existing users
  await manager.increaseRollout('checkout-v2', 25);

  // 7. Emergency rollback — instantly move everyone back to stable
  // await manager.rollback('checkout-v2');

  console.log('Express canary example ready');
}

bootstrap().catch(console.error);
