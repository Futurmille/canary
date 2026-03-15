import { CanaryManager } from '../../core/canary-manager';
import { CanaryUser, Variant } from '../../types';
import { CANARY_EXPERIMENT_KEY } from './decorators';

/**
 * Minimal NestJS interfaces — avoids requiring @nestjs/common as a dependency.
 * The consumer's NestJS version will satisfy these at runtime.
 */
interface ExecutionContext {
  switchToHttp(): {
    getRequest(): Record<string, unknown>;
    getResponse(): Record<string, unknown>;
  };
  getHandler(): Function;
}

interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

export interface CanaryGuardOptions {
  /** Extract a CanaryUser from the NestJS request */
  getUserFromRequest: (req: Record<string, unknown>) => CanaryUser | null;
  /** If true, deny access to non-canary users (returns 403). Default: false */
  denyStable?: boolean;
}

/**
 * NestJS guard that resolves the canary variant before the handler executes.
 *
 * Reads the experiment name from @CanaryExperiment() metadata,
 * resolves the variant, and attaches it to req.canaryVariant.
 *
 * Usage:
 * ```ts
 * @UseGuards(new CanaryGuard(canaryManager, { getUserFromRequest: ... }))
 * @CanaryExperiment('new-search')
 * @Get('/search')
 * search(@Req() req) { req.canaryVariant }
 * ```
 */
export class CanaryGuard implements CanActivate {
  constructor(
    private manager: CanaryManager,
    private options: CanaryGuardOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const experimentName = Reflect.getMetadata(
      CANARY_EXPERIMENT_KEY,
      handler,
    );

    if (!experimentName) {
      // No experiment configured — allow through
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const user = this.options.getUserFromRequest(req);

    let variant: Variant = 'stable';

    if (user) {
      try {
        variant = await this.manager.getVariant(user, experimentName as string);
      } catch {
        variant = 'stable';
      }
    }

    req['canaryVariant'] = variant;

    if (this.options.denyStable && variant !== 'canary') {
      return false;
    }

    return true;
  }
}
