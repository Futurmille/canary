import { CanaryManager } from '../../core/canary-manager';
import { CanaryUser, Variant } from '../../types';

/**
 * Minimal Fastify types — no dependency on fastify package.
 */
interface FastifyRequest {
  headers: Record<string, string | string[] | undefined>;
  url: string;
  method: string;
  [key: string]: unknown;
}

interface FastifyReply {
  header(name: string, value: string): FastifyReply;
  status(code: number): FastifyReply;
  send(payload?: unknown): FastifyReply;
  [key: string]: unknown;
}

interface FastifyInstance {
  addHook(
    name: 'preHandler' | 'onRequest',
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
  ): void;
  decorateRequest(name: string, value: unknown): void;
}

export interface CanaryFastifyPluginOptions {
  /** The experiment to evaluate */
  experimentName: string;
  /** Extract a CanaryUser from the Fastify request */
  getUserFromRequest: (request: FastifyRequest) => CanaryUser | null;
  /** Set X-Canary-Variant response header (default: true) */
  setHeader?: boolean;
}

/**
 * Fastify plugin that resolves a canary variant for every request and
 * attaches it to `request.canaryVariant`.
 *
 * Usage:
 * ```ts
 * import Fastify from 'fastify';
 * import { CanaryManager, InMemoryStorage, canaryFastifyPlugin } from '@ebutrera9103/canary-node';
 *
 * const fastify = Fastify();
 * const manager = new CanaryManager({ storage: new InMemoryStorage() });
 *
 * canaryFastifyPlugin(fastify, manager, {
 *   experimentName: 'checkout-v2',
 *   getUserFromRequest: (request) => {
 *     const user = request.user as any;
 *     return user ? { id: user.id, attributes: { plan: user.plan } } : null;
 *   },
 * });
 *
 * fastify.get('/products/:id', async (request) => {
 *   if (request.canaryVariant === 'canary') { ... }
 * });
 * ```
 */
export function canaryFastifyPlugin(
  fastify: FastifyInstance,
  manager: CanaryManager,
  options: CanaryFastifyPluginOptions,
): void {
  const { getUserFromRequest, experimentName, setHeader = true } = options;

  // Decorate request with canaryVariant property
  fastify.decorateRequest('canaryVariant', 'stable');

  fastify.addHook('preHandler', async (request, reply) => {
    try {
      const user = getUserFromRequest(request);
      let variant: Variant = 'stable';

      if (user) {
        variant = await manager.getVariant(user, experimentName);
      }

      request.canaryVariant = variant;

      if (setHeader) {
        reply.header('X-Canary-Variant', variant);
      }
    } catch {
      request.canaryVariant = 'stable';
    }
  });
}
