import { execFile, spawn } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { afterEach, describe, it } from "node:test";
import { parseSourceRevision, SOURCE_REVISION_PATTERN } from "../../server/lib/source-revision.js";

const execFileAsync = promisify(execFile);
const VALID_SHA = "0123456789abcdef0123456789abcdef01234567";
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const WRAPPER_PATH = path.join(REPO_ROOT, "scripts/run-with-source-sha.mjs");
const TSX_IMPORT_PATH = path.join(REPO_ROOT, "node_modules/tsx/dist/loader.mjs");
const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "nutrition-source-revision-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function runWrapper(args: string[], cwd = REPO_ROOT) {
  return execFileAsync(
    process.execPath,
    ["--import", TSX_IMPORT_PATH, WRAPPER_PATH, ...args],
    { cwd },
  );
}

async function makeTemporaryGitRepository() {
  const directory = await makeTemporaryDirectory();
  await writeFile(path.join(directory, ".gitignore"), "*.json\n*.marker\n", "utf8");
  await writeFile(path.join(directory, "README.md"), "committed readme\n", "utf8");
  await writeFile(path.join(directory, "tracked.txt"), "committed input\n", "utf8");
  await execFileAsync("git", ["init"], { cwd: directory });
  await execFileAsync("git", ["config", "user.name", "Nutrition Coach Test"], { cwd: directory });
  await execFileAsync("git", ["config", "user.email", "test@nutrition-coach.invalid"], {
    cwd: directory,
  });
  await execFileAsync("git", ["add", ".gitignore", "README.md", "tracked.txt"], { cwd: directory });
  await execFileAsync("git", ["commit", "-m", "test fixture"], { cwd: directory });
  return directory;
}

