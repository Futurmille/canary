import {
  ICanaryStorage,
  CanaryExperiment,
  Assignment,
} from '../types';

interface StoredAssignment {
  assignment: Assignment;
  expiresAt?: number; // epoch ms, undefined = no expiry
}

/**
 * In-memory storage adapter — ideal for tests and single-process dev servers.
 *
 * IMPORTANT: This adapter is NOT multi-process safe. The saveAssignmentIfNotExists
 * method uses a simple check-then-set pattern, which is fine for single-process
 * environments but not atomic across multiple processes. For multi-process
 * production deployments, use RedisStorage which uses atomic SETNX.
 */
export class InMemoryStorage implements ICanaryStorage {
  private experiments = new Map<string, CanaryExperiment>();
  private assignments = new Map<string, StoredAssignment>();

  private assignmentKey(userId: string, experimentName: string): string {
    return `${userId}:${experimentName}`;
  }

  private isExpired(stored: StoredAssignment): boolean {
    return stored.expiresAt !== undefined && Date.now() >= stored.expiresAt;
  }

  async getExperiment(name: string): Promise<CanaryExperiment | null> {
    return this.experiments.get(name) ?? null;
  }

  async saveExperiment(experiment: CanaryExperiment): Promise<void> {
    this.experiments.set(experiment.name, { ...experiment });
  }

  async deleteExperiment(name: string): Promise<void> {
    this.experiments.delete(name);
  }

  async listExperiments(): Promise<CanaryExperiment[]> {
    return Array.from(this.experiments.values());
  }

  async getAssignment(userId: string, experimentName: string): Promise<Assignment | null> {
    const stored = this.assignments.get(this.assignmentKey(userId, experimentName));
    if (!stored) return null;
    if (this.isExpired(stored)) {
      this.assignments.delete(this.assignmentKey(userId, experimentName));
      return null;
    }
    return stored.assignment;
  }

  async saveAssignment(assignment: Assignment): Promise<void> {
    const key = this.assignmentKey(assignment.userId, assignment.experimentName);
    this.assignments.set(key, { assignment: { ...assignment } });
  }

  async deleteAssignment(userId: string, experimentName: string): Promise<void> {
    this.assignments.delete(this.assignmentKey(userId, experimentName));
  }

  async deleteAllAssignments(experimentName: string): Promise<number> {
    let count = 0;
    for (const [key, stored] of this.assignments) {
      if (stored.assignment.experimentName === experimentName) {
        this.assignments.delete(key);
        count++;
      }
    }
    return count;
  }

  async saveAssignmentIfNotExists(assignment: Assignment, ttlSeconds?: number): Promise<boolean> {
    const key = this.assignmentKey(assignment.userId, assignment.experimentName);
    const existing = this.assignments.get(key);
    if (existing && !this.isExpired(existing)) {
      return false;
    }
    this.assignments.set(key, {
      assignment: { ...assignment },
      expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined,
    });
    return true;
  }

  /** Test helper — wipe all data */
  clear(): void {
    this.experiments.clear();
    this.assignments.clear();
  }
}
