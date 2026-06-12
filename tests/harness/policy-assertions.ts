import assert from "node:assert/strict";
import type {
  SideEffectPolicyClass,
  ToolPolicyDecisionFact,
  ToolPolicyDecisionKind,
} from "../../server/orchestrator/tool-contract.js";

type PolicyFactEvidence = ToolPolicyDecisionFact & {
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
  "ruleId",
  "proposalId",
  "turnId",
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

export function assertPolicyEvidenceHasNoForbiddenFields(value: unknown): void {
  visitEvidence(value, []);
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
