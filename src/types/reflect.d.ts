// Reflect metadata polyfill type declarations.
// At runtime, NestJS consumers will have reflect-metadata loaded.
declare namespace Reflect {
  function defineMetadata(metadataKey: symbol | string, metadataValue: unknown, target: object, propertyKey?: string | symbol): void;
  function getMetadata(metadataKey: symbol | string, target: object): unknown;
  function getOwnMetadata(metadataKey: symbol | string, target: object, propertyKey?: string | symbol): unknown;
}
