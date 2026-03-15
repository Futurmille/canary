import { CanaryManager } from '../../core/canary-manager';
import { CanaryUser, Variant } from '../../types';

/**
 * Minimal Hono types — no dependency on hono package.
 * Works with Hono on Cloudflare Workers, Vercel Edge, Deno, Bun, and Node.js.
 */
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
  /** The experiment to evaluate */
  experimentName: string;
  /** Extract a CanaryUser from the Hono context */
  getUserFromContext: (c: HonoContext) => CanaryUser | null;
  /** Set X-Canary-Variant response header (default: true) */
  setHeader?: boolean;
}

/**
 * Hono middleware that resolves a canary variant for every request.
 *
 * The variant is stored in the Hono context via c.set('canaryVariant', variant)
 * and can be retrieved in handlers via c.get('canaryVariant').
 *
 * Works on all Hono runtimes: Cloudflare Workers, Vercel Edge, Deno, Bun, Node.js.
 *
 * Usage:
 * ```ts
 * import { Hono } from 'hono';
 * import { CanaryManager, InMemoryStorage, canaryHonoMiddleware } from '@ebutrera9103/canary-node';
 *
 * const app = new Hono();
 * const manager = new CanaryManager({ storage: new InMemoryStorage() });
 *
 * app.use('*', canaryHonoMiddleware(manager, {
 *   experimentName: 'checkout-v2',
 *   getUserFromContext: (c) => {
 *     const userId = c.req.header('x-user-id');
 *     if (!userId) return null;
 *     return { id: userId, attributes: { plan: c.req.header('x-user-plan') || 'free' } };
 *   },
 * }));
 *
 * app.get('/products/:id', (c) => {
 *   const variant = c.get('canaryVariant');
 *   if (variant === 'canary') {
 *     return c.json({ name: 'Laptop', reviews: {...} });
 *   }
 *   return c.json({ name: 'Laptop' });
 * });
 * ```
 */
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

/**
 * Hono middleware that blocks non-canary users (returns 404).
 * Use for routes that should only be visible to canary users.
 */
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
      if (variant !== 'canary') {
        return c.json({ error: 'Not found' }, 404);
      }

      c.set('canaryVariant', variant);
      await next();
    } catch {
      return c.json({ error: 'Not found' }, 404);
    }
  };
}
