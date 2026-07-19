#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const YARN_BIN = process.platform === "win32" ? "yarn.cmd" : "yarn";
const ALL_FLAG = "--all";
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

function escapeCell(value) {
  const text = value ?? "";
  const normalized = String(text).replace(/\r?\n/g, " ").trim();
  return normalized.replace(/\|/g, "\\|");
}

function normalizePath(path) {
  return String(path || "unknown").split(">").map((part) => part.trim()).filter(Boolean).join(" > ") || "unknown";
}

function topLevelPackage(dependencyPath) {
  return dependencyPath.split(" > ")[0] || "unknown";
}

function resolveScope(resolution, dependencyPath, dependencyGroups) {
  const topLevel = topLevelPackage(dependencyPath);
  if (dependencyGroups?.dependencies?.has(topLevel)) {
    return "runtime";
  }
  if (dependencyGroups?.devDependencies?.has(topLevel)) {
    return "dev";
  }
  return resolution.dev ? "dev" : "runtime";
}

function firstFinding(advisory) {
  return Array.isArray(advisory.findings) && advisory.findings.length > 0 ? advisory.findings[0] : {};
}

function advisoryId(advisory) {
  return advisory.github_advisory_id || advisory.cves?.[0] || String(advisory.id ?? "unknown");
}

function normalizeErrorRecord(data) {
  void data;
  return "Yarn audit emitted an error record";
}

function vulnerabilityCounts(auditSummary) {
  const vulnerabilities = auditSummary?.vulnerabilities || {};
  return Object.fromEntries(SEVERITIES.map((severity) => [severity, Number(vulnerabilities[severity] || 0)]));
}

function totalFromCounts(counts) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function scopeFromArgs(args) {
  return args.includes("--groups") && args.includes("dependencies") ? "runtime dependencies" : "all dependency groups";
}

export function buildYarnAuditArgs(argv = []) {
  const args = [...argv];
  const unsupported = args.filter((arg) => arg !== ALL_FLAG);
  if (unsupported.length > 0) {
    throw new Error(`Unsupported deps:audit flag: ${unsupported[0]}`);
  }

  return args.includes(ALL_FLAG) ? ["audit", "--json"] : ["audit", "--groups", "dependencies", "--json"];
}

export function parseYarnAuditJsonLines(stdout, options = {}) {
  const lines = String(stdout || "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const records = [];
  const advisories = [];
  const errors = [];
  let auditSummary = null;

  lines.forEach((line, index) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`Invalid Yarn audit JSON on line ${index + 1}`);
    }

    records.push(record);

    if (record.type === "auditAdvisory") {
      const advisory = record.data?.advisory || {};
      const resolution = record.data?.resolution || {};
      const finding = firstFinding(advisory);
      const dependencyPath = normalizePath(resolution.path || finding.paths?.[0]);

      advisories.push({
        packageName: advisory.module_name || dependencyPath.split(" > ").at(-1) || "unknown",
        severity: advisory.severity || "unknown",
        advisoryId: advisoryId(advisory),
        title: advisory.title || "Untitled advisory",
        url: advisory.url || "",
        dependencyPath,
        dependencyType: dependencyPath.includes(" > ") ? "transitive" : "direct",
        scope: resolveScope(resolution, dependencyPath, options.dependencyGroups),
        currentVersion: finding.version || "unknown",
        vulnerableRange: advisory.vulnerable_versions || "unknown",
        patchedRange: advisory.patched_versions || "unknown",
      });
    } else if (record.type === "auditSummary") {
      auditSummary = record.data || {};
    } else if (record.type === "error") {
      errors.push(normalizeErrorRecord(record.data));
    }
  });

  return { records, advisories, auditSummary, errors };
}

function readDependencyGroups() {
  try {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"));
    return {
      dependencies: new Set(Object.keys(manifest.dependencies || {})),
      devDependencies: new Set(Object.keys(manifest.devDependencies || {})),
    };
  } catch {
    return null;
  }
}

export function summarizeAudit(parsed, options = {}) {
  const args = options.args || buildYarnAuditArgs([]);
  const exitStatus = options.exitStatus ?? 0;
  const counts = vulnerabilityCounts(parsed.auditSummary);
  const messages = [];
  const executionError = options.executionError ? String(options.executionError) : null;

  if (executionError) {
    messages.push(executionError);
  }
  messages.push(...parsed.errors);

  let status = "completed";
  let evidenceState = "scanner_success";

  if (options.endpointStatus === 410 || options.executionError) {
    status = "execution_failed";
    evidenceState = "endpoint_failure";
    messages.length = 0;
    messages.push(options.endpointStatus === 410
      ? "Advisory endpoint returned HTTP 410"
      : "Advisory scanner execution failed");
  } else if (parsed.errors.length > 0) {
    status = "execution_failed";
    evidenceState = "error_record";
  } else if (parsed.records.length === 0 && exitStatus !== 0) {
    status = "execution_failed";
    evidenceState = "endpoint_failure";
    messages.push(`Yarn exited with status ${exitStatus} and produced no JSON-lines output`);
  } else if (!parsed.auditSummary) {
    status = "incomplete";
    evidenceState = "incomplete";
    messages.push("Yarn audit output did not include an auditSummary record");
  } else if (exitStatus !== 0) {
    evidenceState = "advisory_bitmask";
  }

  return {
    status,
    evidenceState,
    clean: evidenceState === "scanner_success" && totalFromCounts(counts) === 0,
    scope: scopeFromArgs(args),
    command: `yarn ${args.join(" ")}`,
    args,
    exitStatus,
    advisories: parsed.advisories,
    vulnerabilities: counts,
    totalVulnerabilities: totalFromCounts(counts),
    messages,
  };
}

