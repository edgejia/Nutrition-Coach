#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

const DEFAULT_API_URL = "https://api.github.com";

function parseArgs(argv) {
  const options = {
    eventPath: process.env.GITHUB_EVENT_PATH || null,
    baseRef: process.env.RELEASE_BASE_REF || "origin/main",
    allowNoPr: false,
  };

  for (const arg of argv) {
    if (arg === "--allow-no-pr") {
      options.allowNoPr = true;
    } else if (arg.startsWith("--event=")) {
      options.eventPath = arg.slice("--event=".length);
    } else if (arg.startsWith("--base=")) {
      options.baseRef = arg.slice("--base=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readEvent(options) {
  const event = readJsonFile(options.eventPath);
  if (event?.pull_request) {
    return event;
  }

  if (options.allowNoPr) {
    return event || {};
  }

  throw new Error("PR policy check requires a pull_request event.");
}

function parseRepo(event) {
  const fullName = event.repository?.full_name || process.env.GITHUB_REPOSITORY;
  if (!fullName || !fullName.includes("/")) {
    throw new Error("Unable to determine GitHub repository.");
  }

  const [owner, repo] = fullName.split("/");
  return { owner, repo, fullName };
}

function normalizeLabel(label) {
  return String(label || "").trim().toLowerCase();
}

function labelsFrom(items) {
  return new Set(
    (items || [])
      .map((label) => normalizeLabel(typeof label === "string" ? label : label.name))
      .filter(Boolean),
  );
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function listChangedFilesFromGit(baseRef) {
  try {
    const mergeBase = runGit(["merge-base", "HEAD", baseRef]);
    return runGit(["diff", "--name-only", "--diff-filter=ACMR", `${mergeBase}..HEAD`])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseLinkedIssueNumbers(text) {
  const numbers = new Set();
  const body = text || "";
  const closingPattern =
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|references?)\s+(?:https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/)?#?(\d+)\b/gi;
  const issueUrlPattern = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)\b/gi;

  for (const pattern of [closingPattern, issueUrlPattern]) {
    let match;
    while ((match = pattern.exec(body)) !== null) {
      numbers.add(Number(match[1]));
    }
  }

  return [...numbers].sort((a, b) => a - b);
}

function offlineIssues() {
  const raw = process.env.PR_POLICY_OFFLINE_ISSUES;
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw);
  return new Map(
    Object.entries(parsed).map(([number, issue]) => [
      Number(number),
      {
        number: Number(number),
        title: issue.title || `Issue #${number}`,
        labels: [...labelsFrom(issue.labels || [])],
        isPullRequest: Boolean(issue.isPullRequest),
      },
    ]),
  );
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nutrition-coach-pr-policy",
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${detail.slice(0, 300)}`);
  }

  return response.json();
}

async function fetchPaginated(path, token) {
  const apiUrl = process.env.GITHUB_API_URL || DEFAULT_API_URL;
  const results = [];

  for (let page = 1; page <= 10; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const url = `${apiUrl}${path}${separator}per_page=100&page=${page}`;
    const batch = await fetchJson(url, token);
    if (!Array.isArray(batch)) {
      throw new Error(`Expected array response from ${path}`);
    }
    results.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }

  return results;
}

async function listChangedFiles({ event, repo, prNumber, baseRef }) {
  const token = process.env.GITHUB_TOKEN;
  if (token && prNumber) {
    const files = await fetchPaginated(`/repos/${repo.owner}/${repo.repo}/pulls/${prNumber}/files`, token);
    return files.map((file) => file.filename).filter(Boolean);
  }

  return listChangedFilesFromGit(baseRef);
}

async function fetchIssues(repo, numbers) {
  const offline = offlineIssues();
  if (offline) {
    return numbers.map((number) => {
      const issue = offline.get(number);
      if (!issue) {
        throw new Error(`Offline issue fixture is missing #${number}`);
      }
      return issue;
    });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required to verify linked issue labels.");
  }

  const issues = [];
  const apiUrl = process.env.GITHUB_API_URL || DEFAULT_API_URL;
  for (const number of numbers) {
    const issue = await fetchJson(`${apiUrl}/repos/${repo.owner}/${repo.repo}/issues/${number}`, token);
    issues.push({
      number,
      title: issue.title || `Issue #${number}`,
      labels: [...labelsFrom(issue.labels || [])],
      isPullRequest: Boolean(issue.pull_request),
    });
  }
  return issues;
}

