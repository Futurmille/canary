/**
 * ══════════════════════════════════════════════════════════════
 * FASE 4: APAGAR EL EXPERIMENTO — Limpieza final
 * ══════════════════════════════════════════════════════════════
 *
 * La v2 ya está al 100%. Todos los usuarios ven la versión nueva.
 * Ahora hay que limpiar:
 *
 * 1. Borrar el experimento de canary (y sus assignments)
 * 2. Quitar el código de branching del controller
 * 3. Quitar los decoradores @CanaryExperiment y @UseGuards
 *
 * El código pasa de tener un if/else a solo tener la v2.
 *
 * Ejecutar: npx ts-node 04-cleanup.ts
 */

import {
  CanaryManager,
  InMemoryStorage,
} from '../../src';

async function main() {

  const storage = new InMemoryStorage();
  const manager = new CanaryManager({ storage });

  // Simular que el experimento ya existe y está al 100%
  await manager.createExperiment('product-v2', [
    { type: 'percentage', percentage: 100 },
  ]);

  // Verificar: hay un experimento activo
  const before = await manager.listExperiments();
  console.log('Experimentos activos ANTES de limpiar:', before.length);
  console.log('  →', before.map(e => `${e.name} (enabled: ${e.enabled})`).join(', '));

  // ════════════════════════════════════════════════════════════
  // PASO 1: Borrar el experimento
  // ════════════════════════════════════════════════════════════
  //
  // Esto elimina:
  // - La configuración del experimento
  // - TODOS los assignments persistidos (sticky sessions)
  //
  // En producción, esto sería un endpoint admin:
  //   DELETE /admin/canary/product-v2
  //   o: curl -X DELETE http://localhost:3000/admin/canary/experiments/product-v2

  console.log('\n── Paso 1: Borrar experimento ──');
  await manager.deleteExperiment('product-v2');
  console.log('  Experimento "product-v2" eliminado.');

  const after = await manager.listExperiments();
  console.log('  Experimentos activos DESPUÉS:', after.length);

  // ════════════════════════════════════════════════════════════
  // PASO 2: Limpiar el controller (lo hace el dev en código)
  // ════════════════════════════════════════════════════════════

  console.log('\n── Paso 2: El dev limpia el controller ──');
  console.log('');
  console.log('  ANTES (con canary):');
  console.log('  ┌─────────────────────────────────────────────────┐');
  console.log('  │ @UseGuards(CanaryGuard)                         │');
  console.log('  │ @CanaryExperiment("product-v2")                 │');
  console.log('  │ @Get(":id")                                     │');
  console.log('  │ getProduct(@Param("id") id, @Req() req) {      │');
  console.log('  │   const variant = req.canaryVariant;            │');
  console.log('  │                                                  │');
  console.log('  │   if (variant === "canary") {                   │');
  console.log('  │     return { ...producto, reviews, aiSummary }; │');
  console.log('  │   }                                              │');
  console.log('  │   return { ...producto };                       │');
  console.log('  │ }                                                │');
  console.log('  └─────────────────────────────────────────────────┘');
  console.log('');
  console.log('  DESPUÉS (limpio, solo v2):');
  console.log('  ┌─────────────────────────────────────────────────┐');
  console.log('  │ @Get(":id")                                     │');
  console.log('  │ getProduct(@Param("id") id) {                   │');
  console.log('  │   return { ...producto, reviews, aiSummary };   │');
  console.log('  │ }                                                │');
  console.log('  └─────────────────────────────────────────────────┘');

  // ════════════════════════════════════════════════════════════
  // RESUMEN DEL CICLO COMPLETO
  // ════════════════════════════════════════════════════════════

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           CICLO COMPLETO DE CANARY RELEASE               ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║                                                          ║');
  console.log('║  DIA 1: Crear experimento                               ║');
  console.log('║         → QA y enterprise ven v2                         ║');
  console.log('║         → El resto ve v1                                 ║');
  console.log('║                                                          ║');
  console.log('║  DIA 2: Medir métricas                                  ║');
  console.log('║         → Comparar latencia y errores stable vs canary   ║');
  console.log('║         → Si va mal: rollback instantáneo                ║');
  console.log('║                                                          ║');
  console.log('║  DIA 3: Rollout gradual                                  ║');
  console.log('║         → 10% → 25% → 50% → 100%                       ║');
  console.log('║         → Los usuarios existentes mantienen su variante  ║');
  console.log('║                                                          ║');
  console.log('║  DIA 7: Limpieza                                        ║');
  console.log('║         → Borrar experimento                             ║');
  console.log('║         → Quitar if/else del controller                  ║');
  console.log('║         → La v2 es ahora el código normal                ║');
  console.log('║                                                          ║');
  console.log('║  EN NINGÚN MOMENTO se hizo un deploy diferente.          ║');
  console.log('║  UN SOLO servidor, UN SOLO deployment.                   ║');
  console.log('║  El canary vive dentro del código como un if/else.       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(console.error);
