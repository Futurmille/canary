import { RedisStorage } from '../../../src/storage/redis';
import { CanaryExperiment, Assignment } from '../../../src/types';

/** In-memory mock of a Redis client — validates the RedisStorage adapter logic */
function createMockRedisClient() {
  const store = new Map<string, string>();

  return {
    store,
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
    del: jest.fn(async (...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    }),
    keys: jest.fn(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
    }),
    setnx: jest.fn(async (key: string, value: string) => {
      if (store.has(key)) return 0;
      store.set(key, value);
      return 1;
    }),
  };
}

describe('RedisStorage', () => {
  let client: ReturnType<typeof createMockRedisClient>;
  let storage: RedisStorage;

  beforeEach(() => {
    client = createMockRedisClient();
    storage = new RedisStorage({ client, prefix: 'test:' });
  });

  const makeExperiment = (name = 'exp-1'): CanaryExperiment => ({
    name,
    enabled: true,
    strategies: [{ type: 'percentage', percentage: 50 }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  const makeAssignment = (userId = 'u1', experimentName = 'exp-1'): Assignment => ({
    userId,
    experimentName,
    variant: 'canary',
    assignedAt: '2026-01-01T00:00:00Z',
    reason: 'percentage',
  });

  // ── Experiments ────────────────────────────────────────────

  describe('experiments', () => {
    it('returns null for missing experiment', async () => {
      expect(await storage.getExperiment('nope')).toBeNull();
    });

    it('saves and retrieves', async () => {
      const exp = makeExperiment();
      await storage.saveExperiment(exp);
      expect(await storage.getExperiment('exp-1')).toEqual(exp);
      expect(client.set).toHaveBeenCalledWith('test:exp:exp-1', JSON.stringify(exp));
    });

    it('deletes', async () => {
      await storage.saveExperiment(makeExperiment());
      await storage.deleteExperiment('exp-1');
      expect(await storage.getExperiment('exp-1')).toBeNull();
    });

    it('lists all experiments', async () => {
      await storage.saveExperiment(makeExperiment('a'));
      await storage.saveExperiment(makeExperiment('b'));
      const list = await storage.listExperiments();
      expect(list).toHaveLength(2);
    });

    it('listExperiments returns empty array when no experiments', async () => {
      const list = await storage.listExperiments();
      expect(list).toEqual([]);
    });
  });

  // ── Assignments ────────────────────────────────────────────

  describe('assignments', () => {
    it('returns null for missing assignment', async () => {
      expect(await storage.getAssignment('u1', 'exp-1')).toBeNull();
    });

    it('saves and retrieves', async () => {
      const a = makeAssignment();
      await storage.saveAssignment(a);
      expect(await storage.getAssignment('u1', 'exp-1')).toEqual(a);
    });

    it('deletes specific assignment', async () => {
      await storage.saveAssignment(makeAssignment());
      await storage.deleteAssignment('u1', 'exp-1');
      expect(await storage.getAssignment('u1', 'exp-1')).toBeNull();
    });

    it('deleteAllAssignments removes matching keys', async () => {
      await storage.saveAssignment(makeAssignment('u1', 'exp-1'));
      await storage.saveAssignment(makeAssignment('u2', 'exp-1'));
      await storage.saveAssignment(makeAssignment('u1', 'exp-2'));

      const count = await storage.deleteAllAssignments('exp-1');
      expect(count).toBe(2);
      expect(await storage.getAssignment('u1', 'exp-1')).toBeNull();
      expect(await storage.getAssignment('u1', 'exp-2')).not.toBeNull();
    });

    it('deleteAllAssignments returns 0 when no matches', async () => {
      const count = await storage.deleteAllAssignments('ghost');
      expect(count).toBe(0);
    });
  });

  // ── Atomic SETNX ──────────────────────────────────────────

  describe('saveAssignmentIfNotExists', () => {
    it('returns true on first save (SETNX returns 1)', async () => {
      const result = await storage.saveAssignmentIfNotExists(makeAssignment());
      expect(result).toBe(true);
      expect(client.setnx).toHaveBeenCalled();
    });

    it('returns false when key already exists (SETNX returns 0)', async () => {
      await storage.saveAssignmentIfNotExists(makeAssignment());
      const result = await storage.saveAssignmentIfNotExists(makeAssignment());
      expect(result).toBe(false);
    });
  });

  // ── Custom prefix ─────────────────────────────────────────

  describe('prefix', () => {
    it('uses default prefix when not specified', async () => {
      const defaultStorage = new RedisStorage({ client });
      await defaultStorage.saveExperiment(makeExperiment());
      expect(client.set).toHaveBeenCalledWith(
        'canary:exp:exp-1',
        expect.any(String),
      );
    });
  });
});
