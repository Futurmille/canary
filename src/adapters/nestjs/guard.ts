import { CanaryManager } from '../../core/canary-manager';
import { CanaryUser, Variant } from '../../types';
import { CANARY_EXPERIMENT_KEY } from './decorators';

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
  getUserFromRequest: (req: Record<string, unknown>) => CanaryUser | null;
  denyStable?: boolean;
}

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

  setOptions(options: CanaryGuardOptions): void {
    this.options = options;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const experimentName = Reflect.getMetadata(CANARY_EXPERIMENT_KEY, handler);

    if (!experimentName) {
      return true;
    }

    const req = context.switchToHttp().getRequest();

    let user: CanaryUser | null = null;
    try {
      user = this.options.getUserFromRequest(req);
    } catch {
      // fall through to stable
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

    if (this.options.denyStable && variant === 'stable') {
      return false;
    }

    return true;
  }
}
