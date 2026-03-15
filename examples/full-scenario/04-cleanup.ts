/**
 * ══════════════════════════════════════════════════════════════
 * PHASE 4: SHUT DOWN THE EXPERIMENT — Final cleanup
 * ══════════════════════════════════════════════════════════════
 *
 * v2 is at 100%. All users see the new version.
 * Now it's time to clean up:
 *
 * 1. Delete the canary experiment (and its assignments)
 * 2. Remove the branching code from the controller
 * 3. Remove the @CanaryExperiment and @UseGuards decorators
 *
 * The code goes from having an if/else to just having the v2 code.
 *
 * Run: npx tsx 04-cleanup.ts
 */

import {
  CanaryManager,
  InMemoryStorage,
} from '../../src';

async function main() {

  const storage = new InMemoryStorage();
  const manager = new CanaryManager({ storage });

  // Simulate the experiment already exists and is at 100%
  await manager.createExperiment('product-v2', [
    { type: 'percentage', percentage: 100 },
  ]);

  // Verify: there is an active experiment
  const before = await manager.listExperiments();
  console.log('Active experiments BEFORE cleanup:', before.length);
  console.log(' ', before.map(e => `${e.name} (enabled: ${e.enabled})`).join(', '));

  // ════════════════════════════════════════════════════════════
  // STEP 1: Delete the experiment
  // ════════════════════════════════════════════════════════════
  //
  // This removes:
  // - The experiment configuration
  // - ALL persisted assignments (sticky sessions)
  //
  // In production, this would be an admin endpoint:
  //   DELETE /admin/canary/product-v2
  //   or: curl -X DELETE http://localhost:3000/admin/canary/experiments/product-v2

  console.log('\n-- Step 1: Delete experiment --');
  await manager.deleteExperiment('product-v2');
  console.log('  Experiment "product-v2" deleted.');

  const after = await manager.listExperiments();
  console.log('  Active experiments AFTER:', after.length);

  // ════════════════════════════════════════════════════════════
  // STEP 2: Clean up the controller (the dev does this in code)
  // ════════════════════════════════════════════════════════════

  console.log('\n-- Step 2: Developer cleans up the controller --');
  console.log('');
  console.log('  BEFORE (with canary):');
  console.log('  +-----------------------------------------------------+');
  console.log('  | @UseGuards(CanaryGuard)                              |');
  console.log('  | @CanaryExperiment("product-v2")                      |');
  console.log('  | @Get(":id")                                          |');
  console.log('  | getProduct(@Param("id") id, @Req() req) {           |');
  console.log('  |   const variant = req.canaryVariant;                 |');
  console.log('  |                                                       |');
  console.log('  |   if (variant === "canary") {                        |');
  console.log('  |     return { ...product, reviews, aiSummary };       |');
  console.log('  |   }                                                   |');
  console.log('  |   return { ...product };                             |');
  console.log('  | }                                                     |');
  console.log('  +-----------------------------------------------------+');
  console.log('');
  console.log('  AFTER (clean, v2 only):');
  console.log('  +-----------------------------------------------------+');
  console.log('  | @Get(":id")                                          |');
  console.log('  | getProduct(@Param("id") id) {                        |');
  console.log('  |   return { ...product, reviews, aiSummary };         |');
  console.log('  | }                                                     |');
  console.log('  +-----------------------------------------------------+');

  // ════════════════════════════════════════════════════════════
  // FULL LIFECYCLE SUMMARY
  // ════════════════════════════════════════════════════════════

  console.log('\n+==========================================================+');
  console.log('|             COMPLETE CANARY RELEASE LIFECYCLE              |');
  console.log('+==========================================================+');
  console.log('|                                                            |');
  console.log('|  DAY 1: Create experiment                                 |');
  console.log('|         -> QA and enterprise see v2                        |');
  console.log('|         -> Everyone else sees v1                           |');
  console.log('|                                                            |');
  console.log('|  DAY 2: Measure metrics                                   |');
  console.log('|         -> Compare latency and errors: stable vs canary    |');
  console.log('|         -> If bad: instant rollback, no redeployment       |');
  console.log('|                                                            |');
  console.log('|  DAY 3: Gradual rollout                                   |');
  console.log('|         -> 10% -> 25% -> 50% -> 100%                      |');
  console.log('|         -> Existing users keep their variant (sticky)      |');
  console.log('|                                                            |');
  console.log('|  DAY 7: Cleanup                                           |');
  console.log('|         -> Delete experiment                               |');
  console.log('|         -> Remove if/else from controller                  |');
  console.log('|         -> v2 is now the normal code                       |');
  console.log('|                                                            |');
  console.log('|  At NO POINT was a separate deployment needed.             |');
  console.log('|  ONE server, ONE deployment.                               |');
  console.log('|  The canary lives inside the code as an if/else.           |');
  console.log('+==========================================================+');
}

main().catch(console.error);
