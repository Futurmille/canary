import { CanaryManager } from '../../core/canary-manager';
import { CanaryUser, Variant } from '../../types';

interface HonoContext {
  req: {
    header(name: string): string | undefined;
    url: string;
    method: string;
    raw: Request;
  };
  header(name: string, value: string): void;
  set(key: string, value: unknown): void;
  get(key: string): unknown;
  json(data: unknown, status?: number): Response;
}

type HonoNext = () => Promise<void>;
type HonoMiddleware = (c: HonoContext, next: HonoNext) => Promise<void | Response>;

export interface CanaryHonoMiddlewareOptions {
  experimentName: string;
  getUserFromContext: (c: HonoContext) => CanaryUser | null;
  setHeader?: boolean;
}

export function canaryHonoMiddleware(
  manager: CanaryManager,
  options: CanaryHonoMiddlewareOptions,
): HonoMiddleware {
  const { getUserFromContext, experimentName, setHeader = true } = options;

  return async (c: HonoContext, next: HonoNext) => {
    try {
      const user = getUserFromContext(c);
      let variant: Variant = 'stable';

      if (user) {
        variant = await manager.getVariant(user, experimentName);
      }

      c.set('canaryVariant', variant);

      if (setHeader) {
        c.header('X-Canary-Variant', variant);
      }
    } catch {
      c.set('canaryVariant', 'stable');
    }

    await next();
  };
}

/** Returns 404 for stable users — the route doesn't exist for them. */
export function canaryHonoGuard(
  manager: CanaryManager,
  options: Omit<CanaryHonoMiddlewareOptions, 'setHeader'>,
): HonoMiddleware {
  const { getUserFromContext, experimentName } = options;

  return async (c: HonoContext, next: HonoNext) => {
    try {
      const user = getUserFromContext(c);
      if (!user) {
        return c.json({ error: 'Not found' }, 404);
      }

      const variant = await manager.getVariant(user, experimentName);
      if (variant === 'stable') {
        return c.json({ error: 'Not found' }, 404);
      }

      c.set('canaryVariant', variant);
      await next();
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  };
}
