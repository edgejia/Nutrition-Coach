import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { KNOWN_TOOL_POLICY_CLASSES, toolRegistry } from "../../server/orchestrator/tools.js";

const ADR_PATH = "docs/adr/0006-agent-side-effect-policy-taxonomy.md";
const START = "<!-- policy-taxonomy-table:start -->";
const END = "<!-- policy-taxonomy-table:end -->";

function assertTaxonomy(content: string): void {
  const start = content.indexOf(START);
  const end = content.indexOf(END);
  assert.ok(start >= 0 && end > start, "taxonomy markers must be ordered");
  const table = content.slice(start, end);
  for (const [tool, policyClass] of Object.entries(KNOWN_TOOL_POLICY_CLASSES)) {
    const row = table.split("\n").find((line) => line.startsWith(`| \`${tool}\` |`));
    assert.ok(row, `taxonomy row missing for ${tool}`);
    assert.ok(row.includes(`| \`${policyClass}\` |`), `taxonomy class drift for ${tool}`);
    for (const rule of toolRegistry.get(tool)?.policyRules ?? []) {
      assert.ok(row.includes(rule.id), `taxonomy rule drift for ${tool}:${rule.id}`);
    }
  }
  assert.match(content, /### Guardrail Layering/);
  assert.match(content, /### Per-Tool Reversal Paths/);
}

test("Phase 128 policy taxonomy negative controls reject description-only and generated-row drift", () => {
  const source = readFileSync(ADR_PATH, "utf8");
  assertTaxonomy(source);

  const missingRow = source.replace(/\| `log_food` \|[^\n]+\n/, "");
  assert.throws(() => assertTaxonomy(missingRow), /taxonomy row missing/);

  const alteredRow = source.replace("| `update_goals` | `direct-execute` |", "| `update_goals` | `confirm-first` |");
  assert.throws(() => assertTaxonomy(alteredRow), /taxonomy class drift/);

  const descriptionOnly = source.replace(/update_goals_latest_proposal_confirm_first/g, "description_only_claim");
  assert.throws(() => assertTaxonomy(descriptionOnly), /taxonomy rule drift/);

  assert.throws(() => assertTaxonomy(source.replace(START, "")), /markers/);
  assert.throws(() => assertTaxonomy(source.replace(END, "")), /markers/);
});

test("Phase 128 policy taxonomy gate is canonical and check-only", () => {
  const releaseCheck = readFileSync("scripts/release-check.mjs", "utf8");
  assert.match(releaseCheck, /runStep\("Policy taxonomy coverage", "policy_taxonomy", \["policy-taxonomy:check"\]\)/);
  assert.match(releaseCheck, /policy_taxonomy_failed/);
  assert.doesNotMatch(releaseCheck, /policy-taxonomy:gen(?!:check)/);
});
