jest.setTimeout(10000);

import { CanaryManager } from '../../../src/core/canary-manager';
import { InMemoryStorage } from '../../../src/storage/in-memory';

describe('Assignment TTL', () => {
  it('assignments expire after TTL (InMemoryStorage)', async () => {
    const storage = new InMemoryStorage();
    const manager = new CanaryManager({
      storage,
      assignmentTTLSeconds: 1, // 1 second TTL
    });

    await manager.createExperiment('test', [
      { type: 'percentage', percentage: 100 },
    ]);

    // First call: assigns canary
    const first = await manager.getVariant({ id: 'user-1' }, 'test');
    expect(first).toBe('canary');

    // Assignment exists in storage
    expect(await storage.getAssignment('user-1', 'test')).not.toBeNull();

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 1100));

    // Assignment expired — should be null
    expect(await storage.getAssignment('user-1', 'test')).toBeNull();

    // Next getVariant re-evaluates strategies (not cached)
    const afterExpiry = await manager.getVariant({ id: 'user-1' }, 'test');
    expect(afterExpiry).toBe('canary'); // still canary because strategy says so
  });

  it('assignments do not expire when TTL is 0', async () => {
    const storage = new InMemoryStorage();
    const manager = new CanaryManager({
      storage,
      assignmentTTLSeconds: 0, // no expiry
    });

    await manager.createExperiment('test', [
      { type: 'percentage', percentage: 100 },
    ]);

    await manager.getVariant({ id: 'user-1' }, 'test');

    // Assignment persists
    expect(await storage.getAssignment('user-1', 'test')).not.toBeNull();
  });

  it('assignments do not expire when TTL is not set', async () => {
    const storage = new InMemoryStorage();
    const manager = new CanaryManager({ storage });

    await manager.createExperiment('test', [
      { type: 'percentage', percentage: 100 },
    ]);

    await manager.getVariant({ id: 'user-1' }, 'test');
    expect(await storage.getAssignment('user-1', 'test')).not.toBeNull();
  });

  it('InMemoryStorage saveAssignmentIfNotExists respects TTL', async () => {
    const storage = new InMemoryStorage();

    const assignment = {
      userId: 'u1',
      experimentName: 'exp',
      variant: 'canary' as const,
      assignedAt: new Date().toISOString(),
      reason: 'test',
    };

    // Save with 1 second TTL
    const saved = await storage.saveAssignmentIfNotExists(assignment, 1);
    expect(saved).toBe(true);

    // Exists immediately
    expect(await storage.getAssignment('u1', 'exp')).not.toBeNull();

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 1100));

    // Expired
    expect(await storage.getAssignment('u1', 'exp')).toBeNull();

    // Can save again after expiry
    const savedAgain = await storage.saveAssignmentIfNotExists(assignment, 1);
    expect(savedAgain).toBe(true);
  });
});
