import {
  IAssignmentStrategy,
  CanaryUser,
  StrategyConfig,
  Variant,
} from '../types';

export class WhitelistStrategy implements IAssignmentStrategy {
  readonly type = 'whitelist';

  evaluate(user: CanaryUser, config: StrategyConfig): Variant | null {
    if (config.type !== 'whitelist') return null;
    return new Set(config.userIds).has(user.id) ? (config.variant ?? 'canary') : null;
  }
}
