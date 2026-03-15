import { InMemoryStorage } from '../../../src/storage/in-memory';
import { CanaryExperiment, Assignment } from '../../../src/types';

describe('InMemoryStorage', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
  });

  const makeExperiment = (name = 'test-exp'): CanaryExperiment => ({
    name,
    enabled: true,
    strategies: [{ type: 'percentage', percentage: 50 }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });

  const makeAssignment = (userId = 'user-1', experimentName = 'test-exp'): Assignment => ({
    userId,
    experimentName,
    variant: 'canary',
    assignedAt: '2026-01-01T00:00:00Z',
    reason: 'percentage',
  });

  // ── Experiment CRUD ────────────────────────────────────────

  describe('experiments', () => {
    it('returns null for non-existent experiment', async () => {
      expect(await storage.getExperiment('nope')).toBeNull();
    });

    it('saves and retrieves an experiment', async () => {
      const exp = makeExperiment();
      await storage.saveExperiment(exp);
      const retrieved = await storage.getExperiment('test-exp');
      expect(retrieved).toEqual(exp);
    });

    it('stores a copy — mutations do not leak', async () => {
      const exp = makeExperiment();
      await storage.saveExperiment(exp);
      exp.enabled = false;
      const retrieved = await storage.getExperiment('test-exp');
      expect(retrieved!.enabled).toBe(true);
    });

    it('overwrites on save', async () => {
      await storage.saveExperiment(makeExperiment());
      const updated = { ...makeExperiment(), enabled: false };
      await storage.saveExperiment(updated);
      expect((await storage.getExperiment('test-exp'))!.enabled).toBe(false);
    });

    it('deletes an experiment', async () => {
      await storage.saveExperiment(makeExperiment());
      await storage.deleteExperiment('test-exp');
      expect(await storage.getExperiment('test-exp')).toBeNull();
    });

    it('lists all experiments', async () => {
      await storage.saveExperiment(makeExperiment('a'));
      await storage.saveExperiment(makeExperiment('b'));
      const list = await storage.listExperiments();
      expect(list).toHaveLength(2);
      expect(list.map((e) => e.name).sort()).toEqual(['a', 'b']);
    });
  });

  // ── Assignment CRUD ────────────────────────────────────────

  describe('assignments', () => {
    it('returns null for non-existent assignment', async () => {
      expect(await storage.getAssignment('user-1', 'test-exp')).toBeNull();
    });

    it('saves and retrieves an assignment', async () => {
      const a = makeAssignment();
      await storage.saveAssignment(a);
      expect(await storage.getAssignment('user-1', 'test-exp')).toEqual(a);
    });

    it('deletes a specific assignment', async () => {
      await storage.saveAssignment(makeAssignment());
      await storage.deleteAssignment('user-1', 'test-exp');
      expect(await storage.getAssignment('user-1', 'test-exp')).toBeNull();
    });

    it('saveAssignment with TTL expires after duration', async () => {
      await storage.saveAssignment(makeAssignment(), 1);
      expect(await storage.getAssignment('user-1', 'test-exp')).not.toBeNull();
      await new Promise((r) => setTimeout(r, 1100));
      expect(await storage.getAssignment('user-1', 'test-exp')).toBeNull();
    }, 5000);

    it('saveAssignment without TTL does not expire', async () => {
      await storage.saveAssignment(makeAssignment());
      expect(await storage.getAssignment('user-1', 'test-exp')).not.toBeNull();
    });

    it('deleteAllAssignments removes only the target experiment', async () => {
      await storage.saveAssignment(makeAssignment('u1', 'exp-a'));
      await storage.saveAssignment(makeAssignment('u2', 'exp-a'));
      await storage.saveAssignment(makeAssignment('u1', 'exp-b'));

      const count = await storage.deleteAllAssignments('exp-a');
      expect(count).toBe(2);
      expect(await storage.getAssignment('u1', 'exp-a')).toBeNull();
      expect(await storage.getAssignment('u1', 'exp-b')).not.toBeNull();
    });
  });

  // ── Atomic saveAssignmentIfNotExists ───────────────────────

  describe('saveAssignmentIfNotExists', () => {
    it('returns true and saves when no prior assignment', async () => {
      const result = await storage.saveAssignmentIfNotExists(makeAssignment());
      expect(result).toBe(true);
      expect(await storage.getAssignment('user-1', 'test-exp')).toEqual(makeAssignment());
    });

    it('returns false and does NOT overwrite existing assignment', async () => {
      await storage.saveAssignmentIfNotExists(makeAssignment());
      const second: Assignment = { ...makeAssignment(), variant: 'stable', reason: 'late' };
      const result = await storage.saveAssignmentIfNotExists(second);
      expect(result).toBe(false);
      expect((await storage.getAssignment('user-1', 'test-exp'))!.variant).toBe('canary');
    });
  });

  // ── clear() ────────────────────────────────────────────────

  it('clear() wipes all data', async () => {
    await storage.saveExperiment(makeExperiment());
    await storage.saveAssignment(makeAssignment());
    storage.clear();
    expect(await storage.getExperiment('test-exp')).toBeNull();
    expect(await storage.getAssignment('user-1', 'test-exp')).toBeNull();
  });
});
