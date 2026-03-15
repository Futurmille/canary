/**
 * ══════════════════════════════════════════════════════════════
 * PHASE 2: INTEGRATING @futurmille/canary-node
 * ══════════════════════════════════════════════════════════════
 *
 * The developer does 3 things:
 *
 * A) Configures the canary module with TARGETING RULES
 * B) Modifies the controller to have TWO code paths (stable / canary)
 * C) Deploys → ONE SINGLE deployment contains BOTH versions
 *
 * Result:
 *   Laura (enterprise) → sees v2 with AI reviews
 *   Pedro (free)       → sees v1 as usual, notices nothing
 *
 * Run: npx tsx 02-with-canary.ts
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
  // A) CONFIGURATION: who sees canary and who doesn't?
  // ════════════════════════════════════════════════════════════

  const storage = new InMemoryStorage();
  const metrics = new CanaryMetricsCollector();

  const manager = new CanaryManager({
    storage,
    hooks: {
      onAssignment: (event) => {
        console.log(
          `   [canary] ${event.user.id} → ${event.variant} ` +
          `(reason: ${event.reason}, cached: ${event.cached})`,
        );
      },
    },
  });

  // Create the experiment with the targeting rule chain:
  await manager.createExperiment('product-v2', [
    // Rule 1: QA team ALWAYS sees canary (by userId)
    { type: 'whitelist', userIds: ['qa-maria', 'qa-jose'] },

    // Rule 2: Enterprise customers ALWAYS see canary (by user attribute)
    { type: 'attribute', attribute: 'plan', values: ['enterprise'] },

    // Rule 3: 0% of everyone else (start closed, open later)
    { type: 'percentage', percentage: 0 },
  ], 'Product page with AI reviews');

  console.log('Experiment created: product-v2');
  console.log('Rules: QA → canary, enterprise → canary, everyone else → 0%\n');

  // ════════════════════════════════════════════════════════════
  // B) DEFINE THE USERS
  // ════════════════════════════════════════════════════════════
  //
  // In real production, getUserFromRequest() extracts this from the JWT:
  //   const user = req.user; // from Passport/AuthGuard
  //   return { id: user.sub, attributes: { plan: user.plan } };
  //
  // Here we define them manually for the simulation:

  const laura: CanaryUser = {
    id: 'laura-001',
    attributes: { plan: 'enterprise', country: 'US' },
  };

  const pedro: CanaryUser = {
    id: 'pedro-042',
    attributes: { plan: 'free', country: 'US' },
  };

  // ════════════════════════════════════════════════════════════
  // C) SIMULATE REQUESTS: same endpoint, different result
  // ════════════════════════════════════════════════════════════

  // In a real NestJS app this would be:
  //
  //   @UseGuards(CanaryGuard)
  //   @CanaryExperiment('product-v2')
  //   @Get(':id')
  //   getProduct(@Param('id') id: string, @Req() req) {
  //     const variant = req.canaryVariant;
  //     ...
  //   }
  //
  // Here we simulate the same logic:

  async function getProduct(user: CanaryUser, productId: string) {
    const start = Date.now();

    // The CanaryGuard does this internally:
    const variant: Variant = await manager.getVariant(user, 'product-v2');

    // The controller uses the variant to decide what to respond:
    let response: any;

    if (variant === 'canary') {
      // ── NEW VERSION (v2): product + reviews + AI ──
      response = {
        id: productId,
        name: 'Laptop Pro',
        price: 1299,
        currency: 'EUR',
        stock: 42,
        // New canary features:
        reviews: {
          average: 4.7,
          count: 234,
          highlights: ['Excellent performance', 'Stunning display'],
        },
        aiSummary: '94% of buyers recommend this laptop. Praised for performance and display quality.',
      };
    } else {
      // ── CURRENT VERSION (v1): basic product ──
      response = {
        id: productId,
        name: 'Laptop Pro',
        price: 1299,
        currency: 'EUR',
        stock: 42,
      };
    }

    // Record metrics to compare performance later
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

  // ── Laura requests the product ────────────────────────────

  console.log('=== Laura (enterprise) requests GET /products/laptop-1 ===');
  const lauraResult = await getProduct(laura, 'laptop-1');
  console.log(`   Variant: ${lauraResult.variant}`);
  console.log(`   Response:`, JSON.stringify(lauraResult.response, null, 2));

  // ── Pedro requests the product ────────────────────────────

  console.log('\n=== Pedro (free) requests GET /products/laptop-1 ===');
  const pedroResult = await getProduct(pedro, 'laptop-1');
  console.log(`   Variant: ${pedroResult.variant}`);
  console.log(`   Response:`, JSON.stringify(pedroResult.response, null, 2));

  // ── Verify sticky sessions ────────────────────────────────

  console.log('\n=== Laura requests AGAIN (sticky session) ===');
  const lauraAgain = await getProduct(laura, 'laptop-1');
  console.log(`   Variant: ${lauraAgain.variant} (same as before, cached in storage)`);

  console.log('\n=== Pedro requests AGAIN (sticky session) ===');
  const pedroAgain = await getProduct(pedro, 'laptop-1');
  console.log(`   Variant: ${pedroAgain.variant} (same as before, cached in storage)`);

  // ── Summary ───────────────────────────────────────────────

  console.log('\n+==================================================+');
  console.log('|  Laura (enterprise): sees v2 with reviews + AI   |');
  console.log('|  Pedro (free):       sees v1 as usual            |');
  console.log('|                                                   |');
  console.log('|  Pedro DOES NOT KNOW v2 exists.                  |');
  console.log('|  Laura tests v2 in real production.              |');
  console.log('|  If v2 has a bug, only Laura is affected.        |');
  console.log('|  Pedro keeps working normally.                   |');
  console.log('+==================================================+');

  console.log('\n-> Next step: measure performance -> see 03-measure.ts');
}

main().catch(console.error);
