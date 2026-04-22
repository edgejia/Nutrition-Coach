process.env.TZ = "Asia/Taipei";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const probeScript = [
  'const { buildApp } = await import("./server/app.ts");',
  'const { MockLLMProvider } = await import("./server/llm/mock.ts");',
  'const app = await buildApp({ dbPath: ":memory:", llmProvider: new MockLLMProvider() });',
  'console.log("BOOT_OK");',
  "await app.close();",
].join("\n");

function runBootProbe(env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", probeScript], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  return {
    ...result,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("Timezone startup guard", () => {
  it("fails fast when TZ is missing", () => {
    const env = { ...process.env };
    delete env.TZ;

    const result = runBootProbe(env);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /TZ must be explicitly set to Asia\/Taipei\./);
    assert.doesNotMatch(result.output, /BOOT_OK/);
  });

  it("fails fast when TZ is set to UTC", () => {
    const result = runBootProbe({ ...process.env, TZ: "UTC" });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /expected Asia\/Taipei but received UTC/);
    assert.doesNotMatch(result.output, /BOOT_OK/);
  });

  it("boots successfully when TZ is Asia/Taipei", () => {
    const result = runBootProbe({ ...process.env, TZ: "Asia/Taipei" });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /BOOT_OK/);
  });
});