function inferPrKinds({ title, body, issueLabels }) {
  const text = `${title || ""}\n${body || ""}`;
  const kinds = new Set();

  if (/##\s*Feature PR/i.test(text) || /\[Feature\]/i.test(text) || /^\s*feat(?:\(|:|\s)/i.test(title || "")) {
    kinds.add("feature");
  }
  if (/##\s*Enhancement PR/i.test(text) || /\[Enhancement\]/i.test(text)) {
    kinds.add("enhancement");
  }
  if (/##\s*Fix PR/i.test(text) || /\[Bug\]/i.test(text) || /^\s*fix(?:\(|:|\s)/i.test(title || "")) {
    kinds.add("fix");
  }

  if (issueLabels.has("feature-request")) {
    kinds.add("feature");
  }
  if (issueLabels.has("enhancement")) {
    kinds.add("enhancement");
  }
  if (issueLabels.has("bug")) {
    kinds.add("fix");
  }

  return kinds;
}

function hasAnyLabel(labels, names) {
  return names.some((name) => labels.has(name));
}

function reportAndExit(errors, notes) {
  for (const note of notes) {
    console.log(`[pr-policy] ${note}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`[pr-policy] FAIL: ${error}`);
    }
    process.exit(1);
  }

  console.log("[pr-policy] PASS");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const event = readEvent(options);
  const pr = event.pull_request;
  const errors = [];
  const notes = [];

  if (!pr) {
    const files = listChangedFilesFromGit(options.baseRef);
    if (files.some((file) => file.startsWith(".planning/"))) {
      errors.push("Source changes must not include .planning/** local GSD state.");
    }
    reportAndExit(errors, ["No pull_request payload; ran file-only policy."]);
    return;
  }

  const repo = parseRepo(event);
  const body = pr.body || "";
  const linkedNumbers = parseLinkedIssueNumbers(`${pr.title || ""}\n${body}`);
  if (linkedNumbers.length === 0) {
    errors.push("PR body/title must link at least one GitHub issue (for example: Closes #123).");
  }

  const changedFiles = await listChangedFiles({
    event,
    repo,
    prNumber: pr.number,
    baseRef: options.baseRef,
  });
  if (changedFiles.some((file) => file.startsWith(".planning/"))) {
    errors.push("PR includes .planning/** local GSD state; keep planning state local-only.");
  }

  const issues = linkedNumbers.length > 0 ? await fetchIssues(repo, linkedNumbers) : [];
  for (const issue of issues) {
    if (issue.isPullRequest) {
      errors.push(`#${issue.number} is a pull request, not a tracker issue.`);
    }
  }

  const prLabels = labelsFrom(pr.labels || []);
  const issueLabels = new Set(issues.flatMap((issue) => issue.labels));
  const allLabels = new Set([...prLabels, ...issueLabels]);
  const kinds = inferPrKinds({ title: pr.title, body, issueLabels });

  const requiredByKind = {
    feature: "approved-feature",
    enhancement: "approved-enhancement",
    fix: "confirmed-bug",
  };

  for (const kind of kinds) {
    const required = requiredByKind[kind];
    if (!allLabels.has(required)) {
      errors.push(`${kind} PRs require the \`${required}\` label on the linked issue or PR.`);
    }
  }

  const hasChangelog = changedFiles.includes("CHANGELOG.md");
  if (!hasChangelog && !hasAnyLabel(allLabels, ["no-changelog"])) {
    errors.push("PR must update CHANGELOG.md or carry the `no-changelog` label.");
  }

  notes.push(`Linked issue(s): ${linkedNumbers.length > 0 ? linkedNumbers.map((n) => `#${n}`).join(", ") : "none"}`);
  notes.push(`Changed files considered: ${changedFiles.length}`);
  notes.push(`Detected PR kind(s): ${kinds.size > 0 ? [...kinds].join(", ") : "chore/other"}`);
  reportAndExit(errors, notes);
}

main().catch((error) => {
  console.error(`[pr-policy] ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