async function assertDirtyRepositoryRejected(
  directory: string,
  rejectedPath: string,
  rejectedValue: string,
) {
  const markerPath = path.join(directory, "child-launched.marker");
  const missingManifestPath = path.join(directory, "missing-manifest.json");
  const staleManifestPath = path.join(directory, "stale-manifest.json");
  await writeFile(staleManifestPath, "stale\n", "utf8");
  const childSource = `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "launched")`;

  for (const manifestPath of [missingManifestPath, staleManifestPath]) {
    await assert.rejects(
      runWrapper(
        ["--manifest", manifestPath, "--", process.execPath, "-e", childSource],
        directory,
      ),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        const stderr = error.stderr ?? "";
        assert.match(stderr, /Source repository inputs are not clean\./);
        assert.equal(stderr.includes(rejectedPath), false);
        assert.equal(stderr.includes(rejectedValue), false);
        return true;
      },
    );
  }

  await assert.rejects(readFile(markerPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(missingManifestPath, "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(staleManifestPath, "utf8"), "stale\n");
}

async function waitForFile(filePath: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    await delay(20);
  }
  throw new Error("Timed out waiting for subprocess readiness.");
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessGone(pid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await delay(20);
  }
  throw new Error("Timed out waiting for subprocess termination.");
}

async function runSignalForwardingProbe(signal: NodeJS.Signals) {
  const directory = await makeTemporaryGitRepository();
  const readyPath = path.join(directory, "child-ready.marker");
  const manifestPath = path.join(directory, "signal-manifest.json");
  await writeFile(manifestPath, "stale\n", "utf8");
  const childSource = [
    'const { writeFileSync } = require("node:fs");',
    `writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));`,
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const wrapper = spawn(
    process.execPath,
    [
      "--import",
      TSX_IMPORT_PATH,
      WRAPPER_PATH,
      "--manifest",
      manifestPath,
      "--",
      process.execPath,
      "-e",
      childSource,
    ],
    { cwd: directory, stdio: "ignore" },
  );
  const wrapperCompletion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      wrapper.once("error", reject);
      wrapper.once("close", (code, closeSignal) => resolve({ code, signal: closeSignal }));
    },
  );
  let childPid: number | undefined;

  try {
    childPid = Number(await waitForFile(readyPath));
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
    assert.equal(wrapper.kill(signal), true);
    const result = await Promise.race([
      wrapperCompletion,
      delay(5_000).then(() => {
        throw new Error("Timed out waiting for wrapper termination.");
      }),
    ]);
    await waitForProcessGone(childPid);

    assert.equal(result.code, null);
    assert.equal(result.signal, signal);
    assert.equal(await readFile(manifestPath, "utf8"), "stale\n");
  } finally {
    if (wrapper.exitCode === null && wrapper.signalCode === null) {
      wrapper.kill("SIGKILL");
    }
    if (childPid && isProcessAlive(childPid)) {
      process.kill(childPid, "SIGKILL");
      await waitForProcessGone(childPid).catch(() => undefined);
    }
  }
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
    const directory = await makeTemporaryGitRepository();
    const expectedSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory })).stdout.trim();
    const result = await runWrapper([
      "--",
      process.execPath,
      "-e",
      "process.stdout.write(process.env.SOURCE_SHA ?? '')",
    ], directory);

    assert.equal(result.stdout, expectedSha);
    assert.equal(result.stderr, "");
  });

  it("propagates child failure without printing the environment", async () => {
    const directory = await makeTemporaryGitRepository();
    await assert.rejects(
      runWrapper(["--", process.execPath, "-e", "process.exit(23)"], directory),
      (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => {
        assert.equal(error.code, 23);
        assert.equal(error.stderr ?? "", "");
        assert.equal((error.stderr ?? "").includes("SOURCE_SHA"), false);
        return true;
      },
    );
  });

  it("atomically replaces the manifest only after a successful child", async () => {
    const directory = await makeTemporaryGitRepository();
    const manifestPath = path.join(directory, "source-revision.json");
    await writeFile(manifestPath, "stale\n", "utf8");
    const initialEntries = await readdir(directory);

    await runWrapper(
      ["--manifest", manifestPath, "--", process.execPath, "-e", "process.exit(0)"],
      directory,
    );

    const expectedSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory })).stdout.trim();
    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), { sourceSha: expectedSha });
    assert.deepEqual(await readdir(directory), initialEntries);
  });

  it("does not write or refresh the manifest after child failure", async () => {
    const directory = await makeTemporaryGitRepository();
    const missingManifestPath = path.join(directory, "missing.json");
    const staleManifestPath = path.join(directory, "stale.json");
    await writeFile(staleManifestPath, "stale\n", "utf8");

    for (const manifestPath of [missingManifestPath, staleManifestPath]) {
      await assert.rejects(
        runWrapper(
          ["--manifest", manifestPath, "--", process.execPath, "-e", "process.exit(19)"],
          directory,
        ),
      );
    }

    await assert.rejects(readFile(missingManifestPath, "utf8"), { code: "ENOENT" });
    assert.equal(await readFile(staleManifestPath, "utf8"), "stale\n");
  });

  it("rejects an unstaged tracked input before child launch or manifest mutation", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "tracked.txt";
    const rejectedValue = "unstaged-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("rejects a staged tracked input before child launch or manifest mutation", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "tracked.txt";
    const rejectedValue = "staged-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");
    await execFileAsync("git", ["add", rejectedPath], { cwd: directory });

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("rejects a non-ignored untracked input before child launch or manifest mutation", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "untracked-private-input.txt";
    const rejectedValue = "untracked-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("rejects an unstaged README change without a pathname exception", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "README.md";
    const rejectedValue = "unstaged-readme-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("rejects a staged README change without a pathname exception", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "README.md";
    const rejectedValue = "staged-readme-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");
    await execFileAsync("git", ["add", rejectedPath], { cwd: directory });

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("forwards SIGTERM, waits for the child, and preserves signal termination", async () => {
    await runSignalForwardingProbe("SIGTERM");
  });

  it("forwards SIGINT, waits for the child, and preserves signal termination", async () => {
    await runSignalForwardingProbe("SIGINT");
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
