import { CanaryManager } from '../../core/canary-manager';
import { CanaryUser, Variant } from '../../types';

/**
 * Minimal types for Express compatibility — no dependency on @types/express.
 * Any framework that provides req/res/next will work.
 */
interface Request {
  headers: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

interface Response {
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): void;
  [key: string]: unknown;
}

type NextFunction = (err?: unknown) => void;

export interface CanaryMiddlewareOptions {
  /** Extract a CanaryUser from the request. */
  getUserFromRequest: (req: Request) => CanaryUser | null;
  /** Experiment name to evaluate */
  experimentName: string;
  /** Property name to attach the variant to req (default: "canaryVariant") */
  requestProperty?: string;
  /** Also set an X-Canary-Variant response header (default: true) */
  setHeader?: boolean;
}

/**
 * Express-compatible middleware that resolves a canary variant and
 * attaches it to `req[requestProperty]`.
 *
 * Works with Express 4/5, Fastify (via fastify-express), and any
 * Connect-compatible middleware pipeline.
 */
export function canaryMiddleware(
  manager: CanaryManager,
  options: CanaryMiddlewareOptions,
) {
  const {
    getUserFromRequest,
    experimentName,
    requestProperty = 'canaryVariant',
    setHeader = true,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = getUserFromRequest(req);
      let variant: Variant = 'stable';

      if (user) {
        variant = await manager.getVariant(user, experimentName);
      }

      req[requestProperty] = variant;

      if (setHeader) {
        res.setHeader('X-Canary-Variant', variant);
      }

      next();
    } catch (err) {
      // Graceful degradation — never block the request pipeline
      req[requestProperty] = 'stable';
      next();
    }
  };
}

/**
 * Route-level guard that only allows canary users through.
 * Returns 404 for stable users (feature doesn't exist for them).
 */
export function canaryGuard(
  manager: CanaryManager,
  options: Omit<CanaryMiddlewareOptions, 'requestProperty' | 'setHeader'>,
) {
  const { getUserFromRequest, experimentName } = options;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const user = getUserFromRequest(req);
      if (!user) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const variant = await manager.getVariant(user, experimentName);
      if (variant !== 'canary') {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      req['canaryVariant'] = variant;
      next();
    } catch {
      res.status(404).json({ error: 'Not found' });
    }
  };
}
