/**
 * NestJS decorators for canary release integration.
 *
 * These are thin wrappers that work with NestJS's DI and decorator system.
 * They depend only on the types that NestJS exposes — no direct NestJS import
 * needed at compile time (the consumer provides NestJS).
 */

// Symbol keys for metadata
export const CANARY_EXPERIMENT_KEY = Symbol('canary:experiment');
export const CANARY_VARIANT_KEY = Symbol('canary:variant');

/**
 * Method decorator — marks a controller method as gated behind a canary experiment.
 *
 * Usage:
 * ```ts
 * @CanaryExperiment('new-checkout')
 * @Get('/checkout')
 * checkout() { ... }
 * ```
 */
export function CanaryExperiment(experimentName: string): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(CANARY_EXPERIMENT_KEY, experimentName, descriptor.value as object);
    return descriptor;
  };
}

/**
 * Parameter decorator — injects the resolved variant into a handler parameter.
 *
 * Usage:
 * ```ts
 * @Get('/feature')
 * feature(@CanaryVariant() variant: Variant) { ... }
 * ```
 *
 * Requires the CanaryGuard to have run first.
 */
export function CanaryVariant(): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    const existingParams: number[] =
      (Reflect.getOwnMetadata(CANARY_VARIANT_KEY, target, propertyKey as string | symbol) as number[]) || [];
    existingParams.push(parameterIndex);
    Reflect.defineMetadata(CANARY_VARIANT_KEY, existingParams, target, propertyKey as string | symbol);
  };
}
