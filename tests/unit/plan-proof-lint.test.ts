import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintPlanProof } from "../../scripts/workflow/plan-proof-lint.mjs";

const fixtures = fileURLToPath(new URL("../fixtures/workflow/plan-proof-lint/", import.meta.url));

function lint(name: string) {
  return lintPlanProof(fs.readFileSync(path.join(fixtures, name), "utf8"));
}

function ruleIds(result: ReturnType<typeof lintPlanProof>) {
  return new Set(result.findings.map((finding) => finding.ruleId));
}

describe("plan proof linter", () => {
  it("expected-rejection: rejects the historical all-of OR and self-authored pass marker family", () => {
    const result = lint("bad-all-of-or.md");
    assert.equal(result.status, "fail");
    assert.deepEqual(ruleIds(result), new Set(["PPL001", "PPL005"]));
  });

  it("rejects verify-time mutations and missing high-risk negative control", () => {
    const result = lint("bad-verify-mutation.md");
    const rules = ruleIds(result);
    assert.ok(rules.has("PPL003"));
    assert.ok(rules.has("PPL006"));
    assert.equal(result.findings.filter((finding) => finding.ruleId === "PPL003").length, 2);
  });

  it("rejects oversized inline evaluators, single-line proof, and upper-bound-only counts", () => {
    assert.ok(ruleIds(lint("bad-inline-eval.md")).has("PPL004"));
    const result = lint("bad-tail-cardinality.md");
    assert.ok(ruleIds(result).has("PPL002"));
    assert.ok(ruleIds(result).has("PPL007"));
  });

  it("rejects shell redirection mutations and strict-lower-bound-only counts", () => {
    const rules = ruleIds(lint("bad-redirection-lower-bound.md"));
    assert.ok(rules.has("PPL003"));
    assert.ok(rules.has("PPL007"));
  });

  it("rejects real GSD-escaped OR, redirection, lower-bound, and indirect build mutation", () => {
    const rules = ruleIds(lint("bad-gsd-escaped.md"));
    assert.ok(rules.has("PPL001"));
    assert.ok(rules.has("PPL003"));
    assert.ok(rules.has("PPL007"));
  });

  it("rejects a plan with no verification proof range", () => {
    assert.deepEqual(ruleIds(lint("bad-no-verify.md")), new Set(["PPL008"]));
  });

  it("rejects BRE alternation and last-command-wins search sequencing", () => {
    assert.ok(ruleIds(lint("bad-bre-or.md")).has("PPL001"));
    assert.ok(ruleIds(lint("bad-sequenced-search.md")).has("PPL001"));
  });

  it("rejects commands outside the closed read-only model", () => {
    const result = lint("bad-python-mutation.md");
    assert.equal(result.status, "fail");
    assert.ok(ruleIds(result).has("PPL003"));
  });

  it("rejects shell expansion, command-resolution, Git-config, and output-option bypasses", () => {
    const result = lint("bad-shell-evaluation-bypass.md");
    assert.equal(result.status, "fail");
    assert.equal(result.findings.filter((finding) => finding.ruleId === "PPL003").length, 6);
  });

  it("rejects actual-shell argv divergence and sed write programs", () => {
    const result = lint("bad-shell-argv-divergence.md");
    assert.equal(result.status, "fail");
    assert.equal(result.findings.filter((finding) => finding.ruleId === "PPL003").length, 5);
  });

  it("rejects attached and file-backed multi-pattern searches", () => {
    const result = lint("bad-search-option-variants.md");
    assert.equal(result.status, "fail");
    assert.equal(result.findings.filter((finding) => finding.ruleId === "PPL001").length, 2);
  });

  it("does not let an unrelated exact assertion suppress an upper-bound count", () => {
    const result = lint("bad-mixed-cardinality.md");
    assert.equal(result.status, "fail");
    assert.ok(ruleIds(result).has("PPL007"));
  });

  it("requires an executable structured high-risk negative control", () => {
    const result = lint("bad-negative-control-claim.md");
    assert.equal(result.status, "fail");
    assert.ok(ruleIds(result).has("PPL006"));
  });

  it("does not accept verification tags inside Markdown fences or HTML comments", () => {
    assert.deepEqual(ruleIds(lint("bad-fenced-comment-tags.md")), new Set(["PPL008"]));
    assert.deepEqual(ruleIds(lint("bad-short-fence-close.md")), new Set(["PPL008"]));
    assert.deepEqual(
      ruleIds(lintPlanProof("`<task><verify>rg 'example' docs/example.md</verify></task>`")),
      new Set(["PPL008"]),
    );
    assert.deepEqual(ruleIds(lint("bad-encoded-inline-tags.md")), new Set(["PPL008"]));
  });

  it("normalizes head/cardinality spellings and broad high-risk vocabulary", () => {
    const rules = ruleIds(lint("bad-spelling-variants.md"));
    assert.ok(rules.has("PPL002"));
    assert.ok(rules.has("PPL006"));
    assert.ok(rules.has("PPL007"));
  });

  it("does not accept crossed or unbalanced proof tags", () => {
    assert.deepEqual(ruleIds(lint("bad-unbalanced-proof-tags.md")), new Set(["PPL008"]));
  });

  it("requires actionable proof independently for every task", () => {
    const result = lint("bad-missing-task-proof.md");
    assert.deepEqual(result.findings, [
      {
        ruleId: "PPL008",
        line: 6,
        message: "plan contains no valid task-scoped verification or automated proof command",
      },
    ]);
    assert.deepEqual(ruleIds(lint("bad-inert-proof.md")), new Set(["PPL008"]));
  });

  it("rejects failure-masking OR across the complete shell command graph", () => {
    assert.ok(ruleIds(lint("bad-shell-mask.md")).has("PPL001"));
  });

  it("uses a closed Node test and workflow-checker grammar", () => {
    const result = lint("bad-node-grammar.md");
    assert.equal(result.findings.filter((finding) => finding.ruleId === "PPL003").length, 5);
  });

  it("rejects unapproved checkers and checker flags that cannot execute a negative control", () => {
    for (const command of [
      "node scripts/workflow/evil-check.mjs --negative-control=ignored",
      "node scripts/workflow/state-check.mjs --project-root=. --negative-control=ignored",
    ]) {
      const result = lintPlanProof(`
<task type="auto">
  <name>Unsafe checker substitution</name>
  <action>Validate production recovery.</action>
  <verify><automated>
    ${command}
  </automated></verify>
</task>
`);
      const rules = ruleIds(result);
      assert.ok(rules.has("PPL003"), command);
      assert.ok(rules.has("PPL006"), command);
      assert.ok(rules.has("PPL008"), command);
    }
  });

  it("requires Git's optional-lock guard for status proof", () => {
    const unsafe = lintPlanProof(`
<task type="auto">
  <name>Inspect repository state</name>
  <action>Read the worktree status.</action>
  <verify><automated>
    git status --short
  </automated></verify>
</task>
`);
    assert.ok(ruleIds(unsafe).has("PPL003"));
    assert.ok(ruleIds(unsafe).has("PPL008"));

    const guarded = lintPlanProof(`
<task type="auto">
  <name>Inspect repository state</name>
  <action>Read the worktree status.</action>
  <verify><automated>
    git --no-optional-locks status --short
  </automated></verify>
</task>
`);
    assert.equal(guarded.status, "pass");
    assert.deepEqual(guarded.findings, []);
  });

  it("rejects Yarn project-routing and caller-selected script arguments", () => {
    for (const command of [
      "yarn --cwd=/tmp test",
      "yarn test --cwd=/tmp",
      "yarn test --test-name-pattern=zero-match",
      "yarn workflow:state-check --project-root=/tmp",
    ]) {
      const result = lintPlanProof(`
<task type="auto">
  <name>Run a project proof</name>
  <action>Inspect bounded project evidence.</action>
  <verify><automated>
    ${command}
  </automated></verify>
</task>
`);
      assert.ok(ruleIds(result).has("PPL003"), command);
      assert.ok(ruleIds(result).has("PPL008"), command);
    }
  });

  it("rejects Node test selectors that can match or execute zero tests", () => {
    for (const command of [
      "node --test --test-only tests/unit/plan-proof-lint.test.ts",
      "node --test --test-name-pattern=zero-match tests/unit/plan-proof-lint.test.ts",
      "node --test --test-skip-pattern=.* tests/unit/plan-proof-lint.test.ts",
    ]) {
      const result = lintPlanProof(`
<task type="auto">
  <name>Run an exact test proof</name>
  <action>Execute the registered suite.</action>
  <verify><automated>
    ${command}
  </automated></verify>
</task>
`);
      assert.ok(ruleIds(result).has("PPL003"), command);
      assert.ok(ruleIds(result).has("PPL008"), command);
    }
  });

  it("requires the exact Phase 126 negative-control file for each product task", () => {
    const phase126Task = (subject: string, command: string) => lintPlanProof(`
phase: 126

<task type="auto">
  <name>${subject} boundary</name>
  <action>Prove the ${subject} database boundary behavior.</action>
  <verify><automated>
    ${command}
  </automated></verify>
</task>
`);

    const registered = [
      "tests/integration/phase-126-proposal-negative-controls.test.ts",
      "tests/integration/phase-126-admission-negative-controls.test.ts",
      "tests/integration/phase-126-ai-boundary-negative-controls.test.ts",
      "tests/integration/phase-126-privacy-negative-controls.test.ts",
    ];

    const subjects = ["proposal transaction", "admission", "AI safety", "privacy"];
    for (const [index, testPath] of registered.entries()) {
      const result = phase126Task(subjects[index]!, `node --import tsx --test ${testPath}`);
      assert.equal(result.status, "pass", testPath);
    }

    for (const command of [
      "node --import tsx --test --test-name-pattern=rollback tests/integration/phase-126-proposal-negative-controls.test.ts",
      "node --import tsx --test --test-skip-pattern=.* tests/integration/phase-126-proposal-negative-controls.test.ts",
      "node --import tsx --test tests/integration/phase-126-proposal-negative-controls.test.ts --test-only",
      "node --import tsx --test tests/integration/phase-126-unregistered-negative-controls.test.ts",
      "node --import tsx --test tests/unit/plan-proof-lint.test.ts",
      "printf phase-126-proposal-negative-controls",
    ]) {
      const rules = ruleIds(phase126Task("proposal transaction", command));
      assert.ok(rules.has("PPL006"), command);
    }
  });

  it("requires the exact Phase 127 negative-control file for each lifecycle task", () => {
    const phase127Task = (subject: string, command: string) => lintPlanProof(`
phase: 127

<task type="auto">
  <name>${subject} boundary</name>
  <action>Prove the ${subject} database/runtime boundary behavior.</action>
  <verify><automated>
    ${command}
  </automated></verify>
</task>
`);

    const registered = [
      ["meal correction snapshot", "tests/integration/phase-127-meal-snapshot-negative-controls.test.ts"],
      ["chat lifecycle disconnect", "tests/integration/phase-127-chat-lifecycle-negative-controls.test.ts"],
      ["goal PATCH", "tests/integration/phase-127-goal-patch-negative-controls.test.ts"],
      ["history trend range", "tests/integration/phase-127-history-bound-negative-controls.test.ts"],
      ["startup schema migration provenance", "tests/integration/phase-127-startup-schema-negative-controls.test.ts"],
    ] as const;

    for (const [subject, testPath] of registered) {
      const result = phase127Task(subject, `node --import tsx --test ${testPath}`);
      assert.equal(result.status, "pass", testPath);
    }

    for (const command of [
      "node --import tsx --test --test-name-pattern=rollback tests/integration/phase-127-meal-snapshot-negative-controls.test.ts",
      "node --import tsx --test --test-skip-pattern=.* tests/integration/phase-127-chat-lifecycle-negative-controls.test.ts",
      "node --import tsx --test tests/integration/phase-127-goal-patch-negative-controls.test.ts --test-only",
      "node --import tsx --test tests/integration/phase-127-unregistered-negative-controls.test.ts",
      "node --import tsx --test tests/unit/plan-proof-lint.test.ts",
      "printf phase-127-goal-patch-negative-controls",
    ]) {
      const rules = ruleIds(phase127Task("goal PATCH", command));
      assert.ok(rules.has("PPL006"), command);
    }
  });

  it("requires the exact Phase 128 negative-control file for each evidence and release task", () => {
    const phase128Task = (subject: string, command: string) => lintPlanProof(`
phase: 128

<task type="auto">
  <name>${subject} boundary</name>
  <action>Prove the ${subject} evidence or release boundary behavior.</action>
  <verify><automated>
    ${command}
  </automated></verify>
</task>
`);

    const registered = [
      ["artifact schema", "tests/integration/phase-128-artifact-negative-controls.test.ts"],
      ["SSE terminal lifecycle", "tests/integration/phase-128-sse-negative-controls.test.ts"],
      ["policy side effects", "tests/integration/phase-128-policy-side-effect-negative-controls.test.ts"],
      ["harness lifecycle CAS publication", "tests/integration/phase-128-harness-lifecycle-negative-controls.test.ts"],
      ["Git authority", "tests/integration/phase-128-git-authority-negative-controls.test.ts"],
      ["policy taxonomy", "tests/integration/phase-128-policy-taxonomy-negative-controls.test.ts"],
      ["advisory evidence", "tests/integration/phase-128-advisory-negative-controls.test.ts"],
      ["readiness disposition", "tests/integration/phase-128-readiness-audit-negative-controls.test.ts"],
    ] as const;

    for (const [subject, testPath] of registered) {
      const result = phase128Task(subject, `node --import tsx --test ${testPath}`);
      assert.equal(result.status, "pass", testPath);
    }

    for (const command of [
      "node --import tsx --test --test-name-pattern=terminal tests/integration/phase-128-sse-negative-controls.test.ts",
      "node --import tsx --test --test-skip-pattern=.* tests/integration/phase-128-policy-side-effect-negative-controls.test.ts",
      "node --import tsx --test tests/integration/phase-128-harness-lifecycle-negative-controls.test.ts --test-only",
      "node --import tsx --test tests/integration/phase-128-unregistered-negative-controls.test.ts",
      "node --import tsx --test tests/unit/plan-proof-lint.test.ts",
      "printf phase-128-artifact-negative-controls",
    ]) {
      const rules = ruleIds(phase128Task("artifact storage", command));
      assert.ok(rules.size > 0, command);
    }
  });

  it("rejects executable search options and parses attached short-option clusters", () => {
    const executable = lint("bad-search-executable-options.md");
    assert.equal(executable.findings.filter((finding) => finding.ruleId === "PPL003").length, 3);
    assert.ok(ruleIds(lint("bad-search-cluster.md")).has("PPL001"));
  });

  it("rejects unresolved variables, ANSI-C strings, globs, and brace expansion", () => {
    const result = lint("bad-unresolved-expansion.md");
    assert.equal(result.findings.filter((finding) => finding.ruleId === "PPL003").length, 6);
  });

  it("does not treat bare command negation as a structured negative control", () => {
    const rules = ruleIds(lint("bad-bare-negation.md"));
    assert.ok(rules.has("PPL006"));
    assert.ok(rules.has("PPL008"));
  });

  it("passes per-item exact proof, legitimate annotated alternatives, and high-risk counterexamples", () => {
    for (const fixture of [
      "good-exact-negative-control.md",
      "good-legitimate-alternatives.md",
      "good-high-risk-counterexample.md",
    ]) {
      assert.deepEqual(lint(fixture), {
        schemaVersion: 1,
        kind: "plan_proof_lint",
        status: "pass",
        findings: [],
      });
    }
  });

  it("emits deterministic line-numbered CLI findings", () => {
    const plan = path.join(fixtures, "bad-all-of-or.md");
    const result = spawnSync(process.execPath, ["scripts/workflow/plan-proof-lint.mjs", `--plan=${plan}`], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(result.status, 1, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.status, "fail");
    assert.deepEqual(
      parsed.findings.map((finding: { ruleId: string; line: number }) => [finding.ruleId, finding.line]),
      [
        ["PPL001", 6],
        ["PPL005", 7],
      ],
    );
    assert.doesNotMatch(result.stdout, new RegExp(fixtures.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
