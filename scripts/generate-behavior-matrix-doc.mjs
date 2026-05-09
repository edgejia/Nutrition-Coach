#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { ALL_BEHAVIOR_CASES } from "../tests/harness/behavior-matrix.ts";

const OUTPUT_PATH = "tests/harness/behavior-matrix.md";
const SOURCE_PATH = "tests/harness/behavior-matrix.ts";
const CHECK_FLAG = "--check";

function escapeCell(value) {
  const text = Array.isArray(value) ? value.join("<br>") : (value ?? "");
  const normalized = String(text).replace(/\r?\n/g, " ").trim();
  return normalized.replace(/\|/g, "\\|");
}

function tableRow(values) {
  return values.map(escapeCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function riskDistributionRows() {
  const counts = new Map();
  for (const behaviorCase of ALL_BEHAVIOR_CASES) {
    for (const risk of behaviorCase.risks) {
      counts.set(risk, (counts.get(risk) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function renderMarkdown() {
  const lines = [
    "# Behavior Matrix",
    "",
    `Generated from ${SOURCE_PATH}.`,
    "",
    "Run `yarn behavior-matrix:gen` to update this file and `yarn behavior-matrix:gen:check` before commit.",
    "",
    "## Cases",
    "",
    "| Case | Title | Requirements | Risks | Allowed Tools |",
    "|---|---|---|---|---|",
  ];

  for (const behaviorCase of ALL_BEHAVIOR_CASES) {
    lines.push(
      tableRow([
        behaviorCase.caseId,
        behaviorCase.title,
        behaviorCase.requirements,
        behaviorCase.risks,
        behaviorCase.allowedTools.length > 0 ? behaviorCase.allowedTools : "none",
      ]),
    );
  }

  lines.push(
    "",
    "## Risk Coverage Distribution",
    "",
    "| Risk | Case Count | Cases |",
    "|---|---:|---|",
  );

  for (const [risk, count] of riskDistributionRows()) {
    const cases = ALL_BEHAVIOR_CASES
      .filter((behaviorCase) => behaviorCase.risks.includes(risk))
      .map((behaviorCase) => behaviorCase.caseId);
    lines.push(tableRow([risk, count, cases]));
  }

  lines.push(
    "",
    "## Risk To Assertion Coverage",
    "",
    "| Case | Risk | Assertions |",
    "|---|---|---|",
  );

  for (const behaviorCase of ALL_BEHAVIOR_CASES) {
    for (const entry of behaviorCase.coverage) {
      lines.push(tableRow([behaviorCase.caseId, entry.risk, entry.assertions]));
    }
  }

  lines.push(
    "",
    "## Expected Failures",
    "",
    "| Case | Assertion | Reason | Expected Resolution Phase | Expires When |",
    "|---|---|---|---:|---|",
  );

  let expectedFailureCount = 0;
  for (const behaviorCase of ALL_BEHAVIOR_CASES) {
    for (const expectedFailure of behaviorCase.expectedFailures ?? []) {
      expectedFailureCount += 1;
      lines.push(
        tableRow([
          behaviorCase.caseId,
          expectedFailure.assertionName,
          expectedFailure.reason,
          expectedFailure.expectedResolutionPhase,
          expectedFailure.expiresWhen,
        ]),
      );
    }
  }

  if (expectedFailureCount === 0) {
    lines.push(tableRow(["none", "none", "none", "none", "none"]));
  }

  lines.push("");
  return lines.join("\n");
}

const nextContent = renderMarkdown();

if (process.argv.includes(CHECK_FLAG)) {
  const currentContent = await readFile(OUTPUT_PATH, "utf8").catch(() => null);
  if (currentContent !== nextContent) {
    console.error(
      "tests/harness/behavior-matrix.md is out of sync with tests/harness/behavior-matrix.ts; run yarn behavior-matrix:gen and commit the result",
    );
    process.exit(1);
  }
  process.exit(0);
}

await writeFile(OUTPUT_PATH, nextContent, "utf8");
