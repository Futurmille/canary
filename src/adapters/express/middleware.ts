import { CanaryManager } from '../../core/canary-manager';
import { CanaryUser, Variant } from '../../types';

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
  getUserFromRequest: (req: Request) => CanaryUser | null;
  experimentName: string;
  requestProperty?: string;
  setHeader?: boolean;
}

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
    } catch {
      req[requestProperty] = 'stable';
      next();
    }
  };
}

export function canaryGuard(
  manager: CanaryManager,
  options: Omit<CanaryMiddlewareOptions, 'requestProperty' | 'setHeader'>,
) {
  const { getUserFromRequest, experimentName } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = getUserFromRequest(req);
      if (!user) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      const variant = await manager.getVariant(user, experimentName);
      if (variant === 'stable') {
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
