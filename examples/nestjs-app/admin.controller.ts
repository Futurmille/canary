import { Controller, Get, Post, Param, Body, HttpException, HttpStatus } from '@nestjs/common';
import { CanaryManager } from '@canary-node/core';

/**
 * Admin controller for managing canary experiments at runtime.
 *
 * In production, protect these endpoints with an auth guard!
 */
@Controller('admin/canary')
export class AdminController {
  constructor(private readonly canaryManager: CanaryManager) {}

  /** List all experiments and their current config */
  @Get('experiments')
  async listExperiments() {
    const experiments = await this.canaryManager.listExperiments();
    return { experiments };
  }

  /** Get a single experiment by name */
  @Get('experiments/:name')
  async getExperiment(@Param('name') name: string) {
    const experiment = await this.canaryManager.getExperiment(name);
    if (!experiment) {
      throw new HttpException(`Experiment "${name}" not found`, HttpStatus.NOT_FOUND);
    }
    return { experiment };
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
