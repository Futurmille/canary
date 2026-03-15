/**
 * ══════════════════════════════════════════════════════════════
 * PHASE 3: MEASURE PERFORMANCE — is v2 better or worse than v1?
 * ══════════════════════════════════════════════════════════════
 *
 * Before opening v2 to more users, the dev needs to know:
 * - Is v2 slower? (it has to call the AI API)
 * - Does v2 have more errors?
 * - Is it safe to increase the percentage?
 *
 * CanaryMetricsCollector automatically compares both variants.
 *
 * Run: npx tsx 03-measure.ts
 */

import {
  CanaryManager,
  InMemoryStorage,
  CanaryMetricsCollector,
  CanaryUser,
  Variant,
} from '../../src';

async function main() {

  const storage = new InMemoryStorage();
  const metrics = new CanaryMetricsCollector();
  const manager = new CanaryManager({ storage });

  // Create experiment: enterprise → canary, 10% of everyone else
  await manager.createExperiment('product-v2', [
    { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
    { type: 'percentage', percentage: 10 },
  ]);

  // ════════════════════════════════════════════════════════════
  // SIMULATE REAL TRAFFIC: 200 requests from different users
  // ════════════════════════════════════════════════════════════

  console.log('Simulating 200 requests from 100 different users...\n');

  const users: CanaryUser[] = [];

  // 20 enterprise users
  for (let i = 0; i < 20; i++) {
    users.push({ id: `enterprise-${i}`, attributes: { plan: 'enterprise' } });
  }
  // 80 free users
  for (let i = 0; i < 80; i++) {
    users.push({ id: `free-${i}`, attributes: { plan: 'free' } });
  }

  // Each user makes 2 requests
  for (const user of users) {
    for (let req = 0; req < 2; req++) {
      const variant: Variant = await manager.getVariant(user, 'product-v2');

      // Simulate response times:
      // - stable: 40-70ms (database only)
      // - canary: 50-80ms (database + AI API)
      const baseTime = variant === 'canary' ? 50 : 40;
      const jitter = Math.random() * 30;
      const responseTimeMs = baseTime + jitter;

      // Simulate errors:
      // - stable: 0.5% error rate
      // - canary: 1% error rate (AI API sometimes fails)
      const errorThreshold = variant === 'canary' ? 0.01 : 0.005;
      const isError = Math.random() < errorThreshold;

      metrics.record({
        experiment: 'product-v2',
        variant,
        userId: user.id,
        endpoint: 'GET /products/:id',
        responseTimeMs,
        statusCode: isError ? 500 : 200,
        isError,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ════════════════════════════════════════════════════════════
  // GENERATE COMPARISON REPORT
  // ════════════════════════════════════════════════════════════

  const report = metrics.compare('product-v2');

  console.log('+======================================================+');
  console.log('|          COMPARISON REPORT: product-v2                |');
  console.log('+======================================================+');
  console.log('|                                                       |');
  console.log('|  STABLE (current v1)                                  |');
  console.log(`|    Total requests:    ${String(report.stable.totalRequests).padEnd(6)}                         |`);
  console.log(`|    Unique users:      ${String(report.stable.uniqueUsers).padEnd(6)}                         |`);
  console.log(`|    Avg response time: ${String(report.stable.avgResponseTimeMs.toFixed(1) + 'ms').padEnd(10)}                     |`);
  console.log(`|    p95:               ${String(report.stable.p95ResponseTimeMs.toFixed(1) + 'ms').padEnd(10)}                     |`);
  console.log(`|    Error rate:        ${String(report.stable.errorRate.toFixed(2) + '%').padEnd(8)}                       |`);
  console.log('|                                                       |');
  console.log('|  CANARY (new v2)                                      |');
  console.log(`|    Total requests:    ${String(report.canary.totalRequests).padEnd(6)}                         |`);
  console.log(`|    Unique users:      ${String(report.canary.uniqueUsers).padEnd(6)}                         |`);
  console.log(`|    Avg response time: ${String(report.canary.avgResponseTimeMs.toFixed(1) + 'ms').padEnd(10)}                     |`);
  console.log(`|    p95:               ${String(report.canary.p95ResponseTimeMs.toFixed(1) + 'ms').padEnd(10)}                     |`);
  console.log(`|    Error rate:        ${String(report.canary.errorRate.toFixed(2) + '%').padEnd(8)}                       |`);
  console.log('|                                                       |');
  console.log('+------------------------------------------------------+');
  console.log(`|  Time difference:  ${report.responseTimeDiffMs > 0 ? '+' : ''}${report.responseTimeDiffMs.toFixed(1)}ms (+ = canary is slower)    |`);
  console.log(`|  Error difference: ${report.errorRateDiffPercent > 0 ? '+' : ''}${report.errorRateDiffPercent.toFixed(2)}%                            |`);
  console.log(`|  VERDICT: ${report.verdict.padEnd(38)}   |`);
  console.log('+======================================================+');

  // ════════════════════════════════════════════════════════════
  // DECISION: WHAT TO DO?
  // ════════════════════════════════════════════════════════════

  console.log('\n-- Automatic decision based on metrics --\n');

  if (report.verdict === 'canary-is-worse') {
    console.log('v2 has problems. Performing INSTANT ROLLBACK...');
    await manager.rollback('product-v2');
    console.log('Rollback complete. All users see v1. No redeployment needed.');

  } else if (report.verdict === 'canary-is-better' || report.verdict === 'no-significant-difference') {
    console.log('Metrics are acceptable. Increasing rollout...\n');

    console.log('  Step 1: 10% -> 25%');
    await manager.increaseRollout('product-v2', 25);

    console.log('  Step 2: 25% -> 50%');
    await manager.increaseRollout('product-v2', 50);

    console.log('  Step 3: 50% -> 100% (everyone sees v2)');
    await manager.increaseRollout('product-v2', 100);

    console.log('\n  Rollout complete. v2 is now the primary version.');

  } else {
    console.log('Insufficient data. Waiting for more traffic before deciding.');
  }

  console.log('\n-> Next step: clean up -> see 04-cleanup.ts');
}

main().catch(console.error);
