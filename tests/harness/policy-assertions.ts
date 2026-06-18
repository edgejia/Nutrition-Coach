import assert from "node:assert/strict";
import type {
  SideEffectPolicyClass,
  ToolPolicyDecisionFact,
  ToolPolicyDecisionKind,
} from "../../server/orchestrator/tool-contract.js";

type PolicyFactEvidence = ToolPolicyDecisionFact & {
  success?: unknown;
  executed?: unknown;
  turnId?: unknown;
};

export interface PolicyFactExpectation {
  tool: string;
  policyClass: SideEffectPolicyClass;
  decision: ToolPolicyDecisionKind;
  ruleId: string;
  proposalId?: string;
  requireTurnId?: boolean;
}

export interface PolicyDbInvariantExpectation {
  mealCountBefore?: number;
  mealCountAfter?: number;
  targetsChanged?: boolean;
  pendingConsumed?: boolean;
  pendingPreserved?: boolean;
  dailySummaryPublishCount?: number;
  goalsPublishCount?: number;
}

export interface VisibleOutcomeExpectation {
  keyLabels?: Record<string, boolean>;
  meaning?: Record<string, boolean>;
}

export const POLICY_EVIDENCE_FORBIDDEN_KEYS = new Set([
  "args",
  "arguments",
  "rawArguments",
  "toolArguments",
  "toolResult",
  "rawToolResult",
  "toolCall",
  "toolCalls",
  "toolResponse",
  "payload",
  "body",
  "headers",
  "providerPayload",
  "rawProviderPayload",
  "message",
  "messages",
  "rawMessages",
  "prompt",
  "rawPrompt",
  "promptText",
  "reply",
  "response",
  "assistantMessage",
  "assistantMessages",
  "assistantContent",
  "finalAnswer",
  "finalAssistantContent",
  "rawUserText",
  "rawUserMessage",
  "userMessage",
  "userMealText",
  "sessionMaterial",
  "guestSession",
  "sessionToken",
  "setCookie",
  "cookie",
  "token",
  "rawSse",
  "rawSseFrames",
  "rawSseTranscript",
  "sseTranscript",
  "streamFrames",
  "rawStreamFrames",
  "mealsSnapshot",
  "historySnapshot",
  "databaseSnapshot",
  "fullDbSnapshot",
  "imageData",
  "imageDataUri",
  "imageBase64",
  "uploadStagingPath",
]);

const POLICY_FACT_ALLOWED_KEYS = new Set([
  "tool",
  "policyClass",
  "decision",
  "success",
  "executed",
  "ruleId",
  "proposalId",
  "turnId",
]);

const POLICY_DB_INVARIANT_ALLOWED_KEYS = new Set([
  "mealCountBefore",
  "mealCountAfter",
  "targetsChanged",
  "pendingConsumed",
  "pendingPreserved",
  "dailySummaryPublishCount",
  "goalsPublishCount",
]);

const VISIBLE_OUTCOME_ALLOWED_KEYS = new Set([
  "keyLabels",
  "meaning",
]);

const NORMALIZED_FORBIDDEN_KEYS = new Map(
  [...POLICY_EVIDENCE_FORBIDDEN_KEYS].map((key) => [normalizeKey(key), key]),
);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertFieldEqual(
  actual: unknown,
  expected: unknown,
  field: string,
): void {
  assert.equal(actual, expected, `policy fact ${field} mismatch`);
}

function assertRequiredString(value: unknown, field: string): void {
  assert.equal(typeof value, "string", `policy fact ${field} must be a string`);
  assert.notEqual(value, "", `policy fact ${field} must not be empty`);
}

export function assertPolicyFact(
  fact: PolicyFactEvidence,
  expected: PolicyFactExpectation,
): void {
  assertPolicyEvidenceHasNoForbiddenFields(fact);

  for (const key of Object.keys(fact)) {
    assert.equal(
      POLICY_FACT_ALLOWED_KEYS.has(key),
      true,
      `policy fact ${key} is not an allowlisted metadata field`,
    );
  }

  assertFieldEqual(fact.tool, expected.tool, "tool");
  assertFieldEqual(fact.policyClass, expected.policyClass, "policyClass");
  assertFieldEqual(fact.decision, expected.decision, "decision");
  assertFieldEqual(fact.ruleId, expected.ruleId, "ruleId");

  if (expected.proposalId !== undefined) {
    assertFieldEqual(fact.proposalId, expected.proposalId, "proposalId");
  }

  if (expected.requireTurnId !== false) {
    assertRequiredString(fact.turnId, "turnId");
  }
}

export function assertPolicyDbInvariant(
  actual: Record<string, unknown>,
  expected: PolicyDbInvariantExpectation,
): void {
  assertPolicyEvidenceHasNoForbiddenFields(actual);
  assertOnlyAllowlistedKeys(actual, POLICY_DB_INVARIANT_ALLOWED_KEYS, "policy DB invariant");

  for (const [field, expectedValue] of Object.entries(expected)) {
    assert.equal(
      actual[field],
      expectedValue,
      `policy DB invariant ${field} mismatch`,
    );
  }
}

export function assertVisibleOutcomeSummary(
  actual: Record<string, unknown>,
  expected: VisibleOutcomeExpectation,
): void {
  assertPolicyEvidenceHasNoForbiddenFields(actual);
  assertOnlyAllowlistedKeys(actual, VISIBLE_OUTCOME_ALLOWED_KEYS, "visible outcome");

  assertBooleanMap(
    readOptionalRecord(actual.keyLabels, "keyLabels"),
    expected.keyLabels,
    "keyLabels",
  );
  assertBooleanMap(
    readOptionalRecord(actual.meaning, "meaning"),
    expected.meaning,
    "meaning",
  );
}

export function assertPolicyEvidenceHasNoForbiddenFields(value: unknown): void {
  visitEvidence(value, []);
}

function assertOnlyAllowlistedKeys(
  actual: Record<string, unknown>,
  allowedKeys: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(actual)) {
    assert.equal(
      allowedKeys.has(key),
      true,
      `${label} ${key} is not an allowlisted metadata field`,
    );
  }
}

function readOptionalRecord(value: unknown, field: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  assert.equal(
    value !== null && typeof value === "object" && !Array.isArray(value),
    true,
    `visible outcome ${field} must be an object`,
  );
  return value as Record<string, unknown>;
}

function assertBooleanMap(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, boolean> | undefined,
  label: string,
): void {
  if (expected === undefined) {
    return;
  }
  assert.notEqual(actual, undefined, `visible outcome ${label} missing`);
  for (const [field, expectedValue] of Object.entries(expected)) {
    assert.equal(
      actual?.[field],
      expectedValue,
      `visible outcome ${label}.${field} mismatch`,
    );
  }
}

function visitEvidence(value: unknown, path: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitEvidence(item, [...path, String(index)]));
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    const forbiddenKey = NORMALIZED_FORBIDDEN_KEYS.get(normalizeKey(key));
    const nextPath = [...path, key];
    assert.equal(
      forbiddenKey,
      undefined,
      `policy evidence forbidden field ${key} at ${nextPath.join(".")}`,
    );
    visitEvidence(nestedValue, nextPath);
  }
}
