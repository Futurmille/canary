import { CanaryManager } from '../../src/core/canary-manager';
import { InMemoryStorage } from '../../src/storage/in-memory';
import { CanaryMetricsCollector } from '../../src/core/metrics-collector';
import { canaryDashboard } from '../../src/dashboard';

function mockRes(): any {
  const data: { headers: Record<string, string>; body?: string; jsonBody?: any; statusCode: number } = {
    headers: {},
    statusCode: 200,
  };
  const res: any = {
    ...data,
    setHeader: (name: string, value: string) => { data.headers[name] = value; },
    status: (code: number) => { data.statusCode = code; return res; },
    json: (body: unknown) => { data.jsonBody = body; },
    end: (body: string) => { data.body = body; },
  };
  return { res, data };
}

describe('canaryDashboard', () => {
  let manager: CanaryManager;
  let metrics: CanaryMetricsCollector;
  let handler: ReturnType<typeof canaryDashboard>;

  beforeEach(async () => {
    const storage = new InMemoryStorage();
    manager = new CanaryManager({ storage });
    metrics = new CanaryMetricsCollector();
    handler = canaryDashboard(manager, metrics, { basePath: '/canary' });

    await manager.createExperiment('test-exp', [
      { type: 'whitelist', userIds: ['qa-1'] },
      { type: 'percentage', percentage: 10 },
    ], 'Test experiment');
  });

  it('serves HTML dashboard on GET /', async () => {
    const { res, data } = mockRes();
    const next = jest.fn();
    await handler({ url: '/canary', method: 'GET' }, res, next);

    expect(data.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(data.body).toContain('Canary Dashboard');
    expect(data.body).toContain('test-exp');
    expect(next).not.toHaveBeenCalled();
  });

  it('dashboard shows experiment strategies', async () => {
    const { res, data } = mockRes();
    await handler({ url: '/canary', method: 'GET' }, res, jest.fn());

    expect(data.body).toContain('whitelist (1)');
    expect(data.body).toContain('10% rollout');
  });

  it('dashboard shows metrics when available', async () => {
    for (let i = 0; i < 50; i++) {
      metrics.record({
        experiment: 'test-exp',
        variant: i < 25 ? 'stable' : 'canary',
        userId: `u-${i}`,
        endpoint: 'GET /test',
        responseTimeMs: 50,
        statusCode: 200,
        isError: false,
        timestamp: new Date().toISOString(),
      });
    }

    const { res, data } = mockRes();
    await handler({ url: '/canary', method: 'GET' }, res, jest.fn());

    expect(data.body).toContain('Stable');
    expect(data.body).toContain('Canary');
    expect(data.body).toContain('50.0ms');
  });

  it('serves JSON data on GET /api/data', async () => {
    const { res, data } = mockRes();
    await handler({ url: '/canary/api/data', method: 'GET' }, res, jest.fn());

    expect(data.jsonBody.experiments).toHaveLength(1);
    expect(data.jsonBody.experiments[0].name).toBe('test-exp');
    expect(data.jsonBody.reports['test-exp']).toBeDefined();
  });

  it('POST /api/:name/rollout increases percentage', async () => {
    const { res, data } = mockRes();
    await handler(
      { url: '/canary/api/test-exp/rollout', method: 'POST', body: { percentage: 50 } },
      res, jest.fn(),
    );

    expect(data.jsonBody.message).toContain('50%');

    const exp = await manager.getExperiment('test-exp');
    const pct = exp!.strategies.find((s) => s.type === 'percentage');
    expect(pct?.type === 'percentage' && pct.percentage).toBe(50);
  });

  it('POST /api/:name/rollback rolls back', async () => {
    const { res, data } = mockRes();
    await handler(
      { url: '/canary/api/test-exp/rollback', method: 'POST' },
      res, jest.fn(),
    );

    expect(data.jsonBody.message).toContain('Rolled back');

    const exp = await manager.getExperiment('test-exp');
    expect(exp!.enabled).toBe(false);
  });

  it('POST /api/:name/enable re-enables experiment', async () => {
    await manager.rollback('test-exp');

    const { res, data } = mockRes();
    await handler(
      { url: '/canary/api/test-exp/enable', method: 'POST' },
      res, jest.fn(),
    );

    expect(data.jsonBody.message).toContain('re-enabled');
    const exp = await manager.getExperiment('test-exp');
    expect(exp!.enabled).toBe(true);
  });

  it('DELETE /api/:name deletes experiment', async () => {
    const { res, data } = mockRes();
    await handler(
      { url: '/canary/api/test-exp', method: 'DELETE' },
      res, jest.fn(),
    );

    expect(data.jsonBody.message).toContain('deleted');
    expect(await manager.getExperiment('test-exp')).toBeNull();
  });

  it('returns 400 on invalid rollout', async () => {
    const { res, data } = mockRes();
    await handler(
      { url: '/canary/api/test-exp/rollout', method: 'POST', body: { percentage: 200 } },
      res, jest.fn(),
    );

    expect(data.statusCode).toBe(400);
    expect(data.jsonBody.error).toBeDefined();
  });

  it('calls next() for unknown paths', async () => {
    const next = jest.fn();
    await handler({ url: '/canary/api/unknown/path/here', method: 'GET' }, mockRes().res, next);
    expect(next).toHaveBeenCalled();
  });

  it('works with default basePath', async () => {
    const defaultHandler = canaryDashboard(manager, metrics);
    const { res, data } = mockRes();
    await defaultHandler({ url: '/canary', method: 'GET' }, res, jest.fn());

    expect(data.body).toContain('Canary Dashboard');
  });

  it('shows empty state when no experiments', async () => {
    await manager.deleteExperiment('test-exp');
    const { res, data } = mockRes();
    await handler({ url: '/canary', method: 'GET' }, res, jest.fn());

    expect(data.body).toContain('No experiments found');
  });
});