/**
 * Classify injected or collected advisory evidence without ever treating a
 * missing, malformed, unavailable, or error response as a clean audit.
 * Malformed input is reduced to a fixed message and never returned verbatim.
 */
export function classifyAuditEvidence(stdout, options = {}) {
  const args = options.args || buildYarnAuditArgs([]);
  try {
    const parsed = parseYarnAuditJsonLines(stdout, options);
    return summarizeAudit(parsed, { ...options, args });
  } catch {
    const counts = vulnerabilityCounts(null);
    return {
      status: "malformed",
      evidenceState: "malformed",
      clean: false,
      scope: scopeFromArgs(args),
      command: `yarn ${args.join(" ")}`,
      args,
      exitStatus: options.exitStatus ?? 1,
      advisories: [],
      vulnerabilities: counts,
      totalVulnerabilities: totalFromCounts(counts),
      messages: ["Yarn audit output was malformed JSONL"],
    };
  }
}

export function renderAuditReport(summary) {
  const lines = [
    "# Dependency Advisory Audit",
    "",
    `Command: \`${summary.command}\``,
    `Scope: ${summary.scope}`,
    `Exit status: ${summary.exitStatus}`,
    `Evidence state: ${summary.evidenceState || "unknown"}`,
    `Clean: ${summary.clean === true ? "yes" : "no"}`,
    "",
  ];

  if (summary.status === "execution_failed") {
    lines.push("## Audit execution failed", "");
    lines.push("Do not treat this run as clean advisory evidence.");
    for (const message of summary.messages) {
      lines.push(`- ${message}`);
    }
  } else if (summary.status === "incomplete") {
    lines.push("## Audit incomplete", "");
    lines.push("Do not treat this run as clean advisory evidence.");
    for (const message of summary.messages) {
      lines.push(`- ${message}`);
    }
  } else if (summary.evidenceState === "malformed") {
    lines.push("## Audit malformed", "");
    lines.push("Do not treat this run as clean advisory evidence.");
    for (const message of summary.messages) {
      lines.push(`- ${message}`);
    }
  } else {
    lines.push("## Summary", "");
    lines.push(`Completed audit found ${summary.advisories.length} advisories.`);
    lines.push(
      `Severity counts: ${SEVERITIES.map((severity) => `${severity}=${summary.vulnerabilities[severity]}`).join(", ")}.`,
    );
    if (summary.exitStatus !== 0) {
      lines.push(`Yarn exited with advisory bitmask status ${summary.exitStatus}; audit output was parsed as evidence.`);
    }
    if (summary.advisories.length === 0) {
      lines.push("No advisories were reported in the completed Yarn audit summary.");
    }
  }

  if (summary.advisories.length > 0) {
    lines.push(
      "",
      "## Advisories",
      "",
      "| Package | Severity | Advisory | Dependency Path | Scope | Current | Vulnerable | Patched |",
      "|---|---|---|---|---|---|---|---|",
    );

    for (const advisory of summary.advisories) {
      const advisoryLabel = advisory.url
        ? `[${escapeCell(advisory.advisoryId)}](${advisory.url}) ${escapeCell(advisory.title)}`
        : `${escapeCell(advisory.advisoryId)} ${escapeCell(advisory.title)}`;
      lines.push(
        [
          advisory.packageName,
          advisory.severity,
          advisoryLabel,
          `${advisory.dependencyPath} (${advisory.dependencyType})`,
          advisory.scope,
          advisory.currentVersion,
          advisory.vulnerableRange,
          advisory.patchedRange,
        ].map(escapeCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"),
      );
    }
  }

  lines.push(
    "",
    "## Raw Evidence",
    "",
    `Save raw JSONL evidence with \`${summary.command} > /tmp/nutrition-dependency-audit.jsonl\` for release or deferral review.`,
    "",
  );

  return lines.join("\n");
}

function runCli() {
  let args;
  try {
    args = buildYarnAuditArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const result = spawnSync(YARN_BIN, args, { encoding: "utf8" });

  try {
    const parsed = parseYarnAuditJsonLines(result.stdout || "", { dependencyGroups: readDependencyGroups() });
    const summary = summarizeAudit(parsed, {
      args,
      exitStatus: result.status ?? 1,
      executionError: result.error?.message,
    });
    console.log(renderAuditReport(summary));
    process.exit(summary.status === "completed" ? 0 : 1);
  } catch (error) {
    console.error("# Dependency Advisory Audit");
    console.error("");
    console.error("Audit parsing failed. Do not treat this run as clean advisory evidence.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
