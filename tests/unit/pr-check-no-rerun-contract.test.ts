import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";

const workflowUrl = new URL("../../.github/workflows/pr-check.yml", import.meta.url);

describe("PR Check no-rerun contract", () => {
  it("keeps PR policy, setup, and one base-bound release gate", async () => {
    const workflow = await fs.readFile(workflowUrl, "utf8");
    const committedWorkflow = execFileSync("git", ["show", "HEAD:.github/workflows/pr-check.yml"], { encoding: "utf8" });

    // The Plan 04 contract is self-contained: a dirty release-check dependency
    // must not change what this test proves about the committed workflow.
    assert.equal(workflow, committedWorkflow);

    assert.match(workflow, /on:\n\s+pull_request:\n\s+branches:\n\s+- main/);
    assert.match(workflow, /- name: Run PR policy\n\s+run: yarn pr:policy/);
    assert.match(workflow, /- name: Install dependencies\n\s+run: yarn install --frozen-lockfile/);
    assert.match(workflow, /- name: Prepare CI environment\n\s+run: cp \.env\.example \.env/);

    const releaseCommands = workflow.match(/yarn release:check --base="origin\/\$\{RELEASE_BASE_REF\}"/g) ?? [];
    assert.equal(releaseCommands.length, 1);
  });

  it("rejects a post-failure full-suite rerun and caller-controlled base input", async () => {
    const workflow = await fs.readFile(workflowUrl, "utf8");

    assert.doesNotMatch(workflow, /\byarn test\b/);
    assert.doesNotMatch(workflow, /Report failing test names|steps\.release_gate\.outcome|always\(\)/);
    assert.doesNotMatch(workflow, /inputs(?:\.|\s*:)/);
    assert.doesNotMatch(workflow, /base_ref:\s*\$\{\{\s*inputs\./);
  });

  it("retains bounded first-failure diagnostics and success ordering", async () => {
    const workflow = await fs.readFile(workflowUrl, "utf8");
    const steps = [
      "- name: Run PR policy",
      "- name: Install dependencies",
      "- name: Prepare CI environment",
      "- name: Run release gate",
    ].map((step) => workflow.indexOf(step));
    assert.ok(steps.every((index) => index >= 0), "all bounded diagnostics/setup steps must remain present");
    assert.ok(steps.every((index, position) => position === 0 || steps[position - 1] < index), "setup and diagnostics must precede the release gate");
    assert.equal(workflow.match(/yarn release:check --base="origin\/\$\{RELEASE_BASE_REF\}"/g)?.length, 1);
    assert.doesNotMatch(workflow, /\byarn test\b|always\(\)|steps\.release_gate\.outcome/);
    assert.doesNotMatch(workflow, /publishPassedCommandReceipt|workflow-lease|command-receipt/);
  });
});
