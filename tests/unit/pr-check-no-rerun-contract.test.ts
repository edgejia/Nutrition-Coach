import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";

const workflowUrl = new URL("../../.github/workflows/pr-check.yml", import.meta.url);
const releaseCheckUrl = new URL("../../scripts/release-check.mjs", import.meta.url);

describe("PR Check no-rerun contract", () => {
  it("keeps PR policy, setup, and one base-bound release gate", async () => {
    const workflow = await fs.readFile(workflowUrl, "utf8");

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
    const releaseCheck = await fs.readFile(releaseCheckUrl, "utf8");

    assert.match(releaseCheck, /MAX_RELEASE_DURATION_MS = 18 \* 60 \* 1000/);
    assert.match(releaseCheck, /MAX_DIAGNOSTIC_BYTES/);
    assert.match(releaseCheck, /signalChildGroup\(child, "SIGTERM"\)/);
    assert.match(releaseCheck, /signalChildGroup\(child, "SIGKILL"\)/);
    assert.match(releaseCheck, /stableWorkspaceFingerprint/);
    assert.match(releaseCheck, /workspaceAfterSha256 !== workspaceBeforeSha256/);
    assert.match(releaseCheck, /function printGateFailure\(label, gate, result\)/);
    assert.match(releaseCheck, /sanitizedCode: RELEASE_FAILURE_CODES\[gate\]/);
    assert.match(releaseCheck, /output: result\?\.diagnostics/);
    assert.doesNotMatch(releaseCheck, /publishPassedCommandReceipt|workflow-lease|command-receipt/);

    const reportIndex = releaseCheck.indexOf("printGateFailure(label, gate, result);");
    const throwIndex = releaseCheck.indexOf("throw new ReleaseGateFailure(label, gate, result);");
    const passIndex = releaseCheck.indexOf('if (process.exitCode !== 1) console.log("\\n[release-check] PASS")');
    const workspaceAfterIndex = releaseCheck.indexOf("const workspaceAfterSha256 = stableWorkspaceFingerprint();");

    assert.ok(reportIndex >= 0 && reportIndex < throwIndex, "failure report must precede gate propagation");
    assert.ok(workspaceAfterIndex >= 0 && workspaceAfterIndex < passIndex, "success must follow workspace verification");
  });
});
