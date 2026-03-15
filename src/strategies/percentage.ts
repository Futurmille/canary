import {
  IAssignmentStrategy,
  CanaryUser,
  StrategyConfig,
  Variant,
} from '../types';

/**
 * Deterministic percentage-based assignment.
 * Uses a simple hash of userId to produce a stable bucket 0-99.
 * This means the same user always lands in the same bucket for a given experiment,
 * even across restarts — no storage lookup needed for the decision itself.
 */
export class PercentageStrategy implements IAssignmentStrategy {
  readonly type = 'percentage';

  evaluate(user: CanaryUser, config: StrategyConfig): Variant | null {
    if (config.type !== 'percentage') return null;

    const bucket = this.hash(user.id) % 100;
    return bucket < config.percentage ? (config.variant ?? 'canary') : 'stable';
  }

  /**
   * FNV-1a 32-bit hash — fast, good distribution, zero dependencies.
   * We only need uniform distribution across 100 buckets, not cryptographic strength.
   */
  private hash(input: string): number {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193); // FNV prime
    }
    return h >>> 0; // ensure unsigned
  }
}
