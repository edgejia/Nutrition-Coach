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

function runPrPolicy(fixture: PolicyFixture) {
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

  const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_TOKEN: "" };
  if (fixture.issues) {
    env.PR_POLICY_OFFLINE_ISSUES = JSON.stringify(fixture.issues);
  } else {
    delete env.PR_POLICY_OFFLINE_ISSUES;
  }

  const result = spawnSync(process.execPath, ["scripts/pr-policy-check.mjs", `--event=${eventPath}`], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  fs.rmSync(tempDir, { recursive: true, force: true });

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
});
