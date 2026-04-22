process.env.TZ = "Asia/Taipei";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

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

  test("normal path still includes TypeScript, test, and build gates", () => {
    const script = fs.readFileSync(new URL("../../scripts/release-check.mjs", import.meta.url), "utf8");

    assert.match(script, /runStep\("TypeScript gate", \["tsc", "--noEmit"\]\);/);
    assert.match(script, /runStep\("Full test suite", \["test"\]\);/);
    assert.match(script, /runStep\("Frontend build", \["build"\]\);/);
  });
});
