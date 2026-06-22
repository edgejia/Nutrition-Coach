process.env.TZ = "Asia/Taipei";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_GUEST_SESSION_SECRET } from "../../server/config.js";

const probeScript = [
  'const { buildApp } = await import("./server/app.ts");',
  'const { MockLLMProvider } = await import("./server/llm/mock.ts");',
  'const app = await buildApp({ dbPath: process.env.TEST_DB_PATH ?? ":memory:", llmProvider: new MockLLMProvider() });',
  'console.log(`RUNTIME_PORT:${app.runtimeConfig.port}`);',
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

function baseEnv() {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    TZ: "Asia/Taipei",
  };
  delete env.GUEST_SESSION_SECRET;
  delete env.GUEST_SESSION_COOKIE_SECURE;
  return env;
}

function assertWeakSecretBootFailure(result: ReturnType<typeof runBootProbe>, rejectedSecret?: string) {
  assert.notEqual(result.status, 0, result.output);
  assert.doesNotMatch(result.output, /BOOT_OK/);
  assert.match(result.output, /GUEST_SESSION_SECRET/);
  assert.match(result.output, /NODE_ENV=production/);
  assert.match(result.output, /GUEST_SESSION_COOKIE_SECURE=true/);
  assert.match(result.output, /non-empty, non-default value at least 32 characters/);
  if (rejectedSecret) {
    assert.doesNotMatch(result.output, new RegExp(rejectedSecret));
  }
  assert.doesNotMatch(result.output, new RegExp(DEFAULT_GUEST_SESSION_SECRET));
}

describe("startup guest-session security guard", () => {
  it("fails production boot when the guest-session secret is missing or default", () => {
    assertWeakSecretBootFailure(runBootProbe({ ...baseEnv(), NODE_ENV: "production" }));
    assertWeakSecretBootFailure(
      runBootProbe({
        ...baseEnv(),
        NODE_ENV: "production",
        GUEST_SESSION_SECRET: DEFAULT_GUEST_SESSION_SECRET,
      }),
      DEFAULT_GUEST_SESSION_SECRET,
    );
  });

  it("fails deployed-like boot when secure guest cookies are enabled with a short secret", () => {
    const rejectedSecret = "short-secure-secret";

    assertWeakSecretBootFailure(
      runBootProbe({
        ...baseEnv(),
        GUEST_SESSION_COOKIE_SECURE: "true",
        GUEST_SESSION_SECRET: rejectedSecret,
      }),
      rejectedSecret,
    );
  });

  it("fails deployed-like boot when secure guest cookies are enabled with the development default secret", () => {
    const result = runBootProbe({
      ...baseEnv(),
      GUEST_SESSION_COOKIE_SECURE: "true",
      GUEST_SESSION_SECRET: DEFAULT_GUEST_SESSION_SECRET,
    });

    assertWeakSecretBootFailure(result, DEFAULT_GUEST_SESSION_SECRET);
  });

  it("fails production boot on weak guest-session secret before file-backed schema validation", () => {
    const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "nc-weak-secret-")), "fresh.sqlite");
    const result = runBootProbe({
      ...baseEnv(),
      NODE_ENV: "production",
      TEST_DB_PATH: dbPath,
    });

    assertWeakSecretBootFailure(result);
    assert.doesNotMatch(result.output, /Database schema missing/);
  });

  it("boots ordinary local test runtime with the development default and secure cookies off", () => {
    const result = runBootProbe(baseEnv());

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /BOOT_OK/);
  });

  it("exposes the validated runtime port on successful buildApp boot", () => {
    const result = runBootProbe({
      ...baseEnv(),
      PORT: "4567",
      GUEST_SESSION_TTL_SECONDS: "43200",
      GUEST_SESSION_RESUME_TTL_SECONDS: "2592000",
    });

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /RUNTIME_PORT:4567/);
    assert.match(result.output, /BOOT_OK/);
  });

  it("fails boot before completion when guest-session TTL config is invalid", () => {
    const activeTtlResult = runBootProbe({
      ...baseEnv(),
      GUEST_SESSION_TTL_SECONDS: "0",
    });
    assert.notEqual(activeTtlResult.status, 0, activeTtlResult.output);
    assert.doesNotMatch(activeTtlResult.output, /BOOT_OK/);
    assert.match(activeTtlResult.output, /GUEST_SESSION_TTL_SECONDS/);

    const resumeTtlResult = runBootProbe({
      ...baseEnv(),
      GUEST_SESSION_RESUME_TTL_SECONDS: "not-a-number",
    });
    assert.notEqual(resumeTtlResult.status, 0, resumeTtlResult.output);
    assert.doesNotMatch(resumeTtlResult.output, /BOOT_OK/);
    assert.match(resumeTtlResult.output, /GUEST_SESSION_RESUME_TTL_SECONDS/);
  });
});
