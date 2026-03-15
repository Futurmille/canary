import {
  IAssignmentStrategy,
  CanaryUser,
  StrategyConfig,
  Variant,
} from '../types';

/**
 * Whitelist strategy — assigns canary variant to explicitly listed user IDs.
 * Use for internal testing, beta users, or specific account targeting.
 */
export class WhitelistStrategy implements IAssignmentStrategy {
  readonly type = 'whitelist';

  evaluate(user: CanaryUser, config: StrategyConfig): Variant | null {
    if (config.type !== 'whitelist') return null;

    const idSet = new Set(config.userIds);
    return idSet.has(user.id) ? 'canary' : null;
  }
}
