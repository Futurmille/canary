import {
  IAssignmentStrategy,
  CanaryUser,
  StrategyConfig,
  Variant,
} from '../types';

export class AttributeStrategy implements IAssignmentStrategy {
  readonly type = 'attribute';

  evaluate(user: CanaryUser, config: StrategyConfig): Variant | null {
    if (config.type !== 'attribute') return null;
    if (!user.attributes) return null;

    const userValue = user.attributes[config.attribute];
    if (userValue === undefined) return null;

    const matches = config.values.some((v) => String(v) === String(userValue));
    return matches ? (config.variant ?? 'canary') : null;
  }
}
