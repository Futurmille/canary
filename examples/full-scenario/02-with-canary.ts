/**
 * ══════════════════════════════════════════════════════════════
 * FASE 2: INTEGRACIÓN DE @canary-node/core
 * ══════════════════════════════════════════════════════════════
 *
 * El dev hace 3 cosas:
 *
 * A) Configura el módulo canary con las REGLAS de targeting
 * B) Modifica el controller para que tenga DOS caminos (stable / canary)
 * C) Despliega → UN SOLO deployment contiene AMBAS versiones
 *
 * Resultado:
 *   Laura (enterprise) → ve la v2 con reseñas IA
 *   Pedro (free)       → ve la v1 normal, no nota ningún cambio
 *
 * Ejecutar: npx ts-node 02-with-canary.ts
 */

import {
  CanaryManager,
  InMemoryStorage,
  CanaryMetricsCollector,
  CanaryUser,
  Variant,
} from '../../src';

async function main() {

  // ════════════════════════════════════════════════════════════
  // A) CONFIGURACIÓN: ¿quién ve canary y quién no?
  // ════════════════════════════════════════════════════════════

  const storage = new InMemoryStorage();
  const metrics = new CanaryMetricsCollector();

  const manager = new CanaryManager({
    storage,
    hooks: {
      onAssignment: (event) => {
        console.log(
          `   [canary] ${event.user.id} → ${event.variant} ` +
          `(razón: ${event.reason}, cache: ${event.cached})`,
        );
      },
    },
  });

  // Crear el experimento con la cadena de reglas:
  await manager.createExperiment('product-v2', [
    // Regla 1: El equipo de QA SIEMPRE ve canary (por userId)
    { type: 'whitelist', userIds: ['qa-maria', 'qa-jose'] },

    // Regla 2: Clientes enterprise SIEMPRE ven canary (por atributo del usuario)
    { type: 'attribute', attribute: 'plan', values: ['enterprise'] },

    // Regla 3: 0% del resto (empezamos cerrado, luego abrimos)
    { type: 'percentage', percentage: 0 },
  ], 'Página de producto con reseñas IA');

  console.log('Experimento creado: product-v2');
  console.log('Reglas: QA → canary, enterprise → canary, resto → 0%\n');

  // ════════════════════════════════════════════════════════════
  // B) DEFINIR LOS USUARIOS
  // ════════════════════════════════════════════════════════════
  //
  // En producción real, getUserFromRequest() extrae esto del JWT:
  //   const user = req.user; // de Passport/AuthGuard
  //   return { id: user.sub, attributes: { plan: user.plan } };
  //
  // Aquí los definimos manualmente para la simulación:

  const laura: CanaryUser = {
    id: 'laura-001',
    attributes: { plan: 'enterprise', country: 'ES' },
  };

  const pedro: CanaryUser = {
    id: 'pedro-042',
    attributes: { plan: 'free', country: 'ES' },
  };

  // ════════════════════════════════════════════════════════════
  // C) SIMULAR REQUESTS: el mismo endpoint, diferente resultado
  // ════════════════════════════════════════════════════════════

  // En NestJS real esto sería:
  //
  //   @UseGuards(CanaryGuard)
  //   @CanaryExperiment('product-v2')
  //   @Get(':id')
  //   getProduct(@Param('id') id: string, @Req() req) {
  //     const variant = req.canaryVariant;
  //     ...
  //   }
  //
  // Aquí simulamos la misma lógica:

  async function getProduct(user: CanaryUser, productId: string) {
    const start = Date.now();

    // El CanaryGuard hace esto internamente:
    const variant: Variant = await manager.getVariant(user, 'product-v2');

    // El controller usa el variant para decidir qué responder:
    let response: any;

    if (variant === 'canary') {
      // ── VERSIÓN NUEVA (v2): producto + reseñas + IA ──
      response = {
        id: productId,
        name: 'Laptop Pro',
        price: 1299,
        currency: 'EUR',
        stock: 42,
        // Nuevas funcionalidades canary:
        reviews: {
          average: 4.7,
          count: 234,
          highlights: ['Excelente rendimiento', 'Pantalla increíble'],
        },
        aiSummary: 'El 94% de los compradores recomienda este portátil. Destaca por su rendimiento y pantalla.',
      };
    } else {
      // ── VERSIÓN ACTUAL (v1): producto básico ──
      response = {
        id: productId,
        name: 'Laptop Pro',
        price: 1299,
        currency: 'EUR',
        stock: 42,
      };
    }

    // Registrar métricas para comparar rendimiento
    const elapsed = Date.now() - start;
    metrics.record({
      experiment: 'product-v2',
      variant,
      userId: user.id,
      endpoint: `GET /products/${productId}`,
      responseTimeMs: elapsed,
      statusCode: 200,
      isError: false,
      timestamp: new Date().toISOString(),
    });

    return { variant, response };
  }

  // ── Laura pide el producto ─────────────────────────────────

  console.log('═══ Laura (enterprise) pide GET /products/laptop-1 ═══');
  const lauraResult = await getProduct(laura, 'laptop-1');
  console.log(`   Variante: ${lauraResult.variant}`);
  console.log(`   Respuesta:`, JSON.stringify(lauraResult.response, null, 2));

  // ── Pedro pide el producto ─────────────────────────────────

  console.log('\n═══ Pedro (free) pide GET /products/laptop-1 ═══');
  const pedroResult = await getProduct(pedro, 'laptop-1');
  console.log(`   Variante: ${pedroResult.variant}`);
  console.log(`   Respuesta:`, JSON.stringify(pedroResult.response, null, 2));

  // ── Verificar sesiones sticky ──────────────────────────────

  console.log('\n═══ Laura pide OTRA VEZ (sticky session) ═══');
  const lauraAgain = await getProduct(laura, 'laptop-1');
  console.log(`   Variante: ${lauraAgain.variant} (misma que antes, cacheada en storage)`);

  console.log('\n═══ Pedro pide OTRA VEZ (sticky session) ═══');
  const pedroAgain = await getProduct(pedro, 'laptop-1');
  console.log(`   Variante: ${pedroAgain.variant} (misma que antes, cacheada en storage)`);

  // ── Resumen ────────────────────────────────────────────────

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Laura (enterprise): ve v2 con reseñas + IA     ║');
  console.log('║  Pedro (free):       ve v1 normal               ║');
  console.log('║                                                  ║');
  console.log('║  Pedro NO SABE que la v2 existe.                 ║');
  console.log('║  Laura prueba la v2 en producción real.          ║');
  console.log('║  Si la v2 tiene un bug, solo Laura se ve afectada║');
  console.log('║  Pedro sigue trabajando normal.                  ║');
  console.log('╚══════════════════════════════════════════════════╝');

  console.log('\n→ Siguiente paso: medir rendimiento → ver 03-measure.ts');
}

main().catch(console.error);
