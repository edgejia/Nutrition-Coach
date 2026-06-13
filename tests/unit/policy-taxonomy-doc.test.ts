import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KNOWN_TOOL_POLICY_CLASSES,
  toolRegistry,
} from "../../server/orchestrator/tools.js";

const ADR_PATH = "docs/adr/0006-agent-side-effect-policy-taxonomy.md";
const START_MARKER = "<!-- policy-taxonomy-table:start -->";
const END_MARKER = "<!-- policy-taxonomy-table:end -->";

function readAdr(): string {
  return readFileSync(ADR_PATH, "utf8");
}

function assertContainsAll(content: string, tokens: readonly string[]): void {
  for (const token of tokens) {
    assert.ok(content.includes(token), `ADR must contain ${token}`);
  }
}

function assertGeneratedMarkers(content: string): void {
  const start = content.indexOf(START_MARKER);
  const end = content.indexOf(END_MARKER);
  assert.notEqual(start, -1, "ADR must include generated table start marker");
  assert.notEqual(end, -1, "ADR must include generated table end marker");
  assert.ok(end > start, "generated table end marker must follow start marker");
}

function tableRowFor(content: string, toolName: string): string {
  assertGeneratedMarkers(content);
  const table = content.slice(content.indexOf(START_MARKER), content.indexOf(END_MARKER));
  const row = table
    .split("\n")
    .find((line) => line.startsWith(`| \`${toolName}\` |`));
  assert.ok(row, `generated table must include ${toolName}`);
  return row;
}

function markdownCells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(" | ")
    .map((cell) => cell.trim());
}

function assertAllRegistryRows(content: string): void {
  for (const [toolName, expectedClass] of Object.entries(KNOWN_TOOL_POLICY_CLASSES)) {
    const contract = toolRegistry.get(toolName);
    assert.ok(contract, `toolRegistry must include ${toolName}`);
    const cells = markdownCells(tableRowFor(content, toolName));
    assert.equal(cells[0], `\`${toolName}\``);
    assert.equal(cells[1], `\`${expectedClass}\``);
    for (const rule of contract.policyRules ?? []) {
      assert.ok(
        cells[2].includes(rule.id) || cells[3].includes(rule.id),
        `${toolName} generated row must include policy rule ${rule.id}`,
      );
    }
  }
}

function assertUpdateGoalsRuleEscalation(content: string): void {
  const cells = markdownCells(tableRowFor(content, "update_goals"));
  assert.equal(cells[1], "`direct-execute`", "update_goals base class must remain direct-execute");
  assert.notEqual(cells[1], "`confirm-first`", "update_goals must not be documented as base confirm-first");
  assert.ok(
    cells[2].includes("update_goals_latest_proposal_confirm_first"),
    "update_goals named rule escalation must be documented separately from base class",
  );
}

describe("Phase 86-03: policy taxonomy ADR", () => {
  it("policy taxonomy ADR contains required NC-LLM-004 sections", () => {
    const adr = readAdr();
    assertContainsAll(adr, [
      "# ADR 0006: Agent Side-Effect Policy Taxonomy",
      "### Guardrail Layering",
      "### Output And Receipt Authority Taxonomy",
      "### Per-Tool Reversal Paths",
      "### Classification Rationale",
      "### Session-Expiry Semantics",
      "### Generated Per-Tool Table",
      "## Verification",
      "yarn verify:harness -- policy-side-effect-gate",
      "tests/harness/artifacts/policy-side-effect-gate/latest/",
      "yarn policy-taxonomy:check",
      "Pending goal, meal numeric, and meal delete proposals are scoped by device, session, kind, proposal id",
      "expired or missing pending state is treated as no pending proposal and users must restate or repropose",
    ]);

    const withoutGuardrailSection = adr.replace("### Guardrail Layering", "");
    assert.throws(
      () => assertContainsAll(withoutGuardrailSection, ["### Guardrail Layering"]),
      /Guardrail Layering/,
    );
  });

  it("policy taxonomy generated table stays in sync with toolRegistry", () => {
    const adr = readAdr();
    assertGeneratedMarkers(adr);
    assertAllRegistryRows(adr);

    const withoutMarkers = adr.replace(START_MARKER, "").replace(END_MARKER, "");
    assert.throws(() => assertGeneratedMarkers(withoutMarkers), /start marker/);

    const withoutLogFoodRow = adr.replace(tableRowFor(adr, "log_food"), "");
    assert.throws(() => assertAllRegistryRows(withoutLogFoodRow), /log_food/);
  });

  it("policy taxonomy distinguishes base class from named rule escalation", () => {
    const adr = readAdr();
    assertUpdateGoalsRuleEscalation(adr);

    const mislabeled = adr.replace(
      "| `update_goals` | `direct-execute` |",
      "| `update_goals` | `confirm-first` |",
    );
    assert.throws(() => assertUpdateGoalsRuleEscalation(mislabeled), /direct-execute/);

    const missingNamedRule = adr.replace("update_goals_latest_proposal_confirm_first", "");
    assert.throws(() => assertUpdateGoalsRuleEscalation(missingNamedRule), /named rule escalation/);
  });
});
