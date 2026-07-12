process.env.TZ = "Asia/Taipei";

import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

const execFileAsync = promisify(execFile);
const VALID_SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA = "89abcdef0123456789abcdef0123456789abcdef";
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const apps: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];

async function makeClientDist(options: { index?: boolean; manifest?: unknown } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "nutrition-runtime-provenance-"));
  temporaryDirectories.push(directory);
  if (options.index !== false) {
    await writeFile(path.join(directory, "index.html"), "<!doctype html><div id=\"root\">shell</div>");
  }
  if (options.manifest !== undefined) {
    await writeFile(path.join(directory, "source-revision.json"), JSON.stringify(options.manifest));
  }
  return directory;
}

async function makeApp(clientDistDir: string, sourceRevision?: string) {
  const app = await buildApp({
    dbPath: ":memory:",
    llmProvider: new MockLLMProvider(),
    clientDistDir,
    sourceRevision,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("GET /api/runtime-provenance", () => {
  it("returns only matching process/build provenance without authentication", async () => {
    const clientDistDir = await makeClientDist({ manifest: { sourceSha: VALID_SHA } });
    const app = await makeApp(clientDistDir, VALID_SHA);

    const response = await app.inject({ method: "GET", url: "/api/runtime-provenance" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { sourceSha: VALID_SHA });
    assert.deepEqual(Object.keys(response.json()), ["sourceSha"]);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["set-cookie"], undefined);
  });

  it("remains an API route when no client shell exists", async () => {
    const clientDistDir = await makeClientDist({ index: false });
    const app = await makeApp(clientDistDir, VALID_SHA);

    const response = await app.inject({ method: "GET", url: "/api/runtime-provenance" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { sourceSha: VALID_SHA });
    assert.equal(response.headers["cache-control"], "no-store");
  });

  it("returns a category-only unavailable response in non-deployed API-only construction", async () => {
    const clientDistDir = await makeClientDist({ index: false });
    const app = await makeApp(clientDistDir);

    const response = await app.inject({ method: "GET", url: "/api/runtime-provenance" });

    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), { error: "Runtime provenance unavailable" });
    assert.equal(response.headers["cache-control"], "no-store");
  });
});

describe("runtime provenance boot validation", () => {
  it("rejects an invalid process revision without echoing it", async () => {
    const rejectedRevision = "NOT-A-VALID-REVISION";
    const clientDistDir = await makeClientDist({ index: false });

    await assert.rejects(
      makeApp(clientDistDir, rejectedRevision),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Source revision is unavailable or invalid.");
        assert.equal(error.message.includes(rejectedRevision), false);
        return true;
      },
    );
  });

  it("rejects missing, malformed, and mismatched manifests without echoing candidates", async () => {
    const fixtures = [
      await makeClientDist(),
      await makeClientDist({ manifest: { sourceSha: "MALFORMED-MANIFEST-REVISION" } }),
      await makeClientDist({ manifest: { sourceSha: OTHER_SHA } }),
      await makeClientDist({ manifest: { sourceSha: VALID_SHA, branch: "must-not-be-accepted" } }),
    ];

    for (const clientDistDir of fixtures) {
      await assert.rejects(
        makeApp(clientDistDir, VALID_SHA),
        (error) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Client build provenance is unavailable or invalid.");
          assert.equal(error.message.includes(VALID_SHA), false);
          assert.equal(error.message.includes(OTHER_SHA), false);
          assert.equal(error.message.includes("MALFORMED-MANIFEST-REVISION"), false);
          return true;
        },
      );
    }
  });

  it("fails deployed-like boot when process provenance is missing", async () => {
    const directory = await makeClientDist({ index: false });
    await mkdir(path.join(directory, "assets"), { recursive: true });
    const code = [
      'process.env.TZ = "Asia/Taipei";',
      'const { buildApp } = await import("./server/app.ts");',
      'const { MockLLMProvider } = await import("./server/llm/mock.ts");',
      `try { await buildApp({ dbPath: ":memory:", clientDistDir: ${JSON.stringify(directory)}, llmProvider: new MockLLMProvider() }); process.exit(2); }`,
      'catch (error) { if (!(error instanceof Error) || error.message !== "Runtime source provenance is required in deployed-like runtime.") process.exit(3); }',
    ].join(" ");

    const childEnvironment = { ...process.env };
    delete childEnvironment.SOURCE_SHA;
    Object.assign(childEnvironment, {
      NODE_ENV: "production",
      GUEST_SESSION_SECRET: "runtime-provenance-test-secret-value-123456",
    });
    const result = await execFileAsync(process.execPath, ["--import", "tsx", "--eval", code], {
      cwd: REPO_ROOT,
      env: childEnvironment,
    });

    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });
});
