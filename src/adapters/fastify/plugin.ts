import { CanaryManager } from '../../core/canary-manager';
import { CanaryUser, Variant } from '../../types';

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
  experimentName: string;
  getUserFromRequest: (request: FastifyRequest) => CanaryUser | null;
  setHeader?: boolean;
}

export function canaryFastifyPlugin(
  fastify: FastifyInstance,
  manager: CanaryManager,
  options: CanaryFastifyPluginOptions,
): void {
  const { getUserFromRequest, experimentName, setHeader = true } = options;

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
