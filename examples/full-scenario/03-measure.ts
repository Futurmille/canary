/**
 * ══════════════════════════════════════════════════════════════
 * FASE 3: MEDIR RENDIMIENTO — ¿la v2 va mejor o peor que v1?
 * ══════════════════════════════════════════════════════════════
 *
 * Antes de abrir la v2 a más usuarios, el dev necesita saber:
 * - ¿La v2 es más lenta? (tiene que llamar a la API de IA)
 * - ¿La v2 tiene más errores?
 * - ¿Es seguro aumentar el porcentaje?
 *
 * CanaryMetricsCollector compara automáticamente ambas variantes.
 *
 * Ejecutar: npx ts-node 03-measure.ts
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

  // Crear experimento: enterprise → canary, 10% del resto
  await manager.createExperiment('product-v2', [
    { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
    { type: 'percentage', percentage: 10 },
  ]);

  // ════════════════════════════════════════════════════════════
  // SIMULAR TRÁFICO REAL: 200 requests de diferentes usuarios
  // ════════════════════════════════════════════════════════════

  console.log('Simulando 200 requests de 100 usuarios diferentes...\n');

  const users: CanaryUser[] = [];

  // 20 usuarios enterprise
  for (let i = 0; i < 20; i++) {
    users.push({ id: `enterprise-${i}`, attributes: { plan: 'enterprise' } });
  }
  // 80 usuarios free
  for (let i = 0; i < 80; i++) {
    users.push({ id: `free-${i}`, attributes: { plan: 'free' } });
  }

  // Cada usuario hace 2 requests
  for (const user of users) {
    for (let req = 0; req < 2; req++) {
      const variant: Variant = await manager.getVariant(user, 'product-v2');

      // Simular tiempo de respuesta:
      // - stable: 40-60ms (solo base de datos)
      // - canary: 50-80ms (base de datos + API de IA)
      const baseTime = variant === 'canary' ? 50 : 40;
      const jitter = Math.random() * 30;
      const responseTimeMs = baseTime + jitter;

      // Simular errores:
      // - stable: 0.5% error rate
      // - canary: 1% error rate (la API de IA a veces falla)
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
  // GENERAR REPORTE DE COMPARACIÓN
  // ════════════════════════════════════════════════════════════

  const report = metrics.compare('product-v2');

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║        REPORTE DE COMPARACIÓN: product-v2           ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║                                                      ║');
  console.log(`║  STABLE (v1 actual)                                  ║`);
  console.log(`║    Requests totales:  ${String(report.stable.totalRequests).padEnd(6)} ║`);
  console.log(`║    Usuarios únicos:   ${String(report.stable.uniqueUsers).padEnd(6)} ║`);
  console.log(`║    Tiempo promedio:   ${String(report.stable.avgResponseTimeMs.toFixed(1) + 'ms').padEnd(10)} ║`);
  console.log(`║    p95:               ${String(report.stable.p95ResponseTimeMs.toFixed(1) + 'ms').padEnd(10)} ║`);
  console.log(`║    Tasa de error:     ${String(report.stable.errorRate.toFixed(2) + '%').padEnd(8)} ║`);
  console.log('║                                                      ║');
  console.log(`║  CANARY (v2 nueva)                                   ║`);
  console.log(`║    Requests totales:  ${String(report.canary.totalRequests).padEnd(6)} ║`);
  console.log(`║    Usuarios únicos:   ${String(report.canary.uniqueUsers).padEnd(6)} ║`);
  console.log(`║    Tiempo promedio:   ${String(report.canary.avgResponseTimeMs.toFixed(1) + 'ms').padEnd(10)} ║`);
  console.log(`║    p95:               ${String(report.canary.p95ResponseTimeMs.toFixed(1) + 'ms').padEnd(10)} ║`);
  console.log(`║    Tasa de error:     ${String(report.canary.errorRate.toFixed(2) + '%').padEnd(8)} ║`);
  console.log('║                                                      ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Diferencia tiempo:  ${report.responseTimeDiffMs > 0 ? '+' : ''}${report.responseTimeDiffMs.toFixed(1)}ms (+ = canary más lento) ║`);
  console.log(`║  Diferencia errores: ${report.errorRateDiffPercent > 0 ? '+' : ''}${report.errorRateDiffPercent.toFixed(2)}%                         ║`);
  console.log(`║  VEREDICTO: ${report.verdict.padEnd(30)}       ║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  // ════════════════════════════════════════════════════════════
  // DECISIÓN: ¿QUÉ HACER?
  // ════════════════════════════════════════════════════════════

  console.log('\n── Decisión automática basada en métricas ──\n');

  if (report.verdict === 'canary-is-worse') {
    console.log('La v2 tiene problemas. Haciendo ROLLBACK inmediato...');
    await manager.rollback('product-v2');
    console.log('Rollback completado. Todos los usuarios ven v1.');

  } else if (report.verdict === 'canary-is-better' || report.verdict === 'no-significant-difference') {
    console.log('Las métricas son aceptables. Aumentando rollout...\n');

    console.log('  Paso 1: 10% → 25%');
    await manager.increaseRollout('product-v2', 25);

    console.log('  Paso 2: 25% → 50%');
    await manager.increaseRollout('product-v2', 50);

    console.log('  Paso 3: 50% → 100% (todos ven v2)');
    await manager.increaseRollout('product-v2', 100);

    console.log('\n  Rollout completo. La v2 es ahora la versión principal.');

  } else {
    console.log('Datos insuficientes. Esperando más tráfico antes de decidir.');
  }

  console.log('\n→ Siguiente paso: limpiar → ver 04-cleanup.ts');
}

main().catch(console.error);
