import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyAuditEvidence,
  renderAuditReport,
} from "../../scripts/dependency-audit.mjs";

function auditSummary(vulnerabilities: Record<string, number>): string {
  return JSON.stringify({
    type: "auditSummary",
    data: { vulnerabilities },
  });
}

const cleanCounts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };

test("Phase 128 advisory controls keep success, bitmask, endpoint, incomplete, error, and malformed states distinct", () => {
  const success = classifyAuditEvidence(auditSummary(cleanCounts), { exitStatus: 0 });
  assert.deepEqual(
    { status: success.status, evidenceState: success.evidenceState, clean: success.clean },
    { status: "completed", evidenceState: "scanner_success", clean: true },
  );

  const bitmask = classifyAuditEvidence(auditSummary({ ...cleanCounts, high: 1 }), { exitStatus: 8 });
  assert.deepEqual(
    { status: bitmask.status, evidenceState: bitmask.evidenceState, clean: bitmask.clean },
    { status: "completed", evidenceState: "advisory_bitmask", clean: false },
  );
  assert.equal(bitmask.totalVulnerabilities, 1);

  const endpointGone = classifyAuditEvidence("", { exitStatus: 1, endpointStatus: 410 });
  assert.deepEqual(
    { status: endpointGone.status, evidenceState: endpointGone.evidenceState, clean: endpointGone.clean },
    { status: "execution_failed", evidenceState: "endpoint_failure", clean: false },
  );
  assert.deepEqual(endpointGone.messages, ["Advisory endpoint returned HTTP 410"]);

  const incomplete = classifyAuditEvidence("", { exitStatus: 0 });
  assert.deepEqual(
    { status: incomplete.status, evidenceState: incomplete.evidenceState, clean: incomplete.clean },
    { status: "incomplete", evidenceState: "incomplete", clean: false },
  );

  const errorRecord = classifyAuditEvidence(JSON.stringify({ type: "error", data: "registry unavailable" }), { exitStatus: 1 });
  assert.deepEqual(
    { status: errorRecord.status, evidenceState: errorRecord.evidenceState, clean: errorRecord.clean },
    { status: "execution_failed", evidenceState: "error_record", clean: false },
  );

  const malformed = classifyAuditEvidence('{"type":"auditSummary","data":BROKEN}', { exitStatus: 0 });
  assert.deepEqual(
    { status: malformed.status, evidenceState: malformed.evidenceState, clean: malformed.clean },
    { status: "malformed", evidenceState: "malformed", clean: false },
  );
  assert.deepEqual(malformed.messages, ["Yarn audit output was malformed JSONL"]);
  assert.doesNotMatch(JSON.stringify(malformed), /BROKEN|registry unavailable/);
});

test("Phase 128 advisory report never renders unavailable evidence as clean", () => {
  for (const summary of [
    classifyAuditEvidence("", { exitStatus: 1, endpointStatus: 410 }),
    classifyAuditEvidence("", { exitStatus: 0 }),
    classifyAuditEvidence("{broken", { exitStatus: 0 }),
  ]) {
    const report = renderAuditReport(summary);
    assert.match(report, /Clean: no/);
    assert.doesNotMatch(report, /No advisories were reported/);
  }
});

test("Phase 128 advisory error records are fixed-category metadata and never raw text", () => {
  const sentinel = "phase128-advisory-raw-error-sentinel";
  const inputs = [
    sentinel,
    { summary: sentinel },
    { detail: sentinel },
    { message: sentinel },
    { nested: { payload: sentinel } },
  ];

  for (const data of inputs) {
    const summary = classifyAuditEvidence(
      JSON.stringify({ type: "error", data }),
      { exitStatus: 1 },
    );
    assert.deepEqual(
      { status: summary.status, evidenceState: summary.evidenceState, clean: summary.clean },
      { status: "execution_failed", evidenceState: "error_record", clean: false },
    );
    assert.deepEqual(summary.messages, ["Yarn audit emitted an error record"]);
    assert.doesNotMatch(JSON.stringify(summary), new RegExp(sentinel));
    assert.doesNotMatch(renderAuditReport(summary), new RegExp(sentinel));
  }
});
