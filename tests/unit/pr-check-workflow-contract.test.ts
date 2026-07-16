import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";

const workflowUrl = new URL("../../.github/workflows/pr-check.yml", import.meta.url);
const manualWorkflowUrl = new URL("../../.github/workflows/manual-release-diagnostic.yml", import.meta.url);
const runbookUrl = new URL("../../docs/codex-pr-ci.md", import.meta.url);

describe("PR Check workflow enforcement contract", () => {
  it("keeps the required PR context unreachable from manual dispatch", async () => {
    const source = await fs.readFile(workflowUrl, "utf8");
    const manual = await fs.readFile(manualWorkflowUrl, "utf8");

    assert.match(source, /pull_request:/);
    assert.doesNotMatch(source, /workflow_dispatch|github\.event_name/);
    assert.match(source, /name: Release Check/);
    assert.match(source, /RELEASE_BASE_REF: \$\{\{ github\.base_ref \}\}/);
    assert.match(source, /- name: Run PR policy\n\s+run: yarn pr:policy/);

    assert.match(manual, /workflow_dispatch:/);
    assert.match(manual, /name: Manual Release Diagnostic/);
    assert.match(manual, /RELEASE_BASE_REF: main/);
    assert.doesNotMatch(manual, /name: Release Check|Run PR policy/);
  });

  it("removes caller-controlled base arguments and quotes the one release-check argv", async () => {
    const sources = `${await fs.readFile(workflowUrl, "utf8")}\n${await fs.readFile(manualWorkflowUrl, "utf8")}`;
    assert.doesNotMatch(sources, /inputs:|inputs\.base_ref|base_ref:/);
    assert.doesNotMatch(sources, /--dry-run|--base=origin\/\$\{RELEASE_BASE_REF\}/);
    assert.equal(sources.match(/yarn release:check --base="origin\/\$\{RELEASE_BASE_REF\}"/g)?.length, 2);
  });

  it("documents timeout observability and the mutable-workflow residual without overstating proof", async () => {
    const runbook = await fs.readFile(runbookUrl, "utf8");
    assert.match(runbook, /18-minute whole-run deadline is inside the 20-minute Actions deadline/);
    assert.match(runbook, /sends TERM then KILL to the dedicated child process group/);
    assert.match(runbook, /original process group is empty after an ordinary direct-child exit/);
    assert.match(runbook, /classified `process_group_leak`, never pass/);
    assert.match(runbook, /ignores TERM and later exits `0` cannot turn that timeout into a pass/);
    assert.match(runbook, /PASS line is emitted only after any requested signed receipt has committed successfully/);
    assert.match(runbook, /independently expected run ID, semantic outcome, before\/after workspace digests/);
    assert.match(runbook, /absence of a receipt is therefore unknown\/fail-closed, never proof of pass/);
    assert.match(runbook, /workflow definition that the same pull request can edit/);
    assert.match(runbook, /explicit unresolved governance risk/);
  });
});
