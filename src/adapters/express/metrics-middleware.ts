import { CanaryMetricsCollector } from '../../core/metrics-collector';
import { Variant } from '../../types';

interface Request {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

interface Response {
  statusCode: number;
  on(event: string, listener: () => void): void;
  [key: string]: unknown;
}

type NextFunction = (err?: unknown) => void;

export interface MetricsMiddlewareOptions {
  experimentName: string;
  getUserId?: (req: Request) => string;
}

/** Place AFTER canaryMiddleware. Records response time and errors per variant. */
export function canaryMetricsMiddleware(
  collector: CanaryMetricsCollector,
  options: MetricsMiddlewareOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  const { experimentName } = options;
  const getUserId = options.getUserId ?? ((req: Request) => {
    const header = req.headers['x-user-id'];
    return (typeof header === 'string' ? header : undefined) ?? 'anonymous';
  });

  return (req: Request, res: Response, next: NextFunction) => {
    const variant = req['canaryVariant'] as Variant | undefined;
    if (!variant) {
      next();
      return;
    }

    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;

      collector.record({
        experiment: experimentName,
        variant,
        userId: getUserId(req),
        endpoint: `${req.method ?? 'GET'} ${req.url ?? '/'}`,
        responseTimeMs: Math.round(elapsed * 100) / 100,
        statusCode: res.statusCode,
        isError: res.statusCode >= 400,
        timestamp: new Date().toISOString(),
      });
    });

    next();
  };
}
