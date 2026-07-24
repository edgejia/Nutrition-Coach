process.env.TZ = "Asia/Taipei";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
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
  env?: NodeJS.ProcessEnv;
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
      env: { ...env, ...(options.env || {}) },
      encoding: "utf8",
    },
  );

  fs.rmSync(tempDir, { recursive: true, force: true });

  return {
    ...result,
    output: `${result.stdout}${result.stderr}`,
  };
}

async function runPrPolicyAsync(fixture: PolicyFixture, options: PolicyRunOptions = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nutrition-pr-policy-"));
  const eventPath = path.join(tempDir, "event.json");
  fs.writeFileSync(eventPath, JSON.stringify({
    repository: { full_name: "edgejia/Nutrition-Coach" },
    pull_request: {
      number: 999,
      title: fixture.title,
      body: fixture.body,
      labels: (fixture.labels || []).map((name) => ({ name })),
    },
  }));
  const env = policyEnvironment();
  if (fixture.issues) env.PR_POLICY_OFFLINE_ISSUES = JSON.stringify(fixture.issues);
  const child = spawn(process.execPath, [policyScriptPath, `--event=${eventPath}`, ...(options.args || [])], {
    cwd: options.cwd || process.cwd(),
    env: { ...env, ...(options.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  fs.rmSync(tempDir, { recursive: true, force: true });
  return { status, stdout, stderr, output: `${stdout}${stderr}` };
}

function runFileOnlyPolicy(cwd: string, base = "HEAD") {
  const result = spawnSync(process.execPath, [policyScriptPath, "--allow-no-pr", `--base=${base}`], {
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
  test("fails closed when GitHub file pagination reaches the hard page limit", async () => {
    const server = createServer((request, response) => {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (url.pathname.endsWith("/files")) {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ filename: `src/file-${url.searchParams.get("page")}-${index}.ts` }))));
        return;
      }
      response.statusCode = 404;
      response.end("not found");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.equal(typeof address, "object");
    try {
      const result = await runPrPolicyAsync(
        {
          title: "chore: large policy fixture",
          body: "Closes #123",
          labels: ["no-changelog"],
          issues: { 123: { title: "Maintenance", labels: [] } },
        },
        {
          env: {
            GITHUB_TOKEN: "fixture-token",
            GITHUB_API_URL: `http://127.0.0.1:${(address as { port: number }).port}`,
          },
        },
      );
      assert.notEqual(result.status, 0);
      assert.match(result.output, /file list .*incomplete/i);
      assert.doesNotMatch(result.output, /\[pr-policy\] PASS/);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  test("passes when a feature PR closes an approved feature issue", () => {
    const result = runPrPolicy({
      title: "feat: add tracker",
      body: "Closes #123",
      labels: ["no-changelog"],
      issues: {
        123: { title: "Feature tracker", labels: ["feature-request", "approved-feature", "ready-for-pr"] },
      },
    });

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Detected PR kind\(s\): feature/);
    assert.match(result.output, /\[pr-policy\] PASS/);
  });

  test("requires issue-side ready-for-pr on the linked issue", () => {
    const result = runPrPolicy({
      title: "feat: add tracker",
      body: "Closes #123",
      labels: ["no-changelog"],
      issues: {
        123: { title: "Feature tracker", labels: ["feature-request", "approved-feature"] },
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.output, /#123.*ready-for-pr/);
  });

  test("does not accept an issue-side no-changelog label", () => {
    const result = runPrPolicy({
      title: "[Chore] tidy policy docs",
      body: "Closes #123",
      issues: {
        123: { title: "Maintenance", labels: ["type: chore", "ready-for-pr", "no-changelog"] },
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.output, /must update CHANGELOG\.md or carry the `no-changelog` label/);
  });

  test("maps fixed request markers to their stable PR kinds", () => {
    const cases = [
      {
        marker: "Feature",
        kind: "feature",
        labels: ["feature-request", "approved-feature", "ready-for-pr"],
      },
      {
        marker: "Enhancement",
        kind: "enhancement",
        labels: ["enhancement", "approved-enhancement", "ready-for-pr"],
      },
      {
        marker: "Bug",
        kind: "fix",
        labels: ["bug", "confirmed-bug", "ready-for-pr"],
      },
      {
        marker: "Chore",
        kind: "chore",
        labels: ["type: chore", "ready-for-pr"],
      },
    ];

    for (const { marker, kind, labels } of cases) {
      const result = runPrPolicy({
        title: `[${marker}] update policy`,
        body: "Closes #123",
        labels: ["no-changelog"],
        issues: { 123: { title: "Request", labels } },
      });

      assert.equal(result.status, 0, `${marker} marker failed:\n${result.output}`);
      assert.match(result.output, new RegExp(`Detected PR kind\\(s\\): ${kind}\\n`));
    }
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

  test("allows a full issue URL only when it targets the event repository", () => {
    const result = runPrPolicy({
      title: "feat: add tracker",
      body: "Closes https://github.com/edgejia/Nutrition-Coach/issues/123",
      labels: ["no-changelog"],
      issues: {
        123: { title: "Feature tracker", labels: ["feature-request", "approved-feature"] },
      },
    });

    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /Linked issue\(s\): #123/);
  });

  test("rejects an external issue URL even when its number has an approved local fixture", () => {
    const result = runPrPolicy({
      title: "feat: add tracker",
      body: "Closes https://github.com/another-owner/another-repo/issues/123",
      labels: ["no-changelog"],
      issues: {
        123: { title: "Feature tracker", labels: ["feature-request", "approved-feature"] },
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.output, /targets an external repository/);
  });

  test("rejects pull-request URLs as tracker references", () => {
    const result = runPrPolicy({
      title: "feat: add tracker",
      body: "Closes https://github.com/edgejia/Nutrition-Coach/pull/123",
      labels: ["no-changelog"],
      issues: {
        123: { title: "Feature tracker", labels: ["feature-request", "approved-feature"] },
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.output, /targets a pull request/);
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

  test("fails closed when the merge-base cannot be computed", () => {
    withTemporaryGitRepo((repoDir) => {
      const result = runFileOnlyPolicy(repoDir, "missing-base-ref");

      assert.notEqual(result.status, 0);
      assert.match(result.output, /merge-base|missing-base-ref/);
      assert.doesNotMatch(result.output, /\[pr-policy\] PASS/);
    });
  });

  test("includes deleted paths when checking the complete diff", () => {
    withTemporaryGitRepo((repoDir) => {
      const forbiddenPath = path.join(repoDir, ".planning", "deleted.md");
      fs.mkdirSync(path.dirname(forbiddenPath), { recursive: true });
      fs.writeFileSync(forbiddenPath, "local planning state\n");
      runCommand("git", ["add", ".planning/deleted.md"], repoDir);
      runCommand("git", ["commit", "--quiet", "-m", "add planning fixture"], repoDir);
      const base = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).stdout.trim();

      fs.rmSync(forbiddenPath);
      runCommand("git", ["add", "-u", ".planning/deleted.md"], repoDir);
      runCommand("git", ["commit", "--quiet", "-m", "delete planning fixture"], repoDir);

      const result = runPrPolicy(
        {
          title: "chore: remove local planning fixture",
          body: "Closes #123",
          labels: ["no-changelog"],
          issues: { 123: { title: "Maintenance", labels: [] } },
        },
        { cwd: repoDir, args: [`--base=${base}`] },
      );

      assert.notEqual(result.status, 0);
      assert.match(result.output, /\.planning\/\*\* local GSD state/);
    });
  });
});
