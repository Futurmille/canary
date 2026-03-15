/**
 * Example: CanaryModule.forRootAsync() — for production setups
 * where you need to inject ConfigService, Redis connections, etc.
 *
 * This file is NOT imported by the runnable example (app.module.ts).
 * It shows how you'd configure canary in a real production NestJS app.
 */

import { Module } from '@nestjs/common';
// import { ConfigModule, ConfigService } from '@nestjs/config';
// import Redis from 'ioredis';
// import { CanaryModule, RedisStorage } from '@canary-node/core';

/*
@Module({
  imports: [
    ConfigModule.forRoot(),

    CanaryModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Create Redis client from environment
        const redisClient = new Redis({
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD'),
          // Reconnect strategy for production resilience
          retryStrategy: (times) => Math.min(times * 50, 2000),
        });

        return {
          // Production storage with Redis
          storage: new RedisStorage({
            client: redisClient,
            prefix: `${config.get('APP_NAME', 'myapp')}:canary:`,
          }),

          // Extract user from JWT/Passport
          getUserFromRequest: (req) => {
            const user = req['user'] as any; // populated by AuthGuard
            if (!user) return null;
            return {
              id: user.sub,
              attributes: {
                plan: user.plan,
                role: user.role,
                country: user.country,
              },
            };
          },

          // Wire observability to your metrics system
          hooks: {
            onAssignment: (event) => {
              // Send to Datadog / Prometheus / CloudWatch
              // metrics.increment('canary.assignment', { tags: { ... } });
            },
            onExposure: (event) => {
              // Send to Amplitude / Mixpanel / Segment
              // analytics.track('canary_exposure', { ... });
            },
            onRollback: (event) => {
              // Send to PagerDuty / Slack / OpsGenie
              // alerting.send(`Canary rollback: ${event.experiment}`);
            },
          },
        };
      },
    }),
  ],
})
export class AppModule {}
*/

export {};
