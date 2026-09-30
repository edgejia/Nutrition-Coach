import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const helperSource = path.join(repositoryRoot, "scripts/workflow/sync-worktree-agents.mjs");

function git(args: string[], cwd: string) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commonGitDir(cwd: string) {
  return path.resolve(cwd, git(["rev-parse", "--git-common-dir"], cwd).trim());
}

async function installFixture(primary: string, commonDir: string) {
  await mkdir(path.join(primary, "scripts/workflow"), { recursive: true });
  await copyFile(helperSource, path.join(primary, "scripts/workflow/sync-worktree-agents.mjs"));
  await mkdir(path.join(commonDir, "codex-local"), { recursive: true });
  await writeHook(path.join(commonDir, "codex-local/sync-agents.sh"));
}

async function writeHook(target: string) {
  await writeFile(
    target,
    [
      "#!/bin/sh",
      "set -eu",
      'TOP="$(git rev-parse --show-toplevel)"',
      'exec node "$TOP/scripts/workflow/sync-worktree-agents.mjs" --project-root="$TOP" "$@"',
      "",
    ].join("\n"),
    { mode: 0o700 },
  );
}

describe("ignored AGENTS worktree synchronization", () => {
  it("keeps the primary file authoritative and links detached worktrees", async () => {
    const fixtureParent = await mkdtemp(path.join(os.tmpdir(), "nutrition-agents-sync-"));
    const primary = path.join(fixtureParent, "primary");
    const secondary = path.join(fixtureParent, "detached");
    try {
      await mkdir(primary, { recursive: true });
      git(["init", "--initial-branch=main"], primary);
      git(["config", "user.name", "fixture"], primary);
      git(["config", "user.email", "fixture@example.invalid"], primary);
      await writeFile(path.join(primary, "AGENTS.md"), "fixture authoritative policy\n");
      git(["add", "AGENTS.md"], primary);
      git(["commit", "-m", "fixture policy"], primary);
      git(["worktree", "add", "--detach", secondary], primary);
      await writeFile(path.join(secondary, "AGENTS.md"), "stale detached policy\n");
      const commonDir = commonGitDir(primary);
      await installFixture(primary, commonDir);
      await mkdir(path.join(secondary, "scripts/workflow"), { recursive: true });
      await copyFile(helperSource, path.join(secondary, "scripts/workflow/sync-worktree-agents.mjs"));
      await writeFile(path.join(commonDir, "codex-local", "AGENTS.md"), "stale common policy\n");

      const result = spawnSync("sh", [path.join(commonDir, "codex-local/sync-agents.sh")], {
        cwd: primary,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const primaryStat = await lstat(path.join(primary, "AGENTS.md"));
      assert.equal(primaryStat.isFile(), true);
      assert.equal(primaryStat.isSymbolicLink(), false);
      assert.equal(await readFile(path.join(primary, "AGENTS.md"), "utf8"), "fixture authoritative policy\n");
      assert.equal((await lstat(path.join(secondary, "AGENTS.md"))).isSymbolicLink(), true);
      assert.equal(await readlink(path.join(secondary, "AGENTS.md")), path.join(await realpath(primary), "AGENTS.md"));
      assert.equal(await readFile(path.join(secondary, "AGENTS.md"), "utf8"), "fixture authoritative policy\n");
      await assert.rejects(readFile(path.join(commonDir, "codex-local", "AGENTS.md")), { code: "ENOENT" });

      const secondRun = spawnSync("sh", [path.join(commonDir, "codex-local/sync-agents.sh")], {
        cwd: secondary,
        encoding: "utf8",
      });
      assert.equal(secondRun.status, 0, secondRun.stderr);
      assert.equal(await readFile(path.join(secondary, "AGENTS.md"), "utf8"), "fixture authoritative policy\n");
    } finally {
      try {
        git(["worktree", "remove", "--force", secondary], primary);
      } catch {
        // Disposable fixture cleanup only.
      }
      await rm(fixtureParent, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked common codex-local parent without unlinking outside it", async () => {
    const fixtureParent = await mkdtemp(path.join(os.tmpdir(), "nutrition-agents-common-link-"));
    const primary = path.join(fixtureParent, "primary");
    const external = path.join(fixtureParent, "external");
    try {
      await mkdir(primary, { recursive: true });
      await mkdir(external, { recursive: true });
      git(["init", "--initial-branch=main"], primary);
      git(["config", "user.name", "fixture"], primary);
      git(["config", "user.email", "fixture@example.invalid"], primary);
      await writeFile(path.join(primary, "AGENTS.md"), "authoritative policy\n");
      git(["add", "AGENTS.md"], primary);
      git(["commit", "-m", "fixture policy"], primary);
      await writeFile(path.join(external, "AGENTS.md"), "external duplicate must survive\n");
      const commonDir = commonGitDir(primary);
      await mkdir(path.join(primary, "scripts/workflow"), { recursive: true });
      await copyFile(helperSource, path.join(primary, "scripts/workflow/sync-worktree-agents.mjs"));
      await rm(path.join(commonDir, "codex-local"), { recursive: true, force: true });
      await symlink(external, path.join(commonDir, "codex-local"), "dir");
      const hook = path.join(fixtureParent, "hooks", "sync-agents.sh");
      await mkdir(path.dirname(hook), { recursive: true });
      await writeHook(hook);

      const result = spawnSync("sh", [hook], { cwd: primary, encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.equal(await readFile(path.join(external, "AGENTS.md"), "utf8"), "external duplicate must survive\n");
    } finally {
      await rm(fixtureParent, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked primary policy", async () => {
    const fixtureParent = await mkdtemp(path.join(os.tmpdir(), "nutrition-agents-primary-link-"));
    const primary = path.join(fixtureParent, "primary");
    const external = path.join(fixtureParent, "external-agents.md");
    try {
      await mkdir(primary, { recursive: true });
      git(["init", "--initial-branch=main"], primary);
      git(["config", "user.name", "fixture"], primary);
      git(["config", "user.email", "fixture@example.invalid"], primary);
      await writeFile(path.join(primary, "AGENTS.md"), "tracked placeholder\n");
      git(["add", "AGENTS.md"], primary);
      git(["commit", "-m", "fixture policy"], primary);
      await writeFile(external, "external policy must survive\n");
      await unlink(path.join(primary, "AGENTS.md"));
      await symlink(external, path.join(primary, "AGENTS.md"));
      const commonDir = commonGitDir(primary);
      await installFixture(primary, commonDir);

      const result = spawnSync("sh", [path.join(commonDir, "codex-local/sync-agents.sh")], {
        cwd: primary,
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.equal((await lstat(path.join(primary, "AGENTS.md"))).isSymbolicLink(), true);
      assert.equal(await readFile(external, "utf8"), "external policy must survive\n");
    } finally {
      await rm(fixtureParent, { recursive: true, force: true });
    }
  });

  it("skips a prunable worktree", async () => {
    const fixtureParent = await mkdtemp(path.join(os.tmpdir(), "nutrition-agents-prunable-"));
    const primary = path.join(fixtureParent, "primary");
    const stale = path.join(fixtureParent, "stale");
    try {
      await mkdir(primary, { recursive: true });
      git(["init", "--initial-branch=main"], primary);
      git(["config", "user.name", "fixture"], primary);
      git(["config", "user.email", "fixture@example.invalid"], primary);
      await writeFile(path.join(primary, "AGENTS.md"), "authoritative policy\n");
      git(["add", "AGENTS.md"], primary);
      git(["commit", "-m", "fixture policy"], primary);
      git(["worktree", "add", "--detach", stale], primary);
      await rm(stale, { recursive: true, force: true });
      const commonDir = commonGitDir(primary);
      await installFixture(primary, commonDir);

      const result = spawnSync("sh", [path.join(commonDir, "codex-local/sync-agents.sh")], {
        cwd: primary,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /skippedWorktrees/);
    } finally {
      try {
        git(["worktree", "prune"], primary);
      } catch {
        // Disposable fixture cleanup only.
      }
      await rm(fixtureParent, { recursive: true, force: true });
    }
  });
});
