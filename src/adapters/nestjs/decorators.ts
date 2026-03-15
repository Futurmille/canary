export const CANARY_EXPERIMENT_KEY = Symbol('canary:experiment');
export const CANARY_VARIANT_KEY = Symbol('canary:variant');

export function CanaryExperiment(experimentName: string): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(CANARY_EXPERIMENT_KEY, experimentName, descriptor.value as object);
    return descriptor;
  };
}

export function CanaryVariant(): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    const existingParams: number[] =
      (Reflect.getOwnMetadata(CANARY_VARIANT_KEY, target, propertyKey as string | symbol) as number[]) || [];
    existingParams.push(parameterIndex);
    Reflect.defineMetadata(CANARY_VARIANT_KEY, existingParams, target, propertyKey as string | symbol);
  };
}
