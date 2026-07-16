import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RuntimeParityError,
  captureRuntimeParityFileEvidence,
  checkLiveRuntimeParity,
  compareRuntimeWiringFindings,
  deriveRuntimeParityReadiness,
  runDeterministicParitySmoke,
  validateRuntimeParityMatrix,
  verifyProjectVerifierFiles,
} from "../../scripts/workflow/runtime-parity.mjs";

const matrixUrl = new URL("../../docs/workflow/runtime-parity.json", import.meta.url);

describe("Codex and Claude runtime parity matrix", () => {
  it("has the exact governed row set and explicit blockers/deferred residuals", async () => {
    const matrix = validateRuntimeParityMatrix(JSON.parse(await fs.readFile(matrixUrl, "utf8")));
    assert.equal(matrix.gsdVersion, "1.7.0");
    assert.ok(matrix.rows.some((row) => row.status === "blocking"));
    assert.ok(matrix.rows.some((row) => row.status === "deferred"));
    assert.ok(matrix.rows.some((row) => row.status === "intentional_difference"));
    assert.deepEqual(matrix.expectedWiringFindings, [
      {
        code: "wiring_role_binding_missing",
        role: "gsd-plan-checker",
        skill: ".codex/skills/nutrition-planning-proof",
      },
      {
        code: "wiring_role_binding_missing",
        role: "gsd-planner",
        skill: ".codex/skills/nutrition-planning-proof",
      },
    ]);
  });

  it("compares the full wiring finding set and surfaces every masked extra blocker", async () => {
    const matrix = validateRuntimeParityMatrix(JSON.parse(await fs.readFile(matrixUrl, "utf8")));
    assert.deepEqual(compareRuntimeWiringFindings(matrix.expectedWiringFindings, matrix.expectedWiringFindings), {
      exact: true,
      findings: [],
    });
    const comparison = compareRuntimeWiringFindings(
      [
        ...matrix.expectedWiringFindings,
        { code: "wiring_workstream_override_active" },
        { code: "wiring_skill_not_tracked_at_source", evidence: "skill" },
      ],
      matrix.expectedWiringFindings,
    );
    assert.equal(comparison.exact, false);
    assert.deepEqual(
      comparison.findings
        .filter((finding) => finding.code === "runtime_parity_wiring_unexpected_finding")
        .map((finding) => finding.wiringFinding),
      [
        { code: "wiring_skill_not_tracked_at_source", evidence: "skill" },
        { code: "wiring_workstream_override_active" },
      ],
    );
    assert.ok(comparison.findings.some((finding) => finding.code === "runtime_parity_wiring_matrix_stale"));
  });

  it("detects A-to-B-to-A file replacement even when content and mtime are restored", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-runtime-freshness-")));
    try {
      const file = path.join(root, "evidence.txt");
      await fs.writeFile(file, "A\n");
      const stat = await fs.stat(file);
      const before = await captureRuntimeParityFileEvidence(file);
      await fs.writeFile(file, "B\n");
      await fs.writeFile(file, "A\n");
      await fs.utimes(file, stat.atime, stat.mtime);
      const after = await captureRuntimeParityFileEvidence(file);
      assert.equal(after.sha256, before.sha256);
      assert.notDeepEqual(after.identity, before.identity);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects off-tree hardlink aliases for governed file evidence", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-runtime-hardlink-")));
    try {
      const file = path.join(root, "evidence.txt");
      await fs.writeFile(file, "governed\n");
      await fs.link(file, path.join(root, "alias.txt"));
      await assert.rejects(
        captureRuntimeParityFileEvidence(file),
        (error: unknown) =>
          error instanceof RuntimeParityError && error.code === "runtime_parity_file_missing_or_unsafe",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing intentional-difference rationale and duplicate row", async () => {
    const matrix = JSON.parse(await fs.readFile(matrixUrl, "utf8"));
    const intentional = matrix.rows.find((row: { status: string }) => row.status === "intentional_difference");
    delete intentional.acceptedRationale;
    assert.throws(
      () => validateRuntimeParityMatrix(matrix),
      (error: unknown) => error instanceof RuntimeParityError && error.code === "runtime_parity_matrix_rationale_missing",
    );

    const duplicate = JSON.parse(await fs.readFile(matrixUrl, "utf8"));
    duplicate.rows.push(structuredClone(duplicate.rows[0]));
    assert.throws(
      () => validateRuntimeParityMatrix(duplicate),
      (error: unknown) => error instanceof RuntimeParityError && error.code === "runtime_parity_matrix_duplicate_row",
    );
  });

  it("pins exact per-host skill manifests and never reports ready for a failed live check", async () => {
    const missingSkill = JSON.parse(await fs.readFile(matrixUrl, "utf8"));
    delete missingSkill.skillSurface.manifests.codex[Object.keys(missingSkill.skillSurface.manifests.codex)[0]];
    assert.throws(
      () => validateRuntimeParityMatrix(missingSkill),
      (error: unknown) => error instanceof RuntimeParityError && error.code === "runtime_parity_matrix_invalid",
    );
    const divergentNames = JSON.parse(await fs.readFile(matrixUrl, "utf8"));
    divergentNames.skillSurface.manifests.claude["gsd-rogue"] = "a".repeat(64);
    delete divergentNames.skillSurface.manifests.claude[Object.keys(divergentNames.skillSurface.manifests.claude)[0]];
    assert.throws(
      () => validateRuntimeParityMatrix(divergentNames),
      (error: unknown) => error instanceof RuntimeParityError && error.code === "runtime_parity_matrix_invalid",
    );
    assert.equal(deriveRuntimeParityReadiness("fail", { blocking: 0, deferred: 0 }), "not_ready");
    assert.equal(deriveRuntimeParityReadiness("pass", { blocking: 1, deferred: 0 }), "not_ready");
    assert.equal(deriveRuntimeParityReadiness("pass", { blocking: 0, deferred: 0 }), "ready");
  });

  it("pins the exact closed project-verifier byte manifest and detects a changed verifier", async () => {
    const matrix = JSON.parse(await fs.readFile(matrixUrl, "utf8"));
    const missing = structuredClone(matrix);
    delete missing.projectVerifierFiles[Object.keys(missing.projectVerifierFiles)[0]];
    assert.throws(
      () => validateRuntimeParityMatrix(missing),
      (error: unknown) => error instanceof RuntimeParityError && error.code === "runtime_parity_matrix_invalid",
    );
    const extra = structuredClone(matrix);
    extra.projectVerifierFiles["scripts/workflow/substitute.mjs"] = "a".repeat(64);
    assert.throws(
      () => validateRuntimeParityMatrix(extra),
      (error: unknown) => error instanceof RuntimeParityError && error.code === "runtime_parity_matrix_invalid",
    );

    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-runtime-verifier-")));
    try {
      for (const relative of Object.keys(matrix.projectVerifierFiles)) {
        const destination = path.join(root, relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(path.join(process.cwd(), relative), destination);
      }
      const original = await verifyProjectVerifierFiles(root, matrix.projectVerifierFiles);
      assert.equal(original.status, "pass");
      assert.match(original.bundleSha256, /^[0-9a-f]{64}$/);

      await fs.appendFile(path.join(root, "scripts/workflow/plan-proof-lint.mjs"), "\n// substituted verifier\n");
      const changed = await verifyProjectVerifierFiles(root, matrix.projectVerifierFiles);
      assert.equal(changed.status, "fail");
      assert.deepEqual(changed.findings, [
        { code: "runtime_parity_project_verifier_drift", file: "scripts/workflow/plan-proof-lint.mjs" },
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal, extra schema fields, and caller-selected evidence namespaces", async () => {
    const traversal = JSON.parse(await fs.readFile(matrixUrl, "utf8"));
    traversal.coreFiles["../../substitute"] = traversal.coreFiles.VERSION;
    assert.throws(
      () => validateRuntimeParityMatrix(traversal),
      (error: unknown) => error instanceof RuntimeParityError && error.code === "runtime_parity_matrix_invalid",
    );

    const extra = JSON.parse(await fs.readFile(matrixUrl, "utf8"));
    extra.untrustedSnapshot = true;
    assert.throws(
      () => validateRuntimeParityMatrix(extra),
      (error: unknown) => error instanceof RuntimeParityError && error.code === "runtime_parity_matrix_invalid",
    );

    await assert.rejects(
      checkLiveRuntimeParity({ projectRoot: process.cwd(), matrixPath: "/tmp/substitute.json" }),
      (error: unknown) => error instanceof RuntimeParityError && error.code === "runtime_parity_scope_override_forbidden",
    );
    await assert.rejects(
      checkLiveRuntimeParity({ projectRoot: path.join(process.cwd(), "scripts") }),
      (error: unknown) => (error as Error & { code?: string }).code === "workflow_project_git_scope_invalid",
    );

    const cli = spawnSync(
      process.execPath,
      ["scripts/workflow/runtime-parity.mjs", `--project-root=${process.cwd()}`, "--matrix=/tmp/substitute.json"],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /runtime_parity_usage_error/);
  });

  it("normalizes the same good and historical false-pass fixture under both runtime labels", async () => {
    const smoke = await runDeterministicParitySmoke(process.cwd());
    assert.deepEqual(smoke, {
      equivalent: true,
      goodStatus: "pass",
      badStatus: "fail",
      badRuleIds: ["PPL001", "PPL005"],
    });
  });
});
