// ─── Variant ────────────────────────────────────────────────
export type Variant = string;
export type BuiltInVariant = 'stable' | 'canary';

// ─── User context passed to every assignment decision ───────
export interface CanaryUser {
  id: string;
  attributes?: Record<string, string | number | boolean>;
}

// ─── Experiment definition ──────────────────────────────────
export interface CanaryExperiment {
  /** Unique experiment identifier */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Whether the experiment is accepting new assignments */
  enabled: boolean;
  /** Strategy configurations — evaluated in order, first match wins */
  strategies: StrategyConfig[];
  /** Available variants for this experiment (default: ['stable', 'canary']) */
  variants?: string[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last modification */
  updatedAt: string;
}

// ─── Strategy configuration (stored with experiment) ────────
export type StrategyConfig =
  | PercentageStrategyConfig
  | WhitelistStrategyConfig
  | AttributeStrategyConfig;

export interface PercentageStrategyConfig {
  type: 'percentage';
  percentage: number; // 0-100
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

// ─── Assignment record (what gets persisted) ────────────────
export interface Assignment {
  userId: string;
  experimentName: string;
  variant: Variant;
  assignedAt: string;
  reason: string;
}

// ─── Observability event payloads ───────────────────────────
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

// ─── Event hooks ────────────────────────────────────────────
export interface CanaryHooks {
  onAssignment?: (event: AssignmentEvent) => void | Promise<void>;
  onExposure?: (event: ExposureEvent) => void | Promise<void>;
  onRollback?: (event: RollbackEvent) => void | Promise<void>;
}

// ─── Top-level configuration ────────────────────────────────
export interface CanaryConfig {
  storage: ICanaryStorage;
  hooks?: CanaryHooks;
  /** Default variant when experiment is disabled or on error */
  defaultVariant?: Variant;
  /** TTL for sticky assignments in seconds. 0 = no expiry (default). */
  assignmentTTLSeconds?: number;
}

// ─── Storage port ───────────────────────────────────────────
export interface ICanaryStorage {
  // Experiment CRUD
  getExperiment(name: string): Promise<CanaryExperiment | null>;
  saveExperiment(experiment: CanaryExperiment): Promise<void>;
  deleteExperiment(name: string): Promise<void>;
  listExperiments(): Promise<CanaryExperiment[]>;

  // Assignment persistence (sticky sessions)
  getAssignment(userId: string, experimentName: string): Promise<Assignment | null>;
  saveAssignment(assignment: Assignment): Promise<void>;
  deleteAssignment(userId: string, experimentName: string): Promise<void>;
  deleteAllAssignments(experimentName: string): Promise<number>;

  // Atomic "set if not exists" — for thread-safe sticky assignment
  // ttlSeconds: optional TTL in seconds (0 or undefined = no expiry)
  saveAssignmentIfNotExists(assignment: Assignment, ttlSeconds?: number): Promise<boolean>;
}

// ─── Strategy port ──────────────────────────────────────────
export interface IAssignmentStrategy {
  readonly type: string;
  evaluate(user: CanaryUser, config: StrategyConfig): Variant | null;
}
