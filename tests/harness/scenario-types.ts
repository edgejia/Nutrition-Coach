/**
 * Shared type contracts for the deterministic verification harness.
 *
 * Later plans import these types to define named scenarios without embedding
 * scenario-specific logic in the foundation helpers.
 */

import type { FastifyInstance } from "fastify";

/**
 * Context passed into each scenario's `run()` method.
 * Contains the bootstrapped app, its listening address, and the seeded device ID.
 */
export interface ScenarioContext {
  app: FastifyInstance;
  address: string;
  deviceId: string;
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
  run(ctx: ScenarioContext): Promise<ScenarioResult>;
}
