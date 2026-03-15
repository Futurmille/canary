import { CanaryManager } from '../../../src/core/canary-manager';
import { InMemoryStorage } from '../../../src/storage/in-memory';
import {
  AssignmentEvent,
  RollbackEvent,
  ExposureEvent,
  CanaryUser,
  Variant,
} from '../../../src/types';

describe('CanaryManager', () => {
  let storage: InMemoryStorage;
  let manager: CanaryManager;
  let assignmentEvents: AssignmentEvent[];
  let rollbackEvents: RollbackEvent[];
  let exposureEvents: ExposureEvent[];

  beforeEach(() => {
    storage = new InMemoryStorage();
    assignmentEvents = [];
    rollbackEvents = [];
    exposureEvents = [];

    manager = new CanaryManager({
      storage,
      hooks: {
        onAssignment: (e) => { assignmentEvents.push(e); },
        onRollback: (e) => { rollbackEvents.push(e); },
        onExposure: (e) => { exposureEvents.push(e); },
      },
    });
  });

  const user = (id: string, attrs?: Record<string, string | number | boolean>): CanaryUser => ({
    id,
    attributes: attrs,
  });

  // ── Experiment management ──────────────────────────────────

  describe('experiment CRUD', () => {
    it('creates and retrieves an experiment', async () => {
      const exp = await manager.createExperiment('test', [{ type: 'percentage', percentage: 50 }]);
      expect(exp.name).toBe('test');
      expect(exp.enabled).toBe(true);

      const fetched = await manager.getExperiment('test');
      expect(fetched).toEqual(exp);
    });

    it('lists experiments', async () => {
      await manager.createExperiment('a', []);
      await manager.createExperiment('b', []);
      const list = await manager.listExperiments();
      expect(list).toHaveLength(2);
    });

    it('updates an experiment', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 10 }]);
      const updated = await manager.updateExperiment('test', { enabled: false });
      expect(updated.enabled).toBe(false);
    });

    it('throws on update of non-existent experiment', async () => {
      await expect(manager.updateExperiment('nope', {})).rejects.toThrow('not found');
    });

    it('deletes experiment and its assignments', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await manager.getVariant(user('u1'), 'test');
      await manager.deleteExperiment('test');

      expect(await manager.getExperiment('test')).toBeNull();
      expect(await storage.getAssignment('u1', 'test')).toBeNull();
    });
  });

  // ── Variant resolution ─────────────────────────────────────

  describe('getVariant', () => {
    it('returns stable when experiment does not exist', async () => {
      expect(await manager.getVariant(user('u1'), 'ghost')).toBe('stable');
    });

    it('returns stable when experiment is disabled', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await manager.updateExperiment('test', { enabled: false });
      expect(await manager.getVariant(user('u1'), 'test')).toBe('stable');
    });

    it('assigns canary via percentage strategy', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      expect(await manager.getVariant(user('u1'), 'test')).toBe('canary');
    });

    it('assigns canary via whitelist strategy', async () => {
      await manager.createExperiment('test', [
        { type: 'whitelist', userIds: ['vip'] },
      ]);
      expect(await manager.getVariant(user('vip'), 'test')).toBe('canary');
      expect(await manager.getVariant(user('normie'), 'test')).toBe('stable');
    });

    it('assigns canary via attribute strategy', async () => {
      await manager.createExperiment('test', [
        { type: 'attribute', attribute: 'plan', values: ['enterprise'] },
      ]);
      expect(await manager.getVariant(user('u1', { plan: 'enterprise' }), 'test')).toBe('canary');
      expect(await manager.getVariant(user('u2', { plan: 'free' }), 'test')).toBe('stable');
    });

    it('evaluates strategies in order — first match wins', async () => {
      await manager.createExperiment('test', [
        { type: 'whitelist', userIds: ['alice'] },
        { type: 'percentage', percentage: 0 }, // would be stable
      ]);
      // Alice matches whitelist → canary, even though percentage says stable
      expect(await manager.getVariant(user('alice'), 'test')).toBe('canary');
    });
  });

  // ── Sticky sessions ────────────────────────────────────────

  describe('sticky sessions', () => {
    it('returns the same variant on subsequent calls', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      const first = await manager.getVariant(user('u1'), 'test');
      const second = await manager.getVariant(user('u1'), 'test');
      expect(first).toBe(second);
      expect(first).toBe('canary');
    });

    it('persists assignment in storage', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await manager.getVariant(user('u1'), 'test');

      const assignment = await storage.getAssignment('u1', 'test');
      expect(assignment).not.toBeNull();
      expect(assignment!.variant).toBe('canary');
    });

    it('sticky assignment survives experiment strategy change', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await manager.getVariant(user('u1'), 'test');

      // Change to 0% — but u1 is already assigned
      await manager.updateExperiment('test', {
        strategies: [{ type: 'percentage', percentage: 0 }],
      });

      expect(await manager.getVariant(user('u1'), 'test')).toBe('canary');
    });
  });

  // ── Concurrent experiments ─────────────────────────────────

  describe('concurrent experiments', () => {
    it('same user can have different variants in different experiments', async () => {
      await manager.createExperiment('exp-a', [{ type: 'percentage', percentage: 100 }]);
      await manager.createExperiment('exp-b', [{ type: 'percentage', percentage: 0 }]);

      expect(await manager.getVariant(user('u1'), 'exp-a')).toBe('canary');
      expect(await manager.getVariant(user('u1'), 'exp-b')).toBe('stable');
    });
  });

  // ── Gradual rollout ────────────────────────────────────────

  describe('increaseRollout', () => {
    it('increases percentage in experiment config', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 10 }]);
      const updated = await manager.increaseRollout('test', 50);
      const pctStrategy = updated.strategies.find((s) => s.type === 'percentage');
      expect(pctStrategy).toEqual({ type: 'percentage', percentage: 50 });
    });

    it('rejects invalid percentages', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 10 }]);
      await expect(manager.increaseRollout('test', 101)).rejects.toThrow();
      await expect(manager.increaseRollout('test', -1)).rejects.toThrow();
    });

    it('throws for non-existent experiment', async () => {
      await expect(manager.increaseRollout('nope', 50)).rejects.toThrow();
    });
  });

  // ── Rollback ───────────────────────────────────────────────

  describe('rollback', () => {
    it('clears assignments and disables experiment', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await manager.getVariant(user('u1'), 'test');
      await manager.getVariant(user('u2'), 'test');

      await manager.rollback('test');

      // Assignments cleared
      expect(await storage.getAssignment('u1', 'test')).toBeNull();
      expect(await storage.getAssignment('u2', 'test')).toBeNull();

      // Experiment disabled
      const exp = await manager.getExperiment('test');
      expect(exp!.enabled).toBe(false);

      // After rollback, users get stable
      expect(await manager.getVariant(user('u1'), 'test')).toBe('stable');
    });

    it('fires onRollback hook with correct count', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await manager.getVariant(user('u1'), 'test');
      await manager.getVariant(user('u2'), 'test');

      await manager.rollback('test');

      expect(rollbackEvents).toHaveLength(1);
      expect(rollbackEvents[0].previousAssignments).toBe(2);
    });
  });

  // ── Observability hooks ────────────────────────────────────

  describe('hooks', () => {
    it('fires onAssignment on first assignment (cached=false)', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await manager.getVariant(user('u1'), 'test');

      expect(assignmentEvents).toHaveLength(1);
      expect(assignmentEvents[0].cached).toBe(false);
      expect(assignmentEvents[0].variant).toBe('canary');
    });

    it('fires onAssignment with cached=true on repeat calls', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await manager.getVariant(user('u1'), 'test');
      await manager.getVariant(user('u1'), 'test');

      expect(assignmentEvents).toHaveLength(2);
      expect(assignmentEvents[1].cached).toBe(true);
    });

    it('fires onExposure via recordExposure()', async () => {
      await manager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await manager.getVariant(user('u1'), 'test');
      await manager.recordExposure(user('u1'), 'test');

      expect(exposureEvents).toHaveLength(1);
      expect(exposureEvents[0].variant).toBe('canary');
    });

    it('hook errors do not propagate', async () => {
      const explodingManager = new CanaryManager({
        storage,
        hooks: {
          onAssignment: () => { throw new Error('boom'); },
        },
      });
      await explodingManager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      // Should not throw
      const variant = await explodingManager.getVariant(user('u1'), 'test');
      expect(variant).toBe('canary');
    });

    it('onExposure hook errors do not propagate', async () => {
      const explodingManager = new CanaryManager({
        storage,
        hooks: {
          onExposure: () => { throw new Error('boom'); },
        },
      });
      await explodingManager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await explodingManager.getVariant(user('u1'), 'test');
      // Should not throw
      await expect(explodingManager.recordExposure(user('u1'), 'test')).resolves.toBeUndefined();
    });

    it('recordExposure does nothing when no assignment exists', async () => {
      await manager.recordExposure(user('ghost'), 'test');
      expect(exposureEvents).toHaveLength(0);
    });

    it('onRollback hook errors do not propagate', async () => {
      const explodingManager = new CanaryManager({
        storage,
        hooks: {
          onRollback: () => { throw new Error('boom'); },
        },
      });
      await explodingManager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);
      await explodingManager.getVariant(user('u1'), 'test');
      // Should not throw
      await expect(explodingManager.rollback('test')).resolves.toBeUndefined();
    });
  });

  // ── Race condition handling ──────────────────────────────

  describe('race condition (SETNX lost)', () => {
    it('uses the winning assignment when saveAssignmentIfNotExists returns false', async () => {
      // Simulate: another process already saved an assignment between our check and save
      const raceStorage = new InMemoryStorage();
      const raceManager = new CanaryManager({ storage: raceStorage });

      await raceManager.createExperiment('test', [{ type: 'percentage', percentage: 100 }]);

      // Monkey-patch: first getAssignment returns null, saveAssignmentIfNotExists returns false,
      // second getAssignment returns the "winner"
      let callCount = 0;
      const originalGet = raceStorage.getAssignment.bind(raceStorage);
      jest.spyOn(raceStorage, 'getAssignment').mockImplementation(async (userId, expName) => {
        callCount++;
        if (callCount === 1) return null; // first check: no assignment
        // second check: race winner exists
        return {
          userId,
          experimentName: expName,
          variant: 'canary',
          assignedAt: '2026-01-01T00:00:00Z',
          reason: 'percentage',
        };
      });
      jest.spyOn(raceStorage, 'saveAssignmentIfNotExists').mockResolvedValue(false);

      const variant = await raceManager.getVariant(user('u1'), 'test');
      expect(variant).toBe('canary');
    });
  });

  // ── increaseRollout with mixed strategies ──────────────────

  describe('increaseRollout with mixed strategies', () => {
    it('only updates percentage strategy, preserves others', async () => {
      await manager.createExperiment('test', [
        { type: 'whitelist', userIds: ['alice'] },
        { type: 'percentage', percentage: 10 },
      ]);

      const updated = await manager.increaseRollout('test', 50);
      expect(updated.strategies).toEqual([
        { type: 'whitelist', userIds: ['alice'] },
        { type: 'percentage', percentage: 50 },
      ]);
    });
  });

  // ── Rollback on non-existent experiment ────────────────────

  describe('rollback edge cases', () => {
    it('rollback on non-existent experiment does not throw', async () => {
      await expect(manager.rollback('ghost')).resolves.toBeUndefined();
    });
  });

  // ── Default variant config ────────────────────────────────

  describe('custom default variant', () => {
    it('uses configured defaultVariant on degradation', async () => {
      const failingStorage = {
        getAssignment: () => { throw new Error('down'); },
        getExperiment: () => { throw new Error('down'); },
        saveAssignmentIfNotExists: () => { throw new Error('down'); },
      } as any;

      const m = new CanaryManager({ storage: failingStorage, defaultVariant: 'canary' });
      expect(await m.getVariant(user('u1'), 'test')).toBe('canary');
    });
  });

  // ── Custom strategy registration ──────────────────────────

  describe('registerStrategy', () => {
    it('can register and use a custom strategy', async () => {
      const customStrategy = {
        type: 'always-canary',
        evaluate: () => 'canary' as const,
      };
      manager.registerStrategy(customStrategy);

      await manager.createExperiment('test', [
        { type: 'always-canary' } as any,
      ]);

      expect(await manager.getVariant(user('u1'), 'test')).toBe('canary');
    });
  });

  describe('unknown strategy type', () => {
    it('skips unknown strategy types and falls through to default', async () => {
      await manager.createExperiment('test', [
        { type: 'nonexistent-strategy' } as any,
      ]);

      expect(await manager.getVariant(user('u1'), 'test')).toBe('stable');
    });
  });

  // ── Graceful degradation ───────────────────────────────────

  describe('graceful degradation', () => {
    it('returns stable when storage throws', async () => {
      const failingStorage = {
        getAssignment: () => { throw new Error('Redis down'); },
        getExperiment: () => { throw new Error('Redis down'); },
        saveAssignmentIfNotExists: () => { throw new Error('Redis down'); },
      } as any;

      const failManager = new CanaryManager({ storage: failingStorage });
      const variant = await failManager.getVariant(user('u1'), 'test');
      expect(variant).toBe('stable');
    });
  });
});
