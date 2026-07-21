process.env.TZ = "Asia/Taipei";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

type IssueFixture = {
  title?: string;
  labels?: string[];
  isPullRequest?: boolean;
};

type PolicyFixture = {
  title: string;
  body: string;
  labels?: string[];
  issues?: Record<number, IssueFixture>;
};

type PolicyRunOptions = {
  cwd?: string;
  args?: string[];
};

const policyScriptPath = path.resolve("scripts/pr-policy-check.mjs");

function runCommand(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
}

function withTemporaryGitRepo(callback: (repoDir: string) => void) {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "nutrition-pr-policy-git-"));

  try {
    runCommand("git", ["init", "--quiet"], repoDir);
    runCommand("git", ["config", "user.email", "test@example.com"], repoDir);
    runCommand("git", ["config", "user.name", "PR Policy Test"], repoDir);
    fs.writeFileSync(path.join(repoDir, ".gitignore"), "ignored-secret.txt\n.env\n!.env.example\n");
    runCommand("git", ["add", ".gitignore"], repoDir);
    runCommand("git", ["commit", "--quiet", "-m", "initial fixture"], repoDir);
    callback(repoDir);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

function policyEnvironment() {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GITHUB_EVENT_PATH: "",
    GITHUB_TOKEN: "",
  };
  delete env.PR_POLICY_OFFLINE_ISSUES;
  return env;
}

function runPrPolicy(fixture: PolicyFixture, options: PolicyRunOptions = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nutrition-pr-policy-"));
  const eventPath = path.join(tempDir, "event.json");
  fs.writeFileSync(
    eventPath,
    JSON.stringify({
      repository: { full_name: "edgejia/Nutrition-Coach" },
      pull_request: {
        number: 999,
        title: fixture.title,
        body: fixture.body,
        labels: (fixture.labels || []).map((name) => ({ name })),
      },
    }),
  );

  const env = policyEnvironment();
  if (fixture.issues) {
    env.PR_POLICY_OFFLINE_ISSUES = JSON.stringify(fixture.issues);
  }

  const result = spawnSync(
    process.execPath,
    [policyScriptPath, `--event=${eventPath}`, ...(options.args || [])],
    {
      cwd: options.cwd || process.cwd(),
      env,
      encoding: "utf8",
    },
  );

  fs.rmSync(tempDir, { recursive: true, force: true });

  return {
    ...result,
    output: `${result.stdout}${result.stderr}`,
  };
}

function runFileOnlyPolicy(cwd: string) {
  const result = spawnSync(process.execPath, [policyScriptPath, "--allow-no-pr", "--base=HEAD"], {
    cwd,
    env: policyEnvironment(),
    encoding: "utf8",
  });

  return {
    ...result,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe("pr policy gate", () => {
  test("passes when a feature PR closes an approved feature issue", () => {
    const result = runPrPolicy({
      title: "feat: add tracker",
      body: "Closes #123",
      labels: ["no-changelog"],
      issues: {
        123: { title: "Feature tracker", labels: ["feature-request", "approved-feature"] },
      },
    });

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Detected PR kind\(s\): feature/);
    assert.match(result.output, /\[pr-policy\] PASS/);
  });

  test("rejects feature approval labels that are only on the PR", () => {
    const result = runPrPolicy({
      title: "feat: add tracker",
      body: "Closes #123",
      labels: ["approved-feature", "no-changelog"],
      issues: {
        123: { title: "Feature tracker", labels: ["feature-request", "needs-review"] },
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.output, /feature PRs require the `approved-feature` label on a linked issue/);
  });

  test("rejects non-closing issue references", () => {
    const result = runPrPolicy({
      title: "feat: add tracker",
      body: "Refs #123",
      labels: ["no-changelog"],
      issues: {
        123: { title: "Feature tracker", labels: ["feature-request", "approved-feature"] },
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.output, /must link at least one GitHub issue/);
  });

  test("allows ignored files that remain untracked in file-only mode", () => {
    withTemporaryGitRepo((repoDir) => {
      fs.writeFileSync(path.join(repoDir, "ignored-secret.txt"), "untracked secret contents\n");

      const result = runFileOnlyPolicy(repoDir);

      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /No pull_request payload; ran file-only policy/);
      assert.match(result.output, /\[pr-policy\] PASS/);
      assert.doesNotMatch(result.output, /untracked secret contents/);
    });
  });

  test("rejects force-added ignored files in file-only mode without printing their contents", () => {
    withTemporaryGitRepo((repoDir) => {
      fs.writeFileSync(path.join(repoDir, "ignored-secret.txt"), "tracked secret contents\n");
      runCommand("git", ["add", "--force", "ignored-secret.txt"], repoDir);

      const result = runFileOnlyPolicy(repoDir);

      assert.notEqual(result.status, 0);
      assert.match(result.output, /Tracked paths match the current ignore policy: "ignored-secret\.txt"/);
      assert.doesNotMatch(result.output, /tracked secret contents/);
    });
  });

  test("rejects force-added ignored files in pull-request mode", () => {
    withTemporaryGitRepo((repoDir) => {
      fs.writeFileSync(path.join(repoDir, "ignored-secret.txt"), "tracked secret contents\n");
      runCommand("git", ["add", "--force", "ignored-secret.txt"], repoDir);

      const result = runPrPolicy(
        {
          title: "feat: add tracker",
          body: "Closes #123",
          labels: ["no-changelog"],
          issues: {
            123: { title: "Feature tracker", labels: ["feature-request", "approved-feature"] },
          },
        },
        { cwd: repoDir, args: ["--base=HEAD"] },
      );

      assert.notEqual(result.status, 0);
      assert.match(result.output, /Tracked paths match the current ignore policy: "ignored-secret\.txt"/);
      assert.doesNotMatch(result.output, /tracked secret contents/);
    });
  });

  test("allows tracked files explicitly unignored by policy", () => {
    withTemporaryGitRepo((repoDir) => {
      fs.writeFileSync(path.join(repoDir, ".env.example"), "SAFE_EXAMPLE=value\n");
      runCommand("git", ["add", ".env.example"], repoDir);

      const result = runFileOnlyPolicy(repoDir);

      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /\[pr-policy\] PASS/);
    });
  });
});
