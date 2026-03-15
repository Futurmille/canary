/**
 * NestJS example — canary release with decorator-based guards.
 *
 * This shows the pattern — paste into a real NestJS app.
 */

// ── In your module ──────────────────────────────────────────

/*
import { Module } from '@nestjs/common';
import { CanaryManager, InMemoryStorage } from '@canary-node/core';

// Provide CanaryManager as a singleton
@Module({
  providers: [
    {
      provide: CanaryManager,
      useFactory: () => {
        return new CanaryManager({
          storage: new InMemoryStorage(), // swap to RedisStorage in prod
          hooks: {
            onAssignment: (e) => console.log(`[canary] ${e.user.id} → ${e.variant}`),
          },
        });
      },
    },
  ],
  exports: [CanaryManager],
})
export class CanaryModule {}
*/

// ── In your controller ──────────────────────────────────────

/*
import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { CanaryManager } from '@canary-node/core';
import { CanaryGuard, CanaryExperiment } from '@canary-node/core';

@Controller('search')
export class SearchController {
  constructor(private canaryManager: CanaryManager) {}

  @UseGuards(
    new CanaryGuard(canaryManager, {
      getUserFromRequest: (req) => {
        const user = req['user'] as { id: string; plan: string };
        return user ? { id: user.id, attributes: { plan: user.plan } } : null;
      },
    }),
  )
  @CanaryExperiment('search-v2')
  @Get()
  search(@Req() req: any) {
    if (req.canaryVariant === 'canary') {
      return { engine: 'v2', results: [] };
    }
    return { engine: 'v1', results: [] };
  }
}
*/

// ── In your bootstrap ───────────────────────────────────────

/*
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const canary = app.get(CanaryManager);

  // Create experiments on startup
  await canary.createExperiment('search-v2', [
    { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
    { type: 'percentage', percentage: 5 },
  ]);

  await app.listen(3000);
}
bootstrap();
*/

export {}; // Make this a module
