import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const repositoryRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const helperSource = path.join(repositoryRoot, "scripts/workflow/sync-worktree-agents.mjs");
const hookSource = path.join(repositoryRoot, ".git/codex-local/sync-agents.sh");

function git(args: string[], cwd: string) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("ignored AGENTS worktree synchronization", () => {
  it("keeps the fixture primary file authoritative and links detached worktrees to it", async () => {
    const fixtureParent = await mkdtemp(path.join(os.tmpdir(), "nutrition-agents-sync-"));
    const primary = path.join(fixtureParent, "primary");
    const secondary = path.join(fixtureParent, "detached");

    try {
      await mkdir(primary, { recursive: true });
      git(["init", "--initial-branch=main"], primary);
      git(["config", "user.name", "fixture"], primary);
      git(["config", "user.email", "fixture@example.invalid"], primary);
      const authoritative = "fixture authoritative policy\n";
      await writeFile(path.join(primary, "AGENTS.md"), authoritative);
      git(["add", "AGENTS.md"] , primary);
      git(["commit", "-m", "fixture policy"], primary);
      git(["worktree", "add", "--detach", secondary], primary);

      await writeFile(path.join(secondary, "AGENTS.md"), "stale detached policy\n");
      const commonDir = git(["rev-parse", "--git-common-dir"], secondary).trim();
      await mkdir(path.join(commonDir, "codex-local"), { recursive: true });
      await writeFile(path.join(commonDir, "codex-local", "AGENTS.md"), "stale common policy\n");

      await mkdir(path.join(primary, "scripts/workflow"), { recursive: true });
      await copyFile(helperSource, path.join(primary, "scripts/workflow/sync-worktree-agents.mjs"));
      await mkdir(path.join(secondary, "scripts/workflow"), { recursive: true });
      await copyFile(helperSource, path.join(secondary, "scripts/workflow/sync-worktree-agents.mjs"));
      await copyFile(hookSource, path.join(commonDir, "codex-local/sync-agents.sh"));

      const result = spawnSync("sh", [path.join(commonDir, "codex-local/sync-agents.sh")], {
        cwd: primary,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);

      const primaryStat = await lstat(path.join(primary, "AGENTS.md"));
      assert.equal(primaryStat.isFile(), true);
      assert.equal(primaryStat.isSymbolicLink(), false);
      assert.equal(await readFile(path.join(primary, "AGENTS.md"), "utf8"), authoritative);
      await assert.rejects(readFile(path.join(commonDir, "codex-local", "AGENTS.md")), { code: "ENOENT" });

      const secondaryAgent = path.join(secondary, "AGENTS.md");
      const secondaryStat = await lstat(secondaryAgent);
      assert.equal(secondaryStat.isSymbolicLink(), true);
      assert.equal(await readlink(secondaryAgent), path.join(await realpath(primary), "AGENTS.md"));
      assert.equal(await readFile(secondaryAgent, "utf8"), authoritative);

      const secondRun = spawnSync("sh", [path.join(commonDir, "codex-local/sync-agents.sh")], {
        cwd: secondary,
        encoding: "utf8",
      });
      assert.equal(secondRun.status, 0, secondRun.stderr);
      assert.equal(await readFile(secondaryAgent, "utf8"), authoritative);
    } finally {
      try {
        git(["worktree", "remove", "--force", secondary], primary);
      } catch {
        // The fixture directory is disposable; a failed metadata cleanup must
        // never reach the real repository's Git common directory.
      }
      await rm(fixtureParent, { recursive: true, force: true });
    }
  });
});
