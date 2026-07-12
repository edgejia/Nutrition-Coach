import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";
import { parseSourceRevision, SOURCE_REVISION_PATTERN } from "../../server/lib/source-revision.js";

const execFileAsync = promisify(execFile);
const VALID_SHA = "0123456789abcdef0123456789abcdef01234567";
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const WRAPPER_PATH = path.join(REPO_ROOT, "scripts/run-with-source-sha.mjs");
const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "nutrition-source-revision-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function runWrapper(args: string[]) {
  return execFileAsync(
    process.execPath,
    ["--import", "tsx", WRAPPER_PATH, ...args],
    { cwd: REPO_ROOT },
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("source revision validation", () => {
  it("accepts exactly one lowercase 40-character hexadecimal SHA", () => {
    assert.match(VALID_SHA, SOURCE_REVISION_PATTERN);
    assert.equal(parseSourceRevision(VALID_SHA), VALID_SHA);
  });

  it("rejects malformed values without echoing them", () => {
    const rejectedValues = [
      undefined,
      "0123456",
      VALID_SHA.toUpperCase(),
      `${VALID_SHA.slice(0, 39)}g`,
      ` ${VALID_SHA}`,
      `${VALID_SHA} `,
      `${VALID_SHA}\n${VALID_SHA}`,
    ];

    for (const candidate of rejectedValues) {
      assert.throws(
        () => parseSourceRevision(candidate),
        (error) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Source revision is unavailable or invalid.");
          if (candidate) {
            assert.equal(error.message.includes(candidate), false);
          }
          return true;
        },
      );
    }
  });
});

describe("source revision command wrapper", () => {
  it("injects the selected checkout SHA into the child environment", async () => {
    const expectedSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT })).stdout.trim();
    const result = await runWrapper([
      "--",
      process.execPath,
      "-e",
      "process.stdout.write(process.env.SOURCE_SHA ?? '')",
    ]);

    assert.equal(result.stdout, expectedSha);
    assert.equal(result.stderr, "");
  });

  it("propagates child failure without printing the environment", async () => {
    await assert.rejects(
      runWrapper(["--", process.execPath, "-e", "process.exit(23)"]),
      (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => {
        assert.equal(error.code, 23);
        assert.equal(error.stderr ?? "", "");
        assert.equal((error.stderr ?? "").includes("SOURCE_SHA"), false);
        return true;
      },
    );
  });

  it("atomically replaces the manifest only after a successful child", async () => {
    const directory = await makeTemporaryDirectory();
    const manifestPath = path.join(directory, "source-revision.json");
    await writeFile(manifestPath, "stale\n", "utf8");

    await runWrapper(["--manifest", manifestPath, "--", process.execPath, "-e", "process.exit(0)"]);

    const expectedSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT })).stdout.trim();
    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), { sourceSha: expectedSha });
    assert.deepEqual((await readdir(directory)).filter((name) => name !== "source-revision.json"), []);
  });

  it("does not write or refresh the manifest after child failure", async () => {
    const directory = await makeTemporaryDirectory();
    const missingManifestPath = path.join(directory, "missing.json");
    const staleManifestPath = path.join(directory, "stale.json");
    await writeFile(staleManifestPath, "stale\n", "utf8");

    for (const manifestPath of [missingManifestPath, staleManifestPath]) {
      await assert.rejects(
        runWrapper(["--manifest", manifestPath, "--", process.execPath, "-e", "process.exit(19)"]),
      );
    }

    await assert.rejects(readFile(missingManifestPath, "utf8"), { code: "ENOENT" });
    assert.equal(await readFile(staleManifestPath, "utf8"), "stale\n");
  });
});

describe("package script provenance binding", () => {
  it("routes normal build and start entrypoints through the wrapper", async () => {
    const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    assert.equal(
      packageJson.scripts.build,
      "node --import tsx scripts/run-with-source-sha.mjs --manifest dist/client/source-revision.json -- vite build --config client/vite.config.ts",
    );
    assert.equal(
      packageJson.scripts.start,
      "node --import tsx scripts/run-with-source-sha.mjs -- node --import tsx server/index.ts",
    );
  });
});
