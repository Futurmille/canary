export type Variant = string;
export type BuiltInVariant = 'stable' | 'canary';

export interface CanaryUser {
  id: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface CanaryExperiment {
  name: string;
  description?: string;
  enabled: boolean;
  strategies: StrategyConfig[];
  variants?: string[];
  createdAt: string;
  updatedAt: string;
}

export type StrategyConfig =
  | PercentageStrategyConfig
  | WhitelistStrategyConfig
  | AttributeStrategyConfig;

export interface PercentageStrategyConfig {
  type: 'percentage';
  /** 0-100 */
  percentage: number;
  /** Target variant for matched users (default: 'canary') */
  variant?: string;
}

export interface WhitelistStrategyConfig {
  type: 'whitelist';
  userIds: string[];
  /** Target variant for matched users (default: 'canary') */
  variant?: string;
}

export interface AttributeStrategyConfig {
  type: 'attribute';
  attribute: string;
  values: Array<string | number | boolean>;
  /** Target variant for matched users (default: 'canary') */
  variant?: string;
}

export interface Assignment {
  userId: string;
  experimentName: string;
  variant: Variant;
  assignedAt: string;
  reason: string;
}

export interface AssignmentEvent {
  user: CanaryUser;
  experiment: string;
  variant: Variant;
  reason: string;
  cached: boolean;
}

export interface ExposureEvent {
  user: CanaryUser;
  experiment: string;
  variant: Variant;
}

export interface RollbackEvent {
  experiment: string;
  previousAssignments: number;
}

export interface CanaryHooks {
  onAssignment?: (event: AssignmentEvent) => void | Promise<void>;
  onExposure?: (event: ExposureEvent) => void | Promise<void>;
  onRollback?: (event: RollbackEvent) => void | Promise<void>;
}

export interface CanaryConfig {
  storage: ICanaryStorage;
  hooks?: CanaryHooks;
  defaultVariant?: Variant;
  /** TTL for sticky assignments in seconds. 0 = no expiry (default). */
  assignmentTTLSeconds?: number;
}

export interface ICanaryStorage {
  getExperiment(name: string): Promise<CanaryExperiment | null>;
  saveExperiment(experiment: CanaryExperiment): Promise<void>;
  deleteExperiment(name: string): Promise<void>;
  listExperiments(): Promise<CanaryExperiment[]>;

  getAssignment(userId: string, experimentName: string): Promise<Assignment | null>;
  saveAssignment(assignment: Assignment, ttlSeconds?: number): Promise<void>;
  deleteAssignment(userId: string, experimentName: string): Promise<void>;
  deleteAllAssignments(experimentName: string): Promise<number>;

  saveAssignmentIfNotExists(assignment: Assignment, ttlSeconds?: number): Promise<boolean>;
}

export interface IAssignmentStrategy {
  readonly type: string;
  evaluate(user: CanaryUser, config: StrategyConfig): Variant | null;
}
