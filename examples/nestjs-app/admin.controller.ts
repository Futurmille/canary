import { Controller, Get, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { CanaryManager, CanaryMetricsCollector } from '@futurmille/canary';

/**
 * Admin controller for managing canary experiments at runtime.
 *
 * Provides endpoints for:
 * - Listing experiments and their configs
 * - Comparing performance between stable and canary (metrics)
 * - Increasing rollout percentage
 * - Instant rollback
 *
 * In production, protect these endpoints with an auth guard!
 */
@Controller('admin/canary')
export class AdminController {
  private metrics = new CanaryMetricsCollector();

  constructor(private readonly canaryManager: CanaryManager) {}

  /** Get the metrics collector (for wiring with middleware/interceptor) */
  getMetricsCollector(): CanaryMetricsCollector {
    return this.metrics;
  }

  /** List all experiments and their current config */
  @Get('experiments')
  async listExperiments() {
    return { experiments: await this.canaryManager.listExperiments() };
  }

  /**
   * Compare performance between stable and canary.
   *
   * Returns:
   * - Response time stats (avg, p50, p95, p99) per variant
   * - Error rates per variant
   * - A verdict: 'canary-is-better' | 'canary-is-worse' | 'no-significant-difference'
   *
   * GET /admin/canary/:name/metrics
   */
  @Get(':name/metrics')
  getMetrics(@Param('name') name: string) {
    return this.metrics.compare(name);
  }

  /**
   * Increase the canary rollout percentage.
   * Existing canary users stay canary — this only adds new users.
   *
   * POST /admin/canary/:name/rollout
   * Body: { "percentage": 50 }
   */
  @Post(':name/rollout')
  async increaseRollout(
    @Param('name') name: string,
    @Body() body: { percentage: number },
  ) {
    try {
      const updated = await this.canaryManager.increaseRollout(name, body.percentage);
      return {
        message: `Rollout updated to ${body.percentage}%`,
        experiment: updated,
      };
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Instant rollback — clear all assignments and disable the experiment.
   * All users immediately see the stable variant. No redeployment needed.
   *
   * POST /admin/canary/:name/rollback
   */
  @Post(':name/rollback')
  async rollback(@Param('name') name: string) {
    await this.canaryManager.rollback(name);
    this.metrics.clear(name);
    return { message: `Rolled back "${name}". All users now see stable.` };
  }

  /**
   * Re-enable an experiment after a rollback.
   *
   * POST /admin/canary/:name/enable
   */
  @Post(':name/enable')
  async enable(@Param('name') name: string) {
    try {
      const updated = await this.canaryManager.updateExperiment(name, { enabled: true });
      return { message: `Experiment "${name}" re-enabled`, experiment: updated };
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }
}
