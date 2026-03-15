import {
  ICanaryStorage,
  CanaryExperiment,
  Assignment,
} from '../types';

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string | null>;
  set(key: string, value: string, expiryMode: string, time: number): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  setnx(key: string, value: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  scanStream(options: { match: string; count?: number }): {
    [Symbol.asyncIterator](): AsyncIterableIterator<string[]>;
  };
}

export interface RedisStorageOptions {
  client: RedisClient;
  /** Key prefix (default: "canary:") */
  prefix?: string;
}

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

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    const stream = this.client.scanStream({ match: pattern, count: 100 });
    for await (const batch of stream) {
      keys.push(...batch);
    }
    return keys;
  }

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
    const keys = await this.scanKeys(`${this.prefix}exp:*`);
    if (keys.length === 0) return [];

    const results: CanaryExperiment[] = [];
    for (const key of keys) {
      const raw = await this.client.get(key);
      if (raw) results.push(JSON.parse(raw) as CanaryExperiment);
    }
    return results;
  }

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
    const keys = await this.scanKeys(pattern);
    if (keys.length === 0) return 0;

    let deleted = 0;
    const batchSize = 1000;
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      deleted += await this.client.del(...batch);
    }
    return deleted;
  }

  async saveAssignmentIfNotExists(assignment: Assignment, ttlSeconds?: number): Promise<boolean> {
    const key = this.assignKey(assignment.userId, assignment.experimentName);
    const result = await this.client.setnx(key, JSON.stringify(assignment));
    if (result === 1 && ttlSeconds && ttlSeconds > 0) {
      await this.client.expire(key, ttlSeconds);
    }
    return result === 1;
  }
}
