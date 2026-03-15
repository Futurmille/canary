/**
 * NestJS + @futurmille/canary-node — Real-world canary release example
 *
 * This app demonstrates:
 * - CanaryModule.forRoot() with automatic experiment creation
 * - @CanaryExperiment() decorator on controller methods
 * - CanaryGuard resolved from DI (no manual instantiation)
 * - Admin controller for managing experiments at runtime
 * - Gradual rollout and instant rollback
 *
 * Run:
 *   cd examples/nestjs-app
 *   npm install
 *   npm start
 *
 * Test:
 *   # Stable user
 *   curl http://localhost:3000/products/1 -H "x-user-id: user-42"
 *
 *   # Canary user (whitelisted)
 *   curl http://localhost:3000/products/1 -H "x-user-id: admin-1"
 *
 *   # Enterprise user → canary
 *   curl http://localhost:3000/products/1 -H "x-user-id: corp" -H "x-user-plan: enterprise"
 *
 *   # Admin: list experiments
 *   curl http://localhost:3000/admin/canary/experiments
 *
 *   # Admin: increase rollout to 50%
 *   curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollout \
 *     -d '{"percentage":50}' -H "Content-Type: application/json"
 *
 *   # Admin: instant rollback
 *   curl -X POST http://localhost:3000/admin/canary/product-page-v2/rollback
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);

  console.log('NestJS canary example running on http://localhost:3000');
  console.log('');
  console.log('Try these requests:');
  console.log('  curl http://localhost:3000/products/1 -H "x-user-id: admin-1"        # canary (whitelist)');
  console.log('  curl http://localhost:3000/products/1 -H "x-user-id: user-42"         # stable (10% chance)');
  console.log('  curl http://localhost:3000/products/1 -H "x-user-id: corp" -H "x-user-plan: enterprise"  # canary');
  console.log('  curl http://localhost:3000/admin/canary/experiments                    # list experiments');
}

bootstrap().catch(console.error);
