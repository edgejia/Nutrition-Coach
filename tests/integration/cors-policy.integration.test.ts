process.env.TZ = "Asia/Taipei";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const probeScript = [
  'const { buildApp } = await import("./server/app.ts");',
  'const { MockLLMProvider } = await import("./server/llm/mock.ts");',
  'const app = await buildApp({ dbPath: ":memory:", llmProvider: new MockLLMProvider() });',
  "const response = await app.inject({",
  '  method: "OPTIONS",',
  '  url: "/api/device",',
  "  headers: {",
  '    origin: process.env.PROBE_ORIGIN,',
  '    "access-control-request-method": "POST",',
  "  },",
  "});",
  "console.log(JSON.stringify({",
  '  allowOrigin: response.headers["access-control-allow-origin"] ?? null,',
  '  allowCredentials: response.headers["access-control-allow-credentials"] ?? null,',
  "  statusCode: response.statusCode,",
  "}));",
  "await app.close();",
].join("\n");

function runCorsProbe(env: NodeJS.ProcessEnv, origin: string) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--eval", probeScript], {
    cwd: process.cwd(),
    env: {
      ...env,
      PROBE_ORIGIN: origin,
      TZ: "Asia/Taipei",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim()) as {
    allowOrigin: string | null;
    allowCredentials: string | null;
    statusCode: number;
  };
}

function localEnv() {
  const env = { ...process.env, NODE_ENV: "test" };
  delete env.GUEST_SESSION_COOKIE_SECURE;
  delete env.GUEST_SESSION_SECRET;
  return env;
}

describe("CORS registration policy", () => {
  it("allows only the documented local Vite loopback origins with credentials", () => {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
      const result = runCorsProbe(localEnv(), origin);

      assert.equal(result.statusCode, 204);
      assert.equal(result.allowOrigin, origin);
      assert.equal(result.allowCredentials, "true");
    }
  });

  it("does not allow unlisted local loopback ports", () => {
    const result = runCorsProbe(localEnv(), "http://localhost:5174");

    assert.notEqual(result.allowOrigin, "http://localhost:5174");
    assert.notEqual(result.allowOrigin, "*");
  });

  it("skips CORS in deployed-like runtime and relies on same-origin serving", () => {
    const result = runCorsProbe(
      {
        ...localEnv(),
        NODE_ENV: "production",
        GUEST_SESSION_SECRET: "strong-production-secret-with-punctuation!!!",
      },
      "https://example.invalid",
    );

    assert.notEqual(result.allowOrigin, "https://example.invalid");
    assert.notEqual(result.allowOrigin, "*");
  });
});
