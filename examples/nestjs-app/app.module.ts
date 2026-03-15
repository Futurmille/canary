import { Module, OnModuleInit } from '@nestjs/common';
import {
  CanaryModule,
  CanaryManager,
  InMemoryStorage,
} from '@futurmille/canary';
import { ProductsController } from './products.controller';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    // ── Register CanaryModule globally ────────────────────────
    // This makes CanaryManager and CanaryGuard available in ALL modules
    // without needing to import CanaryModule in each one.
    CanaryModule.forRoot({
      // Storage backend — swap to RedisStorage for production:
      // storage: new RedisStorage({ client: new Redis(process.env.REDIS_URL) }),
      storage: new InMemoryStorage(),

      // How to extract a user from the NestJS request.
      // In production, this would read from JWT / session / passport.
      getUserFromRequest: (req) => {
        const userId = req['headers']
          ? (req['headers'] as Record<string, string>)['x-user-id']
          : undefined;
        if (!userId) return null;

        const headers = req['headers'] as Record<string, string>;
        return {
          id: userId,
          attributes: {
            plan: headers['x-user-plan'] || 'free',
            country: headers['x-user-country'] || 'US',
          },
        };
      },

      // Observability hooks — send to your metrics/alerting system
      hooks: {
        onAssignment: (event) => {
          console.log(
            `[canary] ${event.user.id} → ${event.variant} ` +
            `(experiment=${event.experiment}, reason=${event.reason}, cached=${event.cached})`,
          );
        },
        onRollback: (event) => {
          console.log(`[rollback] ${event.experiment}: cleared ${event.previousAssignments} assignments`);
        },
      },

      // Auto-create experiments on startup (won't overwrite existing ones)
      experiments: [
        {
          name: 'product-page-v2',
          description: 'New product page with AI recommendations',
          strategies: [
            // 1. Internal testers always get canary
            { type: 'whitelist', userIds: ['admin-1', 'admin-2', 'qa-1'] },
            // 2. Enterprise users get canary
            { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
            // 3. 10% of everyone else
            { type: 'percentage', percentage: 10 },
          ],
        },
      ],
    }),
  ],
  controllers: [ProductsController, AdminController],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly canaryManager: CanaryManager) {}

  async onModuleInit() {
    // If you need to create experiments programmatically on startup
    // instead of using the `experiments` option above:
    const existing = await this.canaryManager.getExperiment('product-page-v2');
    if (!existing) {
      await this.canaryManager.createExperiment('product-page-v2', [
        { type: 'whitelist', userIds: ['admin-1', 'admin-2', 'qa-1'] },
        { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
        { type: 'percentage', percentage: 10 },
      ], 'New product page with AI recommendations');
    }
  }
}
