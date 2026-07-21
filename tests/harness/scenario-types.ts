/**
 * Shared type contracts for the deterministic verification harness.
 *
 * Later plans import these types to define named scenarios without embedding
 * scenario-specific logic in the foundation helpers.
 */

import type { FastifyInstance } from "fastify";
import type { ScenarioAppFactory, ScenarioAppOptions, ScenarioAppServices } from "./app-fixture.js";
import type { LLMProvider } from "../../server/llm/types.js";

/**
 * Context passed into each scenario's `run()` method.
 * Contains the bootstrapped app, its listening address, and the seeded device ID.
 */
export interface ScenarioContext {
  app: FastifyInstance;
  address: string;
  deviceId: string;
  cookieHeader: string;
  services: ScenarioAppServices;
  llmProvider: LLMProvider;
  /** Runner-owned factory for isolated nested fixtures; the runner closes them. */
  createApp: ScenarioAppFactory;
  prepared?: unknown;
  signal?: AbortSignal;
}

export interface ScenarioAppPreparation {
  appOptions?: ScenarioAppOptions;
  state?: unknown;
}

/**
 * Evidence captured for a single named step within a scenario.
 */
export interface ScenarioStepResult {
  /** Human-readable step name, e.g. "send-chat-message" */
  name: string;
  /** Whether this step passed */
  ok: boolean;
  /** Actual observed value / payload at this step (redacted before persistence) */
  actual?: unknown;
  /** Expected value or assertion description (optional) */
  expected?: unknown;
  /** Error message if the step threw or an assertion failed */
  error?: string;
  /** Fixed failure category for metadata-only persistence */
  errorCategory?: ScenarioErrorCategory;
}

export type ScenarioErrorCategory =
  | "assertion_failed"
  | "boot_failed"
  | "seed_failed"
  | "listen_failed"
  | "scenario_failed"
  | "close_failed"
  | "interrupted"
  | "artifact_allowlist_violation";

export interface ScenarioFileReference {
  path: string;
  sha256: string;
  byteLength: number;
}

export interface ScenarioTraceMetadata {
  eventNames: string[];
  counts: Record<string, number>;
}

export interface ScenarioPolicyFactMetadata {
  step: string;
  tool: string;
  policyClass: "direct-execute" | "execute-and-report" | "clarify-first" | "confirm-first";
  decision: "allowed" | "blocked";
  ruleId: string;
}

export interface ScenarioPolicyDbInvariantMetadata {
  step: string;
  mealCountBefore?: number;
  mealCountAfter?: number;
  targetsChanged?: boolean;
  pendingConsumed?: boolean;
  pendingPreserved?: boolean;
  dailySummaryPublishCount?: number;
  goalsPublishCount?: number;
  proposalCardCount?: number;
  actionEventCount?: number;
  mutationOutcomeCount?: number;
  proposalCardPresent?: boolean;
  proposalCardKindMatches?: boolean;
  proposalCardProposalIdMatches?: boolean;
}

export interface ScenarioVisibleOutcomeMetadata {
  step: string;
  keyLabels?: Record<string, boolean>;
  meaning?: Record<string, boolean>;
}

/** Positive metadata-only input accepted by the Phase 128 artifact writer. */
export interface ScenarioMetadata {
  scenarioId: string;
  scenarioName: string;
  status: "pass" | "fail";
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  counts?: Record<string, number>;
  assertions?: Record<string, boolean | number>;
  files?: ScenarioFileReference[];
  trace?: ScenarioTraceMetadata;
  policyFacts?: ScenarioPolicyFactMetadata[];
  policyDbInvariants?: ScenarioPolicyDbInvariantMetadata[];
  visibleOutcomes?: ScenarioVisibleOutcomeMetadata[];
  errorCategory?: ScenarioErrorCategory;
}

/**
 * Full result of executing a verification scenario.
 */
export interface ScenarioResult {
  /** Overall pass/fail */
  ok: boolean;
  /** Name of the first failing step, if any */
  failedStep?: string;
  /** Ordered step evidence */
  steps: ScenarioStepResult[];
  /** Arbitrary JSON evidence blobs (request headers, SSE transcript, DB snapshot, etc.) */
  artifacts: Record<string, unknown>;
  /** Strict positive-schema evidence. When present, arbitrary artifacts are rejected. */
  metadata?: ScenarioMetadata;
  /** Optional allowlisted LLM trace persisted as latest/llm-trace.json */
  llmTrace?: Record<string, unknown>;
  /** Single-line console summary: "PASS text-log 7/7" or "FAIL image-log verify_meals" */
  consoleSummary: string;
}

/**
 * A named, self-contained verification scenario.
 * Scenarios receive a pre-booted `ScenarioContext` and return a `ScenarioResult`.
 * They must not start their own servers or depend on live-model access.
 */
export interface VerificationScenario {
  name: string;
  prepareApp?: () => ScenarioAppPreparation | Promise<ScenarioAppPreparation>;
  run(ctx: ScenarioContext): Promise<ScenarioResult>;
}
