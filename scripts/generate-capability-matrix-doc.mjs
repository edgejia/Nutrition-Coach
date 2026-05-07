#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { capabilityMatrix } from "../client/src/contracts/capability-matrix.ts";

const OUTPUT_PATH = "docs/capability-matrix.md";
const SOURCE_PATH = "client/src/contracts/capability-matrix.ts";
const FROZEN_CLOSEOUT_PATH = ".planning/phases/44-capability-alignment-audit-and-repair/44-capability-matrix.md";
const CHECK_FLAG = "--check";

function escapeCell(value) {
  const text = Array.isArray(value) ? value.join("<br>") : (value ?? "");
  const normalized = String(text).replace(/\r?\n/g, " ").trim();
  return normalized.replace(/\|/g, "\\|");
}

function renderReferenceList(row, keys) {
  const values = keys.flatMap((key) => row[key]);
  return values.length > 0 ? values : "none";
}

function renderMarkdown() {
  const rows = [...capabilityMatrix].sort((a, b) => {
    const surface = a.surface.localeCompare(b.surface);
    if (surface !== 0) return surface;
    return a.affordance.localeCompare(b.affordance);
  });

  const lines = [
    "# Capability Matrix",
    "",
    `Generated from ${SOURCE_PATH}.`,
    "",
    `Run \`yarn matrix:gen\` to update this file and \`yarn matrix:gen:check\` before commit. Phase closeout may freeze a copy at \`${FROZEN_CLOSEOUT_PATH}\`.`,
    "",
    "| Surface | Affordance | Source | Support State | Client/Store | Backend | Handling | Requirements | Future |",
    "|---|---|---|---|---|---|---|---|---|",
  ];

  for (const row of rows) {
    lines.push(
      [
        row.surface,
        row.affordance,
        row.sourceFile,
        row.supportState,
        renderReferenceList(row, ["clientApi", "storeAction"]),
        renderReferenceList(row, ["backendRoute", "backendService"]),
        row.handlingDecision,
        row.requirements,
        row.futurePhaseRef ?? "none",
      ].map(escapeCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }

  lines.push("");
  return `${lines.join("\n")}`;
}

const nextContent = renderMarkdown();

if (process.argv.includes(CHECK_FLAG)) {
  const currentContent = await readFile(OUTPUT_PATH, "utf8").catch(() => null);
  if (currentContent !== nextContent) {
    console.error(`${OUTPUT_PATH} is out of sync with ${SOURCE_PATH}`);
    process.exit(1);
  }
  process.exit(0);
}

await writeFile(OUTPUT_PATH, nextContent, "utf8");
