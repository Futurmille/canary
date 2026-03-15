import {
  ICanaryStorage,
  CanaryExperiment,
  Assignment,
} from '../types';

/**
 * In-memory storage adapter — ideal for tests and single-process dev servers.
 * NOT suitable for multi-process production deployments.
 */
export class InMemoryStorage implements ICanaryStorage {
  private experiments = new Map<string, CanaryExperiment>();
  private assignments = new Map<string, Assignment>(); // key: `${userId}:${experimentName}`

  private assignmentKey(userId: string, experimentName: string): string {
    return `${userId}:${experimentName}`;
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
    return this.assignments.get(this.assignmentKey(userId, experimentName)) ?? null;
  }

  async saveAssignment(assignment: Assignment): Promise<void> {
    const key = this.assignmentKey(assignment.userId, assignment.experimentName);
    this.assignments.set(key, { ...assignment });
  }

  async deleteAssignment(userId: string, experimentName: string): Promise<void> {
    this.assignments.delete(this.assignmentKey(userId, experimentName));
  }

  async deleteAllAssignments(experimentName: string): Promise<number> {
    let count = 0;
    for (const [key, assignment] of this.assignments) {
      if (assignment.experimentName === experimentName) {
        this.assignments.delete(key);
        count++;
      }
    }
    return count;
  }

  async saveAssignmentIfNotExists(assignment: Assignment): Promise<boolean> {
    const key = this.assignmentKey(assignment.userId, assignment.experimentName);
    if (this.assignments.has(key)) {
      return false;
    }
    this.assignments.set(key, { ...assignment });
    return true;
  }

  /** Test helper — wipe all data */
  clear(): void {
    this.experiments.clear();
    this.assignments.clear();
  }
}
