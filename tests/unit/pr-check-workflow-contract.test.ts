import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs/promises";

const workflowUrl = new URL("../../.github/workflows/pr-check.yml", import.meta.url);
const manualWorkflowUrl = new URL("../../.github/workflows/manual-release-diagnostic.yml", import.meta.url);
const releaseCheckUrl = new URL("../../scripts/release-check.mjs", import.meta.url);
const readinessUrl = new URL("../../docs/workflow/gsd-reenable-readiness.md", import.meta.url);

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
    const releaseCheck = await fs.readFile(releaseCheckUrl, "utf8");
    assert.match(releaseCheck, /MAX_RELEASE_DURATION_MS = 18 \* 60 \* 1000/);
    assert.match(releaseCheck, /signalChildGroup\(child, "SIGTERM"\)/);
    assert.match(releaseCheck, /signalChildGroup\(child, "SIGKILL"\)/);
    assert.match(releaseCheck, /completed child left a live process group/);
    assert.match(releaseCheck, /publishPassedCommandReceipt/);
    assert.match(releaseCheck, /assertWithinReleaseDeadline\(\);\n\s+console\.log\(`\[release-check\] Receipt:/);
    assert.match(releaseCheck, /console\.log\("\\n\[release-check\] PASS"\)/);

    const readiness = await fs.readFile(readinessUrl, "utf8");
    assert.match(readiness, /required-check workflow is still source in the same repository that a pull request can edit/);
    assert.match(readiness, /cannot prove that a future PR cannot weaken the `Release Check` implementation itself/);
    assert.match(readiness, /remains a governance defer decision/);
  });
});
