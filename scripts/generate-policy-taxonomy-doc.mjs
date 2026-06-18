#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import {
  KNOWN_TOOL_POLICY_CLASSES,
  toolRegistry,
} from "../server/orchestrator/tools.ts";

const OUTPUT_PATH = "docs/adr/0006-agent-side-effect-policy-taxonomy.md";
const SOURCE_PATH = "server/orchestrator/tools.ts";
const CHECK_FLAG = "--check";
const START_MARKER = "<!-- policy-taxonomy-table:start -->";
const END_MARKER = "<!-- policy-taxonomy-table:end -->";

function escapeCell(value) {
  const text = Array.isArray(value) ? value.join("<br>") : (value ?? "");
  const normalized = String(text).replace(/\r?\n/g, " ").trim();
  return normalized.replace(/\|/g, "\\|");
}

function tableRow(values) {
  return values.map(escapeCell).join(" | ").replace(/^/, "| ").replace(/$/, " |");
}

function policyRuleIdsFor(contract) {
  return (contract.policyRules ?? []).map((rule) => `${rule.id} (${rule.decision})`);
}

function policyRuleRationaleFor(contract) {
  const rules = contract.policyRules ?? [];
  return rules.length > 0
    ? rules.map((rule) => `${rule.id}: ${rule.description}`)
    : ["base_policy_allowed: no named rule escalation"];
}

function renderPolicyTaxonomyTable() {
  const rows = Object.entries(KNOWN_TOOL_POLICY_CLASSES).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const lines = [
    START_MARKER,
    "",
    `Generated from ${SOURCE_PATH}.`,
    "",
    "| Tool | Base class | Named rules / rationale | Notes |",
    "|---|---|---|---|",
  ];

  for (const [toolName, baseClass] of rows) {
    const contract = toolRegistry.get(toolName);
    if (!contract) {
      throw new Error(`Missing registered tool for taxonomy: ${toolName}`);
    }
    lines.push(
      tableRow([
        `\`${toolName}\``,
        `\`${baseClass}\``,
        policyRuleRationaleFor(contract),
        policyRuleIdsFor(contract).length > 0
          ? `Named rules: ${policyRuleIdsFor(contract).join(", ")}`
          : "No named escalation rules.",
      ]),
    );
  }

  lines.push("", END_MARKER);
  return lines.join("\n");
}

function replaceGeneratedTable(currentContent, generatedTable) {
  const start = currentContent.indexOf(START_MARKER);
  const end = currentContent.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${OUTPUT_PATH} must contain ${START_MARKER} and ${END_MARKER}`);
  }
  const before = currentContent.slice(0, start);
  const after = currentContent.slice(end + END_MARKER.length);
  return `${before}${generatedTable}${after}`;
}

function renderMarkdown(currentContent) {
  return replaceGeneratedTable(currentContent, renderPolicyTaxonomyTable());
}

async function checkGeneratedDoc() {
  const currentContent = await readFile(OUTPUT_PATH, "utf8").catch(() => null);
  if (currentContent === null) {
    console.error(`${OUTPUT_PATH} is missing; run yarn policy-taxonomy:gen`);
    process.exit(1);
  }

  const nextContent = renderMarkdown(currentContent);
  if (currentContent !== nextContent) {
    console.error(`${OUTPUT_PATH} is out of sync with ${SOURCE_PATH}; run yarn policy-taxonomy:gen`);
    process.exit(1);
  }
}

if (process.argv.includes(CHECK_FLAG)) {
  await checkGeneratedDoc();
  process.exit(0);
}

const currentContent = await readFile(OUTPUT_PATH, "utf8");
await writeFile(OUTPUT_PATH, renderMarkdown(currentContent), "utf8");
