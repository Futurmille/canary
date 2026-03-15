import {
  CanaryConfig,
  CanaryExperiment,
  CanaryUser,
  IAssignmentStrategy,
  ICanaryStorage,
  CanaryHooks,
  StrategyConfig,
  Assignment,
  Variant,
} from '../types';
import { PercentageStrategy } from '../strategies/percentage';
import { WhitelistStrategy } from '../strategies/whitelist';
import { AttributeStrategy } from '../strategies/attribute';

export class CanaryManager {
  private storage: ICanaryStorage;
  private hooks: CanaryHooks;
  private defaultVariant: Variant;
  private assignmentTTLSeconds: number;
  private strategies: Map<string, IAssignmentStrategy>;

  constructor(config: CanaryConfig) {
    this.storage = config.storage;
    this.hooks = config.hooks ?? {};
    this.defaultVariant = config.defaultVariant ?? 'stable';
    this.assignmentTTLSeconds = config.assignmentTTLSeconds ?? 0;

    this.strategies = new Map<string, IAssignmentStrategy>();
    this.registerStrategy(new PercentageStrategy());
    this.registerStrategy(new WhitelistStrategy());
    this.registerStrategy(new AttributeStrategy());
  }

  registerStrategy(strategy: IAssignmentStrategy): void {
    this.strategies.set(strategy.type, strategy);
  }

  async createExperiment(
    name: string,
    strategies: StrategyConfig[],
    description?: string,
  ): Promise<CanaryExperiment> {
    const now = new Date().toISOString();
    const experiment: CanaryExperiment = {
      name,
      description,
      enabled: true,
      strategies,
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.saveExperiment(experiment);
    return experiment;
  }

  async getExperiment(name: string): Promise<CanaryExperiment | null> {
    return this.storage.getExperiment(name);
  }

  async listExperiments(): Promise<CanaryExperiment[]> {
    return this.storage.listExperiments();
  }

  async updateExperiment(
    name: string,
    updates: Partial<Pick<CanaryExperiment, 'enabled' | 'strategies' | 'description'>>,
  ): Promise<CanaryExperiment> {
    const existing = await this.storage.getExperiment(name);
    if (!existing) throw new Error(`Experiment "${name}" not found`);

    const updated: CanaryExperiment = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    await this.storage.saveExperiment(updated);
    return updated;
  }

  async deleteExperiment(name: string): Promise<void> {
    await this.storage.deleteAllAssignments(name);
    await this.storage.deleteExperiment(name);
  }

  /**
   * Resolve which variant a user should see.
   *
   * 1. Check sticky assignment in storage
   * 2. If experiment disabled → defaultVariant
   * 3. Evaluate strategies in order, first match wins
   * 4. Persist atomically (SETNX) with optional TTL
   * 5. Fire onAssignment hook
   *
   * On storage error → graceful degradation to defaultVariant.
   */
  async getVariant(user: CanaryUser, experimentName: string): Promise<Variant> {
    try {
      const existing = await this.storage.getAssignment(user.id, experimentName);
      if (existing) {
        this.fireAssignment(user, experimentName, existing.variant, existing.reason, true);
        return existing.variant;
      }

      const experiment = await this.storage.getExperiment(experimentName);
      if (!experiment || !experiment.enabled) {
        return this.defaultVariant;
      }

      let variant: Variant = this.defaultVariant;
      let reason = 'no-strategy-matched';

      for (const strategyConfig of experiment.strategies) {
        const strategy = this.strategies.get(strategyConfig.type);
        if (!strategy) continue;

        const result = strategy.evaluate(user, strategyConfig);
        if (result !== null) {
          variant = result;
          reason = `${strategyConfig.type}`;
          break;
        }
      }

      const assignment: Assignment = {
        userId: user.id,
        experimentName,
        variant,
        assignedAt: new Date().toISOString(),
        reason,
      };

      const ttl = this.assignmentTTLSeconds;
      const saved = await this.storage.saveAssignmentIfNotExists(assignment, ttl > 0 ? ttl : undefined);
      if (!saved) {
        const raceWinner = await this.storage.getAssignment(user.id, experimentName);
        if (raceWinner) {
          this.fireAssignment(user, experimentName, raceWinner.variant, raceWinner.reason, true);
          return raceWinner.variant;
        }
      }

      this.fireAssignment(user, experimentName, variant, reason, false);
      return variant;
    } catch {
      return this.defaultVariant;
    }
  }

  async recordExposure(user: CanaryUser, experimentName: string): Promise<void> {
    const assignment = await this.storage.getAssignment(user.id, experimentName);
    if (assignment && this.hooks.onExposure) {
      try {
        await this.hooks.onExposure({
          user,
          experiment: experimentName,
          variant: assignment.variant,
        });
      } catch {
        // never break the caller
      }
    }
  }

  async increaseRollout(experimentName: string, newPercentage: number): Promise<CanaryExperiment> {
    if (newPercentage < 0 || newPercentage > 100) {
      throw new Error('Percentage must be between 0 and 100');
    }

    const experiment = await this.storage.getExperiment(experimentName);
    if (!experiment) throw new Error(`Experiment "${experimentName}" not found`);

    const strategies = experiment.strategies.map((s) => {
      if (s.type === 'percentage') {
        return { ...s, percentage: newPercentage };
      }
      return s;
    });

    return this.updateExperiment(experimentName, { strategies });
  }

  async rollback(experimentName: string): Promise<void> {
    const cleared = await this.storage.deleteAllAssignments(experimentName);

    const experiment = await this.storage.getExperiment(experimentName);
    if (experiment) {
      await this.updateExperiment(experimentName, { enabled: false });
    }

    if (this.hooks.onRollback) {
      try {
        await this.hooks.onRollback({
          experiment: experimentName,
          previousAssignments: cleared,
        });
      } catch {
        // never break the caller
      }
    }
  }

  private fireAssignment(
    user: CanaryUser,
    experiment: string,
    variant: Variant,
    reason: string,
    cached: boolean,
  ): void {
    if (this.hooks.onAssignment) {
      try {
        void this.hooks.onAssignment({ user, experiment, variant, reason, cached });
      } catch {
        // never break the caller
      }
    }
  }
}
