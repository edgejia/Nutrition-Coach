process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

describe("Web App", () => {
  let app: FastifyInstance;
  let clientDistDir: string;

  beforeEach(async () => {
    clientDistDir = await mkdtemp(path.join(tmpdir(), "nutrition-web-app-"));
    await writeFile(
      path.join(clientDistDir, "index.html"),
      "<!doctype html><html><body><div id=\"root\">beta-shell</div></body></html>",
    );

    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      clientDistDir,
    });
  });

  afterEach(async () => {
    await app.close();
    await rm(clientDistDir, { recursive: true, force: true });
  });

  it("GET / returns the built index.html when client dist exists", async () => {
    const res = await app.inject({ method: "GET", url: "/" });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] ?? "", /^text\/html/);
    assert.match(res.body, /beta-shell/);
  });

  it("GET /chat falls back to index.html for SPA routes", async () => {
    const res = await app.inject({ method: "GET", url: "/chat" });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] ?? "", /^text\/html/);
    assert.match(res.body, /beta-shell/);
  });

  it("GET /api/meals remains an API route and is not swallowed by SPA fallback", async () => {
    const res = await app.inject({ method: "GET", url: "/api/meals" });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Missing X-Device-Id" });
  });
});
