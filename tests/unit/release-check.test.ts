process.env.TZ = "Asia/Taipei";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

const YARN_BIN = process.platform === "win32" ? "yarn.cmd" : "yarn";

function runReleaseCheck(env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, ["scripts/release-check.mjs", "--dry-run", "--base=HEAD"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  return {
    ...result,
    output: `${result.stdout}${result.stderr}`,
  };
}

function runReleaseCheckCommand(env: NodeJS.ProcessEnv) {
  const result = spawnSync(YARN_BIN, ["release:check", "--dry-run", "--base=HEAD"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  return {
    ...result,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("release:check timezone contract", () => {
  test("dry run passes with TZ=Asia/Taipei", () => {
    const result = runReleaseCheck({ ...process.env, TZ: "Asia/Taipei" });

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Timezone contract: Asia\/Taipei/);
    assert.match(result.output, /Dry run complete/);
  });

  test("dry run fails with TZ=UTC", () => {
    const result = runReleaseCheck({ ...process.env, TZ: "UTC" });

    assert.notEqual(result.status, 0);
    assert.match(result.output, /FAIL: TZ must be Asia\/Taipei; received UTC/);
  });

  test("dry run fails when TZ is missing", () => {
    const env = { ...process.env };
    delete env.TZ;

    const result = runReleaseCheck(env);

    assert.notEqual(result.status, 0);
    assert.match(result.output, /FAIL: TZ must be Asia\/Taipei; received <missing>/);
  });

  test("yarn release:check dry run normalizes an ambient UTC shell timezone", () => {
    const result = runReleaseCheckCommand({ ...process.env, TZ: "UTC" });

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Timezone contract: Asia\/Taipei/);
    assert.match(result.output, /Dry run complete/);
  });

  test("normal path still includes TypeScript, test, generated-doc drift, and build gates", () => {
    const script = fs.readFileSync(new URL("../../scripts/release-check.mjs", import.meta.url), "utf8");

    assert.match(script, /await runStep\("TypeScript gate", "typescript_gate", \["tsc", "--noEmit"\]\);/);
    assert.match(
      script,
      /await runStep\("Full test suite", "full_test_suite", \["test"\], \{ NODE_ENV: "test" \}\);/,
    );
    assert.match(script, /await runStep\("Capability matrix generated doc drift", "capability_matrix", \["matrix:gen:check"\]\);/);
    assert.match(script, /await runStep\("Behavior matrix generated doc drift", "behavior_matrix", \["behavior-matrix:gen:check"\]\);/);
    assert.match(script, /await runStep\("Frontend build", "frontend_build", \["build"\]\);/);
    assert.match(script, /publishFailedCommandReceipt/);
    assert.match(script, /publishPassedCommandReceipt/);
    assert.match(script, /--workflow-token=/);
    assert.match(script, /--workflow-runtime=/);
    assert.match(script, /signed receipts require both/);
    assert.match(script, /MAX_RELEASE_DURATION_MS = 18 \* 60 \* 1000/);
    assert.match(script, /spawn\(YARN_BIN, args/);
    assert.match(script, /function releaseChildEnvironment\(envOverrides = \{\}\)/);
    assert.match(script, /sanitizedGitEnvironment\(inherited\)/);
    assert.doesNotMatch(script, /env: \{ \.\.\.process\.env, \.\.\.envOverrides \}/);
    assert.match(script, /signalChildGroup\(child, "SIGTERM"\)/);
    assert.match(script, /signalChildGroup\(child, "SIGKILL"\)/);
    assert.match(script, /result\.error \|\| result\.status !== 0/);
    assert.match(script, /runAuthoritativeGit/);
    assert.match(script, /cwd: projectRoot/);
  });

  test("test and harness scripts run through the timezone wrapper", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };

    assert.equal(pkg.scripts["release:check"], "node scripts/run-node-with-tz.mjs --env-file=.env scripts/release-check.mjs");
    assert.equal(pkg.scripts.test, "node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/*.test.ts tests/integration/*.test.ts");
    assert.equal(pkg.scripts["test:unit"], "node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/*.test.ts");
    assert.equal(pkg.scripts["test:integration"], "node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/*.test.ts");
    assert.equal(pkg.scripts["verify:harness"], "node scripts/run-node-with-tz.mjs --import tsx tests/harness/run.ts");
  });
});
