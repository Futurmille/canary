import {
  ICanaryStorage,
  CanaryExperiment,
  Assignment,
} from '../types';

/**
 * Type-only import — ioredis is an optional peer dependency.
 * Consumers must install it themselves.
 */
interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  setnx(key: string, value: string): Promise<number>;
}

export interface RedisStorageOptions {
  /** ioredis client instance */
  client: RedisClient;
  /** Key prefix — defaults to "canary:" */
  prefix?: string;
}

/**
 * Redis storage adapter with atomic SETNX for thread-safe sticky assignments.
 * Requires ioredis >=5 as a peer dependency.
 */
export class RedisStorage implements ICanaryStorage {
  private client: RedisClient;
  private prefix: string;

  constructor(options: RedisStorageOptions) {
    this.client = options.client;
    this.prefix = options.prefix ?? 'canary:';
  }

  private expKey(name: string): string {
    return `${this.prefix}exp:${name}`;
  }

  private assignKey(userId: string, experimentName: string): string {
    return `${this.prefix}assign:${experimentName}:${userId}`;
  }

  // ── Experiments ────────────────────────────────────────────

  async getExperiment(name: string): Promise<CanaryExperiment | null> {
    const raw = await this.client.get(this.expKey(name));
    return raw ? (JSON.parse(raw) as CanaryExperiment) : null;
  }

  async saveExperiment(experiment: CanaryExperiment): Promise<void> {
    await this.client.set(this.expKey(experiment.name), JSON.stringify(experiment));
  }

  async deleteExperiment(name: string): Promise<void> {
    await this.client.del(this.expKey(name));
  }

  async listExperiments(): Promise<CanaryExperiment[]> {
    const keys = await this.client.keys(`${this.prefix}exp:*`);
    if (keys.length === 0) return [];

    const results: CanaryExperiment[] = [];
    for (const key of keys) {
      const raw = await this.client.get(key);
      if (raw) results.push(JSON.parse(raw) as CanaryExperiment);
    }
    return results;
  }

  // ── Assignments ────────────────────────────────────────────

  async getAssignment(userId: string, experimentName: string): Promise<Assignment | null> {
    const raw = await this.client.get(this.assignKey(userId, experimentName));
    return raw ? (JSON.parse(raw) as Assignment) : null;
  }

  async saveAssignment(assignment: Assignment): Promise<void> {
    await this.client.set(
      this.assignKey(assignment.userId, assignment.experimentName),
      JSON.stringify(assignment),
    );
  }

  async deleteAssignment(userId: string, experimentName: string): Promise<void> {
    await this.client.del(this.assignKey(userId, experimentName));
  }

  async deleteAllAssignments(experimentName: string): Promise<number> {
    const pattern = `${this.prefix}assign:${experimentName}:*`;
    const keys = await this.client.keys(pattern);
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  /**
   * Atomic set-if-not-exists using Redis SETNX.
   * Guarantees exactly one process wins the assignment race.
   */
  async saveAssignmentIfNotExists(assignment: Assignment): Promise<boolean> {
    const key = this.assignKey(assignment.userId, assignment.experimentName);
    const result = await this.client.setnx(key, JSON.stringify(assignment));
    return result === 1;
  }
}
