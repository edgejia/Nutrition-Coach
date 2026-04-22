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

  test("normal path still includes TypeScript, test, and build gates", () => {
    const script = fs.readFileSync(new URL("../../scripts/release-check.mjs", import.meta.url), "utf8");

    assert.match(script, /runStep\("TypeScript gate", \["tsc", "--noEmit"\]\);/);
    assert.match(script, /runStep\("Full test suite", \["test"\]\);/);
    assert.match(script, /runStep\("Frontend build", \["build"\]\);/);
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
