import { CanaryManager } from '../core/canary-manager';
import { CanaryMetricsCollector } from '../core/metrics-collector';
import { renderDashboard } from './html';

interface Request {
  url?: string;
  method?: string;
  params?: Record<string, string>;
  body?: any;
  [key: string]: unknown;
}

interface Response {
  setHeader(name: string, value: string): void;
  status(code: number): Response;
  json(body: unknown): void;
  end(body: string): void;
  [key: string]: unknown;
}

type NextFunction = (err?: unknown) => void;
type Handler = (req: Request, res: Response, next: NextFunction) => void;

export interface DashboardOptions {
  /** Base path where the dashboard is mounted (default: '/canary') */
  basePath?: string;
}

/**
 * Creates an Express-compatible router that serves the canary dashboard
 * and its API endpoints. Mount it on any path:
 *
 * ```ts
 * app.use('/canary', canaryDashboard(manager, metrics));
 * ```
 *
 * Endpoints served:
 * - GET /              → HTML dashboard
 * - GET /api/data      → JSON data for the dashboard
 * - POST /api/:name/rollout   → { percentage: number }
 * - POST /api/:name/rollback
 * - POST /api/:name/enable
 * - DELETE /api/:name
 */
export function canaryDashboard(
  manager: CanaryManager,
  metrics: CanaryMetricsCollector,
  options?: DashboardOptions,
): Handler {
  const basePath = (options?.basePath ?? '/canary').replace(/\/$/, '');

  return async (req: Request, res: Response, next: NextFunction) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Normalize: strip basePath prefix if present
    const path = url.startsWith(basePath) ? url.slice(basePath.length) || '/' : url;

    try {
      // GET / → Dashboard HTML
      if (method === 'GET' && (path === '/' || path === '')) {
        const experiments = await manager.listExperiments();
        const reports: Record<string, any> = {};
        for (const exp of experiments) {
          reports[exp.name] = metrics.compare(exp.name);
        }

        const html = renderDashboard({
          experiments,
          reports,
          apiBasePath: basePath + '/api',
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(html);
        return;
      }

      // GET /api/data → JSON data
      if (method === 'GET' && path === '/api/data') {
        const experiments = await manager.listExperiments();
        const reports: Record<string, any> = {};
        for (const exp of experiments) {
          reports[exp.name] = metrics.compare(exp.name);
        }
        res.json({ experiments, reports });
        return;
      }

      // Extract experiment name from /api/:name/action
      const apiMatch = path.match(/^\/api\/([^/]+)(?:\/(.+))?$/);
      if (!apiMatch) {
        next();
        return;
      }

      const expName = decodeURIComponent(apiMatch[1]);
      const action = apiMatch[2] ?? '';

      // POST /api/:name/rollout
      if (method === 'POST' && action === 'rollout') {
        const body = req.body ?? {};
        const percentage = typeof body.percentage === 'number' ? body.percentage : parseInt(body.percentage, 10);
        const updated = await manager.increaseRollout(expName, percentage);
        res.json({ message: `Rollout updated to ${percentage}%`, experiment: updated });
        return;
      }

      // POST /api/:name/rollback
      if (method === 'POST' && action === 'rollback') {
        await manager.rollback(expName);
        metrics.clear(expName);
        res.json({ message: `Rolled back "${expName}". All users now see stable.` });
        return;
      }

      // POST /api/:name/enable
      if (method === 'POST' && action === 'enable') {
        const updated = await manager.updateExperiment(expName, { enabled: true });
        res.json({ message: `Experiment "${expName}" re-enabled`, experiment: updated });
        return;
      }

      // DELETE /api/:name
      if (method === 'DELETE' && !action) {
        await manager.deleteExperiment(expName);
        metrics.clear(expName);
        res.json({ message: `Experiment "${expName}" deleted` });
        return;
      }

      next();
    } catch (err: any) {
      res.status(400).json({ error: err.message ?? 'Unknown error' });
    }
  };
}
