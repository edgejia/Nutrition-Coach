process.env.TZ = "Asia/Taipei";

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  buildYarnAuditArgs,
  parseYarnAuditJsonLines,
  renderAuditReport,
  summarizeAudit,
} from "../../scripts/dependency-audit.mjs";

const completedAuditJsonl = [
  JSON.stringify({
    type: "auditAdvisory",
    data: {
      resolution: {
        id: 1109470,
        path: "drizzle-orm",
        dev: false,
        optional: false,
        bundled: false,
      },
      advisory: {
        id: 1109470,
        module_name: "drizzle-orm",
        title: "Drizzle ORM SQL injection advisory",
        severity: "high",
        github_advisory_id: "GHSA-gpj5-g38j-94v9",
        url: "https://github.com/advisories/GHSA-gpj5-g38j-94v9",
        vulnerable_versions: "<0.44.0",
        patched_versions: ">=0.44.0",
        findings: [{ version: "0.39.0", paths: ["drizzle-orm"] }],
      },
    },
  }),
  JSON.stringify({
    type: "auditAdvisory",
    data: {
      resolution: {
        id: 1106509,
        path: "openai>form-data",
        dev: false,
        optional: false,
        bundled: false,
      },
      advisory: {
        id: 1106509,
        module_name: "form-data",
        title: "form-data uses unsafe random boundary generation",
        severity: "critical",
        github_advisory_id: "GHSA-hmw2-7cc7-3qxx",
        url: "https://github.com/advisories/GHSA-hmw2-7cc7-3qxx",
        vulnerable_versions: "<4.0.4",
        patched_versions: ">=4.0.4",
        findings: [{ version: "4.0.3", paths: ["openai>form-data"] }],
      },
    },
  }),
  JSON.stringify({
    type: "auditSummary",
    data: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 1,
        critical: 1,
      },
      dependencies: 10,
      devDependencies: 5,
      optionalDependencies: 0,
      totalDependencies: 15,
    },
  }),
].join("\n");

describe("dependency audit parser", () => {
  test("builds Yarn Classic runtime and all-group audit argv without shell strings", () => {
    assert.deepEqual(buildYarnAuditArgs([]), ["audit", "--groups", "dependencies", "--json"]);
    assert.deepEqual(buildYarnAuditArgs(["--all"]), ["audit", "--json"]);
    assert.throws(() => buildYarnAuditArgs(["--production"]), /Unsupported deps:audit flag: --production/);
  });

  test("maps Yarn audit advisories into actionable runtime evidence", () => {
    const parsed = parseYarnAuditJsonLines(completedAuditJsonl);
    const summary = summarizeAudit(parsed, { exitStatus: 8, args: buildYarnAuditArgs([]) });

    assert.equal(summary.status, "completed");
    assert.equal(summary.scope, "runtime dependencies");
    assert.equal(summary.advisories.length, 2);
    assert.equal(summary.exitStatus, 8);

    assert.deepEqual(summary.advisories[0], {
      packageName: "drizzle-orm",
      severity: "high",
      advisoryId: "GHSA-gpj5-g38j-94v9",
      title: "Drizzle ORM SQL injection advisory",
      url: "https://github.com/advisories/GHSA-gpj5-g38j-94v9",
      dependencyPath: "drizzle-orm",
      dependencyType: "direct",
      scope: "runtime",
      currentVersion: "0.39.0",
      vulnerableRange: "<0.44.0",
      patchedRange: ">=0.44.0",
    });
    assert.equal(summary.advisories[1].packageName, "form-data");
    assert.equal(summary.advisories[1].dependencyPath, "openai > form-data");
    assert.equal(summary.advisories[1].dependencyType, "transitive");
    assert.equal(summary.advisories[1].advisoryId, "GHSA-hmw2-7cc7-3qxx");
    assert.equal(summary.advisories[1].currentVersion, "4.0.3");
  });

  test("renders a summary, advisory table, and raw JSONL evidence instruction", () => {
    const parsed = parseYarnAuditJsonLines(completedAuditJsonl);
    const summary = summarizeAudit(parsed, { exitStatus: 8, args: buildYarnAuditArgs([]) });
    const report = renderAuditReport(summary);

    assert.match(report, /# Dependency Advisory Audit/);
    assert.match(report, /Scope: runtime dependencies/);
    assert.match(report, /Yarn exited with advisory bitmask status 8; audit output was parsed as evidence\./);
    assert.match(report, /\| Package \| Severity \| Advisory \| Dependency Path \| Scope \| Current \| Vulnerable \| Patched \|/);
    assert.match(report, /drizzle-orm/);
    assert.match(report, /GHSA-gpj5-g38j-94v9/);
    assert.match(report, /form-data/);
    assert.match(report, /GHSA-hmw2-7cc7-3qxx/);
    assert.match(report, /Save raw JSONL evidence with `yarn audit --groups dependencies --json > /);
  });

  test("rejects malformed JSON-lines without echoing the raw payload", () => {
    assert.throws(
      () => parseYarnAuditJsonLines(`${completedAuditJsonl}\n{"type": "auditAdvisory", "data": BAD_PAYLOAD}`),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Invalid Yarn audit JSON on line 4/);
        assert.doesNotMatch(error.message, /BAD_PAYLOAD/);
        return true;
      },
    );
  });

  test("missing auditSummary is incomplete and never rendered as clean", () => {
    const advisoryOnly = completedAuditJsonl.split("\n").slice(0, 2).join("\n");
    const summary = summarizeAudit(parseYarnAuditJsonLines(advisoryOnly), {
      exitStatus: 8,
      args: buildYarnAuditArgs([]),
    });
    const report = renderAuditReport(summary);

    assert.equal(summary.status, "incomplete");
    assert.match(report, /Audit incomplete/);
    assert.doesNotMatch(report, /0 advisories|No advisories/i);
  });

  test("Yarn error records are execution failures and never rendered as clean", () => {
    const summary = summarizeAudit(parseYarnAuditJsonLines(JSON.stringify({ type: "error", data: "registry timeout" })), {
      exitStatus: 1,
      args: buildYarnAuditArgs([]),
    });
    const report = renderAuditReport(summary);

    assert.equal(summary.status, "execution_failed");
    assert.match(report, /Audit execution failed/);
    assert.match(report, /registry timeout/);
    assert.doesNotMatch(report, /0 advisories|No advisories/i);
  });

  test("empty stdout with nonzero status is an execution failure and never rendered as clean", () => {
    const summary = summarizeAudit(parseYarnAuditJsonLines(""), {
      exitStatus: 1,
      args: buildYarnAuditArgs([]),
    });
    const report = renderAuditReport(summary);

    assert.equal(summary.status, "execution_failed");
    assert.match(report, /Audit execution failed/);
    assert.match(report, /Yarn exited with status 1 and produced no JSON-lines output/);
    assert.doesNotMatch(report, /0 advisories|No advisories/i);
  });
});
