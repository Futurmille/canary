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
 * ## Usage with CanaryModule (recommended)
 *
 * When using CanaryModule.forRoot(), the guard is pre-configured and available via DI:
 *
 * ```ts
 * @Controller('products')
 * @UseGuards(CanaryGuard) // ← no `new`, no args — resolved from DI
 * export class ProductsController {
 *
 *   @CanaryExperiment('new-product-page')
 *   @Get(':id')
 *   getProduct(@Req() req) {
 *     return req.canaryVariant === 'canary' ? ... : ...;
 *   }
 * }
 * ```
 *
 * ## Standalone usage (without module)
 *
 * ```ts
 * const guard = new CanaryGuard(manager, { getUserFromRequest: ... });
 * ```
 */
export class CanaryGuard implements CanActivate {
  private manager: CanaryManager;
  private options: CanaryGuardOptions;

  constructor(manager: CanaryManager, options: CanaryGuardOptions);
  constructor(manager: CanaryManager);
  constructor(manager: CanaryManager, options?: CanaryGuardOptions) {
    this.manager = manager;
    this.options = options ?? {
      getUserFromRequest: () => null,
    };
  }

  /** Allow setting options after construction (used by CanaryModule DI wiring) */
  setOptions(options: CanaryGuardOptions): void {
    this.options = options;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const experimentName = Reflect.getMetadata(
      CANARY_EXPERIMENT_KEY,
      handler,
    );

    if (!experimentName) {
      // No @CanaryExperiment decorator — allow through, no variant set
      return true;
    }

    const req = context.switchToHttp().getRequest();

    let user: CanaryUser | null = null;
    try {
      user = this.options.getUserFromRequest(req);
    } catch {
      // If user extraction fails, fall through to stable
    }

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
