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

  const [owner, repo, ...extra] = fullName.split("/");
  if (!owner || !repo || extra.length > 0) {
    throw new Error("Unable to determine GitHub repository owner/repository.");
  }
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

function listTrackedIgnoredFiles() {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--ignored", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
}

function listChangedFilesFromGit(baseRef) {
  const mergeBase = runGit(["merge-base", "HEAD", baseRef]);
  return runGit(["diff", "--name-only", "--diff-filter=ACMRD", `${mergeBase}..HEAD`])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseLinkedIssueReferences(text, repository) {
  const numbers = new Set();
  const errors = [];
  const body = text || "";
  const closingPattern =
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:(https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(issues|pulls?)\/(\d+))|#?(\d+))\b/gi;

  let match;
  while ((match = closingPattern.exec(body)) !== null) {
    const [, url, owner, repo, targetType, urlNumber, bareNumber] = match;
    if (!url) {
      numbers.add(Number(bareNumber));
      continue;
    }

    const sameRepository =
      repository &&
      owner.toLowerCase() === repository.owner.toLowerCase() &&
      repo.toLowerCase() === repository.repo.toLowerCase();
    if (!sameRepository) {
      errors.push(`Issue URL ${url} targets an external repository; use ${repository.fullName}.`);
      continue;
    }
    if (targetType.toLowerCase().startsWith("pull")) {
      errors.push(`${url} targets a pull request; linked references must target an issue.`);
      continue;
    }
    numbers.add(Number(urlNumber));
  }

  return { numbers: [...numbers].sort((a, b) => a - b), errors };
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
      return results;
    }
    if (page === 10) {
      throw new Error(`GitHub file list for ${path} is incomplete after 1,000 entries; refusing to make a policy decision.`);
    }
  }

  throw new Error(`GitHub file list for ${path} is incomplete; refusing to make a policy decision.`);
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

function requestMarkers({ title, body }) {
  const text = `${title || ""}\n${body || ""}`;
  return [...text.matchAll(/\[(Feature|Enhancement|Bug|Chore)\]/gi)].map((match) => match[1].toLowerCase() === "bug" ? "fix" : match[1].toLowerCase());
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
  const trackedIgnoredFiles = listTrackedIgnoredFiles();

  if (trackedIgnoredFiles.length > 0) {
    errors.push(
      `Tracked paths match the current ignore policy: ${trackedIgnoredFiles.map((file) => JSON.stringify(file)).join(", ")}`,
    );
  }

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
  const linkedReferences = parseLinkedIssueReferences(`${pr.title || ""}\n${body}`, repo);
  const linkedNumbers = linkedReferences.numbers;
  errors.push(...linkedReferences.errors);
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
    if (!issue.labels.includes("ready-for-pr")) {
      errors.push(`Linked issue #${issue.number} must carry the \`ready-for-pr\` label.`);
    }
  }

  const prLabels = labelsFrom(pr.labels || []);
  const markers = requestMarkers({ title: pr.title, body });
  if (markers.length !== 1) {
    errors.push("PR title/body must contain exactly one request marker: [Feature], [Enhancement], [Bug], or [Chore].");
  }
  // Request kind comes only from the single structured marker. Issue labels
  // remain same-issue approval evidence and can never silently infer a kind.
  const kinds = new Set(markers.length === 1 ? markers : []);

  const requiredByKind = {
    feature: { type: "feature-request", approval: "approved-feature" },
    enhancement: { type: "enhancement", approval: "approved-enhancement" },
    fix: { type: "bug", approval: "confirmed-bug" },
  };

  for (const kind of kinds) {
    if (kind === "chore") {
      if (!issues.some((issue) => issue.labels.includes("type: chore"))) {
        errors.push("chore PRs require the `type: chore` label on a linked issue.");
      }
      continue;
    }

    const required = requiredByKind[kind];
    const hasSameIssueApproval = issues.some((issue) => {
      const labels = new Set(issue.labels);
      return labels.has(required.type) && labels.has(required.approval);
    });
    if (!hasSameIssueApproval) {
      errors.push(
        `${kind} PRs require the \`${required.approval}\` label on a linked issue with \`${required.type}\`; labels cannot be split across issues.`,
      );
    }
  }

  const hasChangelog = changedFiles.includes("CHANGELOG.md");
  if (!hasChangelog && !hasAnyLabel(prLabels, ["no-changelog"])) {
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
