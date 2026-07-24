import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const observationPath = "docs/workflow/gsd-config-observation.md";
const configPath = ".planning/config.json";
const cycleIds = ["cycle-1", "cycle-2", "cycle-3"];
const evidenceFields = [
  "status",
  "observedAt",
  "commandFamily",
  "touchedSurface",
  "loadedOverlay",
  "targetedVerification",
  "negativeControl",
  "authorityBoundary",
  "result",
  "observer",
];

const readObservation = () => readFile(observationPath, "utf8");

const cycleBlock = (source: string, cycleId: string): string => {
  const heading = `### ${cycleId}`;
  const start = source.indexOf(`${heading}\n`);
  assert.notEqual(start, -1, `missing ${cycleId} block`);
  const bodyStart = start + heading.length + 1;
  const remainder = source.slice(bodyStart);
  const nextHeading = remainder.search(/^### |^## /m);
  return remainder.slice(0, nextHeading === -1 ? remainder.length : nextHeading);
};

const fieldValue = (block: string, field: string): string => {
  const match = block.match(new RegExp(`^- ${field}: (.*)$`, "m"));
  assert.ok(match, `missing ${field} field`);
  return match[1];
};

describe("Phase 129 WFR-06 observation record", () => {
  it("records the real current config and overlay baseline without reproducing or mutating config", async () => {
    const [observation, config] = await Promise.all([
      readObservation(),
      readFile(configPath),
    ]);
    const configSha256 = createHash("sha256").update(config).digest("hex");

    assert.match(observation, /^## Observed baseline$/m);
    assert.match(observation, /^- observationDate: `2026-07-25`$/m);
    assert.match(observation, new RegExp("^- configSha256: `" + configSha256 + "`$", "m"));
    assert.match(observation, /^- configPath: `\.planning\/config\.json`$/m);
    assert.match(observation, /^- configStatus: unchanged baseline; this record does not reproduce the config file\.$/m);
    assert.match(observation, /^- installedGsd: unchanged native lifecycle\/state\/artifact owner\.$/m);
    assert.match(observation, /^- modelProfile: `balanced`; workflowMode: `interactive`; autoAdvance: `false`\.$/m);
    assert.match(observation, /gsd-executor=.*nutrition-new-harness-scenario/);
    assert.match(observation, /gsd-verifier=.*nutrition-verify-change/);
    assert.doesNotMatch(observation, /"agent_skills"\s*:/);
    assert.doesNotMatch(observation, /"workflow"\s*:/);
  });

  it("contains exactly three blank future cycle slots that remain human_needed", async () => {
    const observation = await readObservation();
    const headings = [...observation.matchAll(/^### (cycle-[1-3])$/gm)].map((match) => match[1]);
    assert.deepEqual(headings, cycleIds);

    for (const cycleId of cycleIds) {
      const block = cycleBlock(observation, cycleId);
      for (const field of evidenceFields) {
        assert.match(block, new RegExp(`^- ${field}: `, "m"));
      }
      assert.equal(fieldValue(block, "status"), "`human_needed`");
      for (const field of evidenceFields.filter((name) => name !== "status")) {
        assert.equal(fieldValue(block, field), '""', `${cycleId} ${field} must remain blank`);
      }
      assert.doesNotMatch(block, /20\\d\\d-\\d\\d-\\d\\d/);
    }
  });

  it("keeps observation separate from config tuning, new workflow machinery, and operator authority", async () => {
    const observation = await readObservation();

    assert.match(observation, /Do not modify `\.planning\/config\.json` or installed GSD source\./);
    assert.match(observation, /No GSD configuration tuning is proposed or authorized by this record\./);
    assert.match(observation, /does not create a new orchestrator, checker, receipt, gate, or parallel workflow/i);
    assert.match(observation, /does not authorize push, merge, tag, release, runtime, Tunnel, or public smoke/i);
    assert.match(observation, /Plans 129-01 through 129-07 are implementation evidence, not observed ordinary cycles/i);
  });

  it("keeps the record metadata-only and rejects private or high-assurance evidence claims", async () => {
    const observation = await readObservation();

    assert.match(observation, /metadata-only/i);
    assert.match(observation, /credentials, cookies, tokens, raw prompts, provider\/tool payloads, image bytes, database dumps, or private host paths/i);
    assert.match(observation, /no provenance claim and carries no receipt, seal, or attestation/i);
    assert.doesNotMatch(observation, /(?:api[_ -]?key|secret|password)\s*[:=]\s*\S+/i);
    assert.doesNotMatch(observation, /(?:cookie|authorization)\s*[:=]\s*\S+/i);
    assert.doesNotMatch(observation, /(?:Bearer\s+|sk-[A-Za-z0-9]{10,})/);
    assert.doesNotMatch(observation, /raw (?:prompt|provider|tool) payload/i);
    assert.doesNotMatch(observation, /data:image\//i);
    assert.doesNotMatch(observation, /(?:BEGIN (?:PRIVATE KEY|SQL)|sqlite3? dump)/i);
    assert.doesNotMatch(observation, /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)/);
    assert.doesNotMatch(observation, /signed\s+(?:receipt|provenance|attestation|seal)\s+(?:is|was|available|verified)/i);
  });
});
