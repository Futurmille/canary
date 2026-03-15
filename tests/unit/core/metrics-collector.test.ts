import { CanaryMetricsCollector, MetricRecord } from '../../../src/core/metrics-collector';

describe('CanaryMetricsCollector', () => {
  let collector: CanaryMetricsCollector;

  beforeEach(() => {
    collector = new CanaryMetricsCollector();
  });

  function makeRecord(overrides: Partial<MetricRecord> = {}): MetricRecord {
    return {
      experiment: 'checkout-v2',
      variant: 'stable',
      userId: 'user-1',
      endpoint: 'GET /products/1',
      responseTimeMs: 50,
      statusCode: 200,
      isError: false,
      timestamp: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  describe('record', () => {
    it('stores a metric record', () => {
      collector.record(makeRecord());
      const report = collector.compare('checkout-v2');
      expect(report.stable.totalRequests).toBe(1);
    });

    it('fires onMetric callback', () => {
      const onMetric = jest.fn();
      const c = new CanaryMetricsCollector({ onMetric });
      const record = makeRecord();
      c.record(record);
      expect(onMetric).toHaveBeenCalledWith(record);
    });

    it('onMetric errors do not propagate', () => {
      const c = new CanaryMetricsCollector({
        onMetric: () => { throw new Error('boom'); },
      });
      expect(() => c.record(makeRecord())).not.toThrow();
    });

    it('evicts oldest records when over limit', () => {
      const c = new CanaryMetricsCollector({ maxRecordsPerExperiment: 5 });
      for (let i = 0; i < 10; i++) {
        c.record(makeRecord({ userId: `user-${i}` }));
      }
      const report = c.compare('checkout-v2');
      expect(report.stable.totalRequests).toBe(5);
      expect(report.stable.uniqueUsers).toBe(5);
    });
  });

  describe('compare', () => {
    it('returns insufficient-data when fewer than 30 records per variant', () => {
      for (let i = 0; i < 10; i++) {
        collector.record(makeRecord({ variant: 'stable', userId: `u-${i}` }));
        collector.record(makeRecord({ variant: 'canary', userId: `u-${i}` }));
      }
      const report = collector.compare('checkout-v2');
      expect(report.verdict).toBe('insufficient-data');
    });

    it('computes correct stats with enough data', () => {
      // 50 stable requests: 50ms avg, 0 errors
      for (let i = 0; i < 50; i++) {
        collector.record(makeRecord({
          variant: 'stable',
          userId: `user-${i}`,
          responseTimeMs: 50,
          statusCode: 200,
          isError: false,
        }));
      }
      // 50 canary requests: 20ms avg, 0 errors (canary is much faster)
      for (let i = 0; i < 50; i++) {
        collector.record(makeRecord({
          variant: 'canary',
          userId: `user-${i}`,
          responseTimeMs: 20,
          statusCode: 200,
          isError: false,
        }));
      }

      const report = collector.compare('checkout-v2');

      expect(report.stable.totalRequests).toBe(50);
      expect(report.canary.totalRequests).toBe(50);
      expect(report.stable.avgResponseTimeMs).toBe(50);
      expect(report.canary.avgResponseTimeMs).toBe(20);
      expect(report.stable.errorRate).toBe(0);
      expect(report.canary.errorRate).toBe(0);
      expect(report.responseTimeDiffMs).toBe(-30); // canary 30ms faster
      expect(report.verdict).toBe('canary-is-better');
    });

    it('detects canary-is-worse when error rate spikes', () => {
      for (let i = 0; i < 50; i++) {
        collector.record(makeRecord({ variant: 'stable', userId: `u-${i}` }));
      }
      // Canary has 10% errors
      for (let i = 0; i < 45; i++) {
        collector.record(makeRecord({ variant: 'canary', userId: `u-${i}` }));
      }
      for (let i = 45; i < 50; i++) {
        collector.record(makeRecord({
          variant: 'canary',
          userId: `u-${i}`,
          statusCode: 500,
          isError: true,
        }));
      }

      const report = collector.compare('checkout-v2');
      expect(report.canary.errorRate).toBe(10);
      expect(report.verdict).toBe('canary-is-worse');
    });

    it('detects canary-is-worse when p95 is 1.5x worse', () => {
      for (let i = 0; i < 50; i++) {
        collector.record(makeRecord({
          variant: 'stable',
          userId: `u-${i}`,
          responseTimeMs: 50,
        }));
      }
      // Canary is much slower
      for (let i = 0; i < 50; i++) {
        collector.record(makeRecord({
          variant: 'canary',
          userId: `u-${i}`,
          responseTimeMs: 200,
        }));
      }

      const report = collector.compare('checkout-v2');
      expect(report.verdict).toBe('canary-is-worse');
    });

    it('returns no-significant-difference when metrics are close', () => {
      for (let i = 0; i < 50; i++) {
        collector.record(makeRecord({
          variant: 'stable',
          userId: `u-${i}`,
          responseTimeMs: 50,
        }));
        collector.record(makeRecord({
          variant: 'canary',
          userId: `u-${i}`,
          responseTimeMs: 51, // nearly identical
        }));
      }

      const report = collector.compare('checkout-v2');
      expect(report.verdict).toBe('no-significant-difference');
    });

    it('detects canary-is-better when canary has lower error rate', () => {
      // Stable: 5% error rate
      for (let i = 0; i < 47; i++) {
        collector.record(makeRecord({ variant: 'stable', userId: `u-${i}` }));
      }
      for (let i = 47; i < 50; i++) {
        collector.record(makeRecord({
          variant: 'stable',
          userId: `u-${i}`,
          statusCode: 500,
          isError: true,
        }));
      }
      // Canary: 0% error rate
      for (let i = 0; i < 50; i++) {
        collector.record(makeRecord({ variant: 'canary', userId: `u-${i}` }));
      }

      const report = collector.compare('checkout-v2');
      expect(report.verdict).toBe('canary-is-better');
    });

    it('handles empty experiment', () => {
      const report = collector.compare('nonexistent');
      expect(report.stable.totalRequests).toBe(0);
      expect(report.canary.totalRequests).toBe(0);
      expect(report.verdict).toBe('insufficient-data');
    });

    it('computes percentiles correctly', () => {
      // Insert response times: 10, 20, 30, ..., 500 (50 values)
      for (let i = 1; i <= 50; i++) {
        collector.record(makeRecord({
          variant: 'stable',
          userId: `u-${i}`,
          responseTimeMs: i * 10,
        }));
      }
      // Need canary too to avoid insufficient-data
      for (let i = 1; i <= 50; i++) {
        collector.record(makeRecord({
          variant: 'canary',
          userId: `u-${i}`,
          responseTimeMs: i * 10,
        }));
      }

      const report = collector.compare('checkout-v2');
      expect(report.stable.p50ResponseTimeMs).toBe(250);
      expect(report.stable.p95ResponseTimeMs).toBe(480);
      expect(report.stable.p99ResponseTimeMs).toBe(500);
      expect(report.stable.uniqueUsers).toBe(50);
    });
  });

  describe('getExperiments', () => {
    it('returns all experiments with recorded data', () => {
      collector.record(makeRecord({ experiment: 'exp-a' }));
      collector.record(makeRecord({ experiment: 'exp-b' }));
      expect(collector.getExperiments().sort()).toEqual(['exp-a', 'exp-b']);
    });
  });

  describe('clear', () => {
    it('clears records for a specific experiment', () => {
      collector.record(makeRecord({ experiment: 'exp-a' }));
      collector.record(makeRecord({ experiment: 'exp-b' }));
      collector.clear('exp-a');
      expect(collector.getExperiments()).toEqual(['exp-b']);
    });
  });

  describe('clearAll', () => {
    it('clears all records', () => {
      collector.record(makeRecord({ experiment: 'exp-a' }));
      collector.record(makeRecord({ experiment: 'exp-b' }));
      collector.clearAll();
      expect(collector.getExperiments()).toEqual([]);
    });
  });
});
