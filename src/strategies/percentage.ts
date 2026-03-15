import {
  IAssignmentStrategy,
  CanaryUser,
  StrategyConfig,
  Variant,
} from '../types';

export class PercentageStrategy implements IAssignmentStrategy {
  readonly type = 'percentage';

  evaluate(user: CanaryUser, config: StrategyConfig): Variant | null {
    if (config.type !== 'percentage') return null;

    const bucket = this.hash(user.id) % 100;
    return bucket < config.percentage ? (config.variant ?? 'canary') : 'stable';
  }

  /** FNV-1a 32-bit hash */
  private hash(input: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
}
