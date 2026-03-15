import { Variant } from '../types';

export interface MetricRecord {
  experiment: string;
  variant: Variant;
  userId: string;
  endpoint: string;
  responseTimeMs: number;
  statusCode: number;
  isError: boolean;
  timestamp: string;
}

export interface VariantStats {
  variant: Variant;
  totalRequests: number;
  errorCount: number;
  errorRate: number;
  avgResponseTimeMs: number;
  p50ResponseTimeMs: number;
  p95ResponseTimeMs: number;
  p99ResponseTimeMs: number;
  uniqueUsers: number;
}

export interface CanaryComparisonReport {
  experiment: string;
  generatedAt: string;
  stable: VariantStats;
  canary: VariantStats;
  responseTimeDiffMs: number;
  errorRateDiffPercent: number;
  verdict: 'canary-is-better' | 'canary-is-worse' | 'no-significant-difference' | 'insufficient-data';
}

export class CanaryMetricsCollector {
  private records = new Map<string, MetricRecord[]>();
  private onMetric?: (record: MetricRecord) => void;
  private maxRecordsPerExperiment: number;

  constructor(options?: {
    onMetric?: (record: MetricRecord) => void;
    maxRecordsPerExperiment?: number;
  }) {
    this.onMetric = options?.onMetric;
    this.maxRecordsPerExperiment = options?.maxRecordsPerExperiment ?? 10_000;
  }

  record(metric: MetricRecord): void {
    const key = metric.experiment;
    let records = this.records.get(key);
    if (!records) {
      records = [];
      this.records.set(key, records);
    }

    records.push(metric);

    if (records.length > this.maxRecordsPerExperiment) {
      records.splice(0, records.length - this.maxRecordsPerExperiment);
    }

    if (this.onMetric) {
      try {
        this.onMetric(metric);
      } catch {
        // never break the caller
      }
    }
  }

  compare(experimentName: string): CanaryComparisonReport {
    const records = this.records.get(experimentName) ?? [];

    const stableRecords = records.filter((r) => r.variant === 'stable');
    const canaryRecords = records.filter((r) => r.variant === 'canary');

    const stable = this.computeStats('stable', stableRecords);
    const canary = this.computeStats('canary', canaryRecords);

    const responseTimeDiffMs = canary.avgResponseTimeMs - stable.avgResponseTimeMs;
    const errorRateDiffPercent = canary.errorRate - stable.errorRate;

    let verdict: CanaryComparisonReport['verdict'];
    if (stable.totalRequests < 30 || canary.totalRequests < 30) {
      verdict = 'insufficient-data';
    } else if (errorRateDiffPercent > 2 || canary.p95ResponseTimeMs > stable.p95ResponseTimeMs * 1.5) {
      verdict = 'canary-is-worse';
    } else if (errorRateDiffPercent < -1 || canary.p95ResponseTimeMs < stable.p95ResponseTimeMs * 0.9) {
      verdict = 'canary-is-better';
    } else {
      verdict = 'no-significant-difference';
    }

    return {
      experiment: experimentName,
      generatedAt: new Date().toISOString(),
      stable,
      canary,
      responseTimeDiffMs: Math.round(responseTimeDiffMs * 100) / 100,
      errorRateDiffPercent: Math.round(errorRateDiffPercent * 100) / 100,
      verdict,
    };
  }

  getExperiments(): string[] {
    return Array.from(this.records.keys());
  }

  clear(experimentName: string): void {
    this.records.delete(experimentName);
  }

  clearAll(): void {
    this.records.clear();
  }

  private computeStats(variant: Variant, records: MetricRecord[]): VariantStats {
    if (records.length === 0) {
      return {
        variant,
        totalRequests: 0,
        errorCount: 0,
        errorRate: 0,
        avgResponseTimeMs: 0,
        p50ResponseTimeMs: 0,
        p95ResponseTimeMs: 0,
        p99ResponseTimeMs: 0,
        uniqueUsers: 0,
      };
    }

    const times = records.map((r) => r.responseTimeMs).sort((a, b) => a - b);
    const errorCount = records.filter((r) => r.isError).length;
    const uniqueUsers = new Set(records.map((r) => r.userId)).size;

    return {
      variant,
      totalRequests: records.length,
      errorCount,
      errorRate: Math.round((errorCount / records.length) * 10000) / 100,
      avgResponseTimeMs: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 100) / 100,
      p50ResponseTimeMs: this.percentile(times, 50),
      p95ResponseTimeMs: this.percentile(times, 95),
      p99ResponseTimeMs: this.percentile(times, 99),
      uniqueUsers,
    };
  }

  private percentile(sorted: number[], pct: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((pct / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}
