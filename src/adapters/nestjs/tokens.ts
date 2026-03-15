/**
 * NestJS injection tokens for the Canary module.
 * Used by CanaryModule.forRoot() and CanaryModule.forRootAsync() to wire up DI.
 */
export const CANARY_MANAGER = Symbol('CANARY_MANAGER');
export const CANARY_MODULE_OPTIONS = Symbol('CANARY_MODULE_OPTIONS');
