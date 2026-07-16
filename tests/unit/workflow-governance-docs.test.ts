import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

const governancePath = "docs/workflow/runtime-governance.md";
const pilotPath = "docs/workflow/gsd-reenable-pilot.md";
const parityPath = "docs/workflow/runtime-parity.json";
const readinessPath = "docs/workflow/gsd-reenable-readiness.md";
const packagePath = "package.json";
const closeoutSkillPath = ".codex/skills/nutrition-milestone-closeout/SKILL.md";

describe("workflow runtime governance docs", () => {
  it("keeps lease, provenance, and telemetry behind the active pause boundary", async () => {
    const governance = await readFile(governancePath, "utf8");
    for (const claim of [
      "not authority to run GSD",
      "Do not point them at this checkout's `.planning/**`",
      "private bearer token and Ed25519 private key must be in a canonical physical absolute path outside both the checkout and Git common directory",
      "single-link `0600` regular file",
      "governance directory itself must remain current-user-owned mode `0700`",
      "`.planning/config.json` is never a writer-identity source",
      "requires both signatures",
      "approved source SHA to equal the real checkout `HEAD`",
      "registered process group",
      "status: needs_reconciliation",
      "caller-generated `--run-id`",
      "independently expected run ID, outcome, before/after workspace digests",
      "A signed `running` record is crash evidence, never final success",
      "never contain child argv, prompts, transcripts, output, artifact paths, repository paths, environment values, or secrets",
      "default to explicit `unavailable/null`",
      "None of these controls authorizes GSD resume",
    ]) {
      assert.ok(governance.includes(claim), `missing governance boundary: ${claim}`);
    }
    assert.match(governance, /TAKEOVER:<lease-id>:<lease-digest>:<reason-code>/);
    assert.match(governance, /runtime_handoff.*only while the predecessor lease is live/s);
    assert.match(
      governance,
      /Expired `abandoned_session` and `operator_recovery` takeover is currently blocked.*lease_operator_takeover_durable_authority_unavailable/s,
    );
    assert.match(governance, /RECOVER_MUTEX:<operation-id>:<operation-digest>:<reason-code>/);
    assert.match(governance, /RECOVER_WRITER:<fence-id>:<fence-digest>:<reason-code>/);
    assert.match(governance, /routingEvidenceEligible: false/);
  });

  it("keeps the pilot unapproved, disposable, synthetic, and decision-only", async () => {
    const pilot = await readFile(pilotPath, "utf8");
    for (const claim of [
      "prepared contract, currently blocked, not approved, not executed",
      "Pilot success does not lift the Temporary GSD Maintenance Pause",
      "does not resume v3.4.1 or Phase 115",
      "remotes | removed before any workflow command",
      "synthetic `.planning` milestone/phase only; never copied from Phase 115",
      "no `.env`, SQLite database, ignored runtime durable-asset store, uploads/staging data, production manifest, Tunnel credentials, or user content",
      "only the exact evidence target below",
      "--summary-only=true",
      "there is no `lease.json`, `operation.lock`, or `writer.lock`",
      "No step may route, plan, execute, verify, ship, close out, repair, or otherwise mutate the real project's `.planning`",
      "Three representative real phase samples",
      "yarn workflow:tree-fingerprint",
      "yarn workflow:pilot-seed",
      "separate sibling disposable fixture copy",
      "still-valid predecessor token supplied as `--predecessor-token-file`",
      "Expired operator recovery is blocked pending an independently durable trust anchor",
    ]) {
      assert.ok(pilot.includes(claim), `missing pilot boundary: ${claim}`);
    }
    for (const forbiddenAuthority of ["GitHub", "production storage", "runtime refresh", "Cloudflare Tunnel", "merge", "tag", "push"]) {
      assert.ok(pilot.includes(forbiddenAuthority), `missing forbidden authority: ${forbiddenAuthority}`);
    }
  });

  it("reports telemetry fixtures without upgrading representative phase evidence", async () => {
    const parity = JSON.parse(await readFile(parityPath, "utf8"));
    const telemetry = parity.rows.find((row: { id: string }) => row.id === "workflow_telemetry_sample");
    assert.equal(telemetry.status, "blocking");
    assert.equal(
      telemetry.proof,
      "limited_original_process_group_privacy_source_freshness_and_escape_counterexample_fixtures",
    );
    assert.match(telemetry.residualRisk, /detached or setsid descendant/);
    assert.match(telemetry.residualRisk, /three real representative phases/i);
  });

  it("keeps telemetry on the one-JSON direct Node entrypoint", async () => {
    const governance = await readFile(governancePath, "utf8");
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    assert.match(governance, /The direct Node entrypoint is intentional/);
    assert.match(governance, /node scripts\/workflow\/workflow-telemetry\.mjs/);
    assert.equal(pkg.scripts["workflow:telemetry"], undefined);
  });

  it("keeps the tracked re-enable report evidence-bound and non-authorizing", async () => {
    const readiness = await readFile(readinessPath, "utf8");
    for (const claim of [
      "Decision status: **DECISION_REQUIRED — pause remains active**",
      "Temporary GSD Maintenance Pause: **ACTIVE**",
      "does not lift the pause",
      "060734d393db36d2241d42d46ad340b8c8a8cb33",
      "a84370bf0c207b2d3305156ce5baf13c0335f02e",
      "ruleset history | version ID `43165861`",
      "GitHub Actions integration ID `15368`",
      "47/47",
      "123/123",
      "17/17",
      "28/28",
      "14/14",
      "15/15",
      "344 tests, 344 pass, 0 fail",
      "`status: pass`, `readiness: not_ready`",
      "APPROVE RULESET CANARY BUNDLE 20260716-060734d3",
      "temporary mirror ruleset ID `19028500`",
      "source marker commit: `cc6755bdbf69f34157d3f6bf66af10c58be29402`",
      "PR #114",
      "Actions run `29473605875`",
      "job/check-run `87541721750`",
      "mergeStateStatus: BLOCKED",
      "rejected with GH013",
      "rejected with HTTP 422",
      "mergedAt: null",
      "same repository that a pull request can edit",
      "Explicitly choose **resume** or **continue-defer**",
      "No temporary remote resource exists",
    ]) {
      assert.ok(readiness.includes(claim), `missing readiness boundary: ${claim}`);
    }
    for (const finding of [
      "roadmap_progress_mismatch",
      "roadmap_summary_completion_mismatch",
      "state_completed_plan_count_mismatch",
      "state_internal_plan_count_mismatch",
      "state_session_continuity_stopped_at_mismatch",
    ]) {
      assert.ok(readiness.includes(finding), `missing live frozen finding: ${finding}`);
    }
    assert.doesNotMatch(readiness, /Temporary GSD Maintenance Pause:\s*\*\*(?:INACTIVE|LIFTED|RESUMED)\*\*/i);
  });

  it("keeps closeout source exceptions exact and binds state checks to project root", async () => {
    const skill = await readFile(closeoutSkillPath, "utf8");
    assert.match(skill, /yarn workflow:state-check --project-root=\./);
    assert.doesNotMatch(skill, /workflow:state-check --planning-root/);
    assert.match(skill, /\.codex\/skills\/nutrition-planning-proof\/SKILL\.md/);
    assert.match(skill, /\.claude\/CLAUDE\.md/);
    assert.match(skill, /git check-ignore -v -- <path>/);
    assert.match(skill, /git ls-files --cached -- <path>/);
    assert.match(skill, /a directory-wide force-add is forbidden/);
  });
});
