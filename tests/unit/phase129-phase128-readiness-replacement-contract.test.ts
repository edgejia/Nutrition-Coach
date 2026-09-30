import assert from "node:assert/strict";
import test from "node:test";

export const PHASE_129_READINESS_REPLACEMENT = {
  sourceScope: "source_release_only",
  status: "deferred",
  verdict: "NO-GO",
} as const;

export type DeferredReadinessInvariant = {
  sourceScope: string;
  status: string;
  verdict: string;
};

const EXPECTED_KEYS = ["sourceScope", "status", "verdict"] as const;

/** Execute the named replacement's semantic deferred-readiness invariant. */
export function assertDeferredReadinessInvariant(
  candidate: DeferredReadinessInvariant = PHASE_129_READINESS_REPLACEMENT,
): void {
  assert.deepEqual(Object.keys(candidate), EXPECTED_KEYS);
  assert.equal(candidate.sourceScope, "source_release_only", "sourceScope invariant");
  assert.equal(candidate.status, "deferred", "status invariant");
  assert.equal(candidate.verdict, "NO-GO", "verdict invariant");
}

/** Prove that a mutation of any deferred-NO-GO field fails closed. */
export function assertDeferredReadinessMutationNegativeControl(): void {
  const mutations: Array<[keyof DeferredReadinessInvariant, string]> = [
    ["sourceScope", "runtime_and_source"],
    ["status", "ready"],
    ["verdict", "GO"],
  ];
  for (const [field, value] of mutations) {
    const mutated = { ...PHASE_129_READINESS_REPLACEMENT, [field]: value };
    assert.throws(
      () => assertDeferredReadinessInvariant(mutated),
      new RegExp(`${field}`),
      `mutation of ${field} must fail the replacement invariant`,
    );
  }
}

test("named replacement preserves the deferred source/release NO-GO invariant", () => {
  assertDeferredReadinessInvariant();
});

test("named replacement rejects mutations to scope, status, and verdict", () => {
  assertDeferredReadinessMutationNegativeControl();
});
