import { Variant } from '../types';

/**
 * A single recorded metric data point for a request.
 */
export interface MetricRecord {
  experiment: string;
  variant: Variant;
  userId: string;
  endpoint: string;
  /** Response time in milliseconds */
  responseTimeMs: number;
  /** HTTP status code */
  statusCode: number;
  /** Whether this response was an error (status >= 400) */
  isError: boolean;
  timestamp: string;
}

/**
 * Aggregated stats for one variant of one experiment.
 */
export interface VariantStats {
  variant: Variant;
  /** Total number of requests recorded */
  totalRequests: number;
  /** Number of error responses (status >= 400) */
  errorCount: number;
  /** Error rate as a percentage (0-100) */
  errorRate: number;
  /** Average response time in ms */
  avgResponseTimeMs: number;
  /** p50 response time in ms */
  p50ResponseTimeMs: number;
  /** p95 response time in ms */
  p95ResponseTimeMs: number;
  /** p99 response time in ms */
  p99ResponseTimeMs: number;
  /** Unique users seen */
  uniqueUsers: number;
}

/**
 * Comparison report between stable and canary variants.
 */
export interface CanaryComparisonReport {
  experiment: string;
  generatedAt: string;
  stable: VariantStats;
  canary: VariantStats;
  /** Positive = canary is slower, negative = canary is faster */
  responseTimeDiffMs: number;
  /** Positive = canary has more errors, negative = canary has fewer */
  errorRateDiffPercent: number;
  /** Simple verdict based on error rate and p95 */
  verdict: 'canary-is-better' | 'canary-is-worse' | 'no-significant-difference' | 'insufficient-data';
}

/**
 * In-process metrics collector for canary experiments.
 *
 * Collects response time and error rate per variant, then produces
 * a comparison report so you can decide whether to increase rollout or rollback.
 *
 * For production, wire the `onMetric` callback to your metrics backend
 * (Datadog, Prometheus, CloudWatch) instead of relying on in-memory storage.
 */
export class CanaryMetricsCollector {
  private records = new Map<string, MetricRecord[]>();
  private onMetric?: (record: MetricRecord) => void;
  private maxRecordsPerExperiment: number;

  constructor(options?: {
    /** Callback fired for every recorded metric — use to forward to external systems */
    onMetric?: (record: MetricRecord) => void;
    /** Max records to keep in memory per experiment (default: 10000) */
    maxRecordsPerExperiment?: number;
  }) {
    this.onMetric = options?.onMetric;
    this.maxRecordsPerExperiment = options?.maxRecordsPerExperiment ?? 10_000;
  }

  /**
   * Record a metric for a request that was served under a canary experiment.
   */
  record(metric: MetricRecord): void {
    const key = metric.experiment;
    let records = this.records.get(key);
    if (!records) {
      records = [];
      this.records.set(key, records);
    }

    records.push(metric);

    // Evict oldest records if over limit
    if (records.length > this.maxRecordsPerExperiment) {
      records.splice(0, records.length - this.maxRecordsPerExperiment);
    }

    if (this.onMetric) {
      try {
        this.onMetric(metric);
      } catch {
        // Never break the caller
      }
    }
  }

  /**
   * Generate a comparison report between stable and canary for an experiment.
   */
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

  /**
   * Get all recorded experiments.
   */
  getExperiments(): string[] {
    return Array.from(this.records.keys());
  }

  /**
   * Clear all records for an experiment.
   */
  clear(experimentName: string): void {
    this.records.delete(experimentName);
  }

  /**
   * Clear all records.
   */
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
