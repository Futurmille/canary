import {
  IAssignmentStrategy,
  CanaryUser,
  StrategyConfig,
  Variant,
} from '../types';

/**
 * Attribute-based strategy — assigns canary if a user attribute matches any of the target values.
 * Example: country=US, plan=enterprise, role=admin.
 */
export class AttributeStrategy implements IAssignmentStrategy {
  readonly type = 'attribute';

  evaluate(user: CanaryUser, config: StrategyConfig): Variant | null {
    if (config.type !== 'attribute') return null;
    if (!user.attributes) return null;

    const userValue = user.attributes[config.attribute];
    if (userValue === undefined) return null;

    // Loose comparison to handle string/number coercion ("1" == 1)
    const matches = config.values.some((v) => String(v) === String(userValue));
    return matches ? 'canary' : null;
  }
}
