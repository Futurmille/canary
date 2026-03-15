import { CanaryMetricsCollector } from '../../src/core/metrics-collector';
import { canaryMetricsMiddleware } from '../../src/adapters/express/metrics-middleware';

describe('canaryMetricsMiddleware', () => {
  let collector: CanaryMetricsCollector;

  beforeEach(() => {
    collector = new CanaryMetricsCollector();
  });

  function mockReq(variant?: string, userId?: string): any {
    return {
      canaryVariant: variant,
      url: '/products/1',
      method: 'GET',
      headers: { 'x-user-id': userId },
    };
  }

  function mockRes(): any {
    const listeners: Record<string, Function[]> = {};
    return {
      statusCode: 200,
      on: (event: string, cb: Function) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
      },
      emit: (event: string) => {
        (listeners[event] ?? []).forEach((cb) => cb());
      },
    };
  }

  it('records a metric when canaryVariant is set', (done) => {
    const mw = canaryMetricsMiddleware(collector, { experimentName: 'checkout-v2' });
    const req = mockReq('canary', 'user-1');
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate response finishing
    res.emit('finish');

    const report = collector.compare('checkout-v2');
    expect(report.canary.totalRequests).toBe(1);
    done();
  });

  it('skips recording when no canaryVariant is set', () => {
    const mw = canaryMetricsMiddleware(collector, { experimentName: 'checkout-v2' });
    const req = mockReq(); // no variant
    const res = mockRes();
    const next = jest.fn();

    mw(req, res, next);
    expect(next).toHaveBeenCalled();

    const report = collector.compare('checkout-v2');
    expect(report.stable.totalRequests).toBe(0);
  });

  it('records error status codes', () => {
    const mw = canaryMetricsMiddleware(collector, { experimentName: 'checkout-v2' });
    const req = mockReq('canary', 'user-1');
    const res = mockRes();
    res.statusCode = 500;
    const next = jest.fn();

    mw(req, res, next);
    res.emit('finish');

    const report = collector.compare('checkout-v2');
    expect(report.canary.errorCount).toBe(1);
  });

  it('uses custom getUserId', () => {
    const mw = canaryMetricsMiddleware(collector, {
      experimentName: 'checkout-v2',
      getUserId: (req) => (req as any).customId ?? 'fallback',
    });
    const req = { ...mockReq('stable'), customId: 'custom-123' };
    const res = mockRes();

    mw(req, res, jest.fn());
    res.emit('finish');

    const report = collector.compare('checkout-v2');
    expect(report.stable.uniqueUsers).toBe(1);
  });

  it('handles missing method and url', () => {
    const onMetric = jest.fn();
    const c = new CanaryMetricsCollector({ onMetric });
    const mw = canaryMetricsMiddleware(c, { experimentName: 'checkout-v2' });
    const req: any = {
      canaryVariant: 'stable',
      headers: {},
      // no method, no url
    };
    const res = mockRes();
    mw(req, res, jest.fn());
    res.emit('finish');
    expect(onMetric).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'GET /' }),
    );
  });

  it('defaults userId to anonymous when no header', () => {
    const mw = canaryMetricsMiddleware(collector, { experimentName: 'checkout-v2' });
    const req = mockReq('stable'); // no userId
    const res = mockRes();

    mw(req, res, jest.fn());
    res.emit('finish');

    const report = collector.compare('checkout-v2');
    expect(report.stable.totalRequests).toBe(1);
  });

  it('records correct endpoint format', () => {
    const onMetric = jest.fn();
    const c = new CanaryMetricsCollector({ onMetric });
    const mw = canaryMetricsMiddleware(c, { experimentName: 'checkout-v2' });
    const req = mockReq('stable', 'u1');
    const res = mockRes();

    mw(req, res, jest.fn());
    res.emit('finish');

    expect(onMetric).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'GET /products/1' }),
    );
  });
});
