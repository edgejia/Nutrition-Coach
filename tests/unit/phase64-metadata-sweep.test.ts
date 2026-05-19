import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ARTIFACTS_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "phase64-artifacts-"));

interface ArtifactFile {
  path: string;
  absolutePath: string;
  extension: string;
  byteSize: number;
  kind: "text" | "binary";
}

interface DenylistEntry {
  tier: "Tier 1" | "Tier 2";
  label: string;
  pattern: RegExp;
}

interface SweepResult {
  files: ArtifactFile[];
  textFileCount: number;
  binaryFileCount: number;
  matchCount: number;
  matches: Array<{ path: string; tier: DenylistEntry["tier"]; label: string }>;
}

const denylistRegistry: DenylistEntry[] = [
  { tier: "Tier 1", label: "raw prompts", pattern: /raw prompt text should not persist|promptText/i },
  { tier: "Tier 1", label: "user text", pattern: /raw user meal text should not persist|rawUserMessage|userMealText/i },
  {
    tier: "Tier 1",
    label: "assistant final text",
    pattern: /assistant final answer should not persist|finalAssistantContent|assistantContent/i,
  },
  {
    tier: "Tier 1",
    label: "tool payloads",
    pattern: /raw tool (?:args|arguments|result|results) should not persist|rawToolResult|toolArguments/i,
  },
  { tier: "Tier 1", label: "provider bodies", pattern: /raw provider body should not persist|rawProviderPayload/i },
  { tier: "Tier 1", label: "image data", pattern: /data:image\/[a-z0-9.+-]+;base64/i },
  {
    tier: "Tier 1",
    label: "session material",
    pattern: /(?:guest_session|guest_session_resume|guestSession|guestSessionResume|sessionToken|resumeToken|token)=([^\[]|$)/i,
  },
  { tier: "Tier 1", label: "database snapshots", pattern: /"historySnapshot"\s*:|"mealsSnapshot"\s*:/i },
  { tier: "Tier 2", label: "API keys", pattern: /\bsk-[A-Za-z0-9_-]+/ },
  { tier: "Tier 2", label: "bearer/auth headers", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/i },
  { tier: "Tier 2", label: "cookies", pattern: /set-cookie|cookie:\s*|guestSession=/i },
  { tier: "Tier 2", label: "device/session identifiers", pattern: /secret-device-id|session-token/i },
  { tier: "Tier 2", label: "upload paths", pattern: /\/uploads\/|\/upload-staging\//i },
  { tier: "Tier 2", label: "error stacks", pattern: /\b(?:AssertionError|Error): .+\n\s+at\s+/ },
  { tier: "Tier 2", label: "internal schema", pattern: /CREATE TABLE|sqlite_schema/i },
  { tier: "Tier 2", label: "raw tool args/results", pattern: /raw tool (?:args|arguments|result|results)/i },
  { tier: "Tier 2", label: "raw messages", pattern: /raw messages|rawMessages/i },
  { tier: "Tier 2", label: "provider request/body/header material", pattern: /raw provider|provider headers/i },
];

const BINARY_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
  ".woff",
  ".woff2",
]);

function enumerateArtifactFiles(root: string): ArtifactFile[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const files: ArtifactFile[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
      const extension = path.extname(entry.name).toLowerCase() || "(none)";
      const byteSize = fs.statSync(absolutePath).size;
      files.push({
        path: relativePath,
        absolutePath,
        extension,
        byteSize,
        kind: isBinaryArtifact(absolutePath, extension) ? "binary" : "text",
      });
    }
  };

  visit(root);
  return files;
}

function isBinaryArtifact(absolutePath: string, extension: string): boolean {
  if (BINARY_EXTENSIONS.has(extension)) {
    return true;
  }

  const sample = fs.readFileSync(absolutePath).subarray(0, 512);
  return sample.includes(0);
}

function sweepArtifacts(root: string, denylist: DenylistEntry[]): SweepResult {
  const files = enumerateArtifactFiles(root);
  const matches: SweepResult["matches"] = [];

  for (const file of files) {
    if (file.kind === "binary") {
      continue;
    }

    const text = fs.readFileSync(file.absolutePath, "utf-8");
    for (const entry of denylist) {
      if (entry.pattern.test(text)) {
        matches.push({ path: file.path, tier: entry.tier, label: entry.label });
      }
    }
  }

  const textFileCount = files.filter((file) => file.kind === "text").length;
  const binaryFileCount = files.filter((file) => file.kind === "binary").length;
  return {
    files,
    textFileCount,
    binaryFileCount,
    matchCount: matches.length,
    matches,
  };
}

const companionProofs = [
  {
    path: "tests/unit/verification-artifacts.test.ts",
    required: [
      /summary\.json redacts untrusted console/,
      /raw prompt and message keys are omitted/,
      /persisted artifacts redact TRACE-04 forbidden probe strings/,
    ],
  },
  {
    path: "tests/unit/llm-chat-trace.test.ts",
    required: [
      /excludes malicious or accidental raw payload values/,
      /records provider-caused fallback hook facts with metadata-only trace fields/,
      /structured hooks log exact metadata-only LLM error and fallback payloads/,
    ],
  },
];

function readPhase64Context(): string {
  return fs.readFileSync(
    path.resolve(".planning/phases/64-verification-and-release-proof-hardening/64-CONTEXT.md"),
    "utf-8",
  );
}

describe("Phase 64 PROOF-02 metadata-only sweep", () => {
  before(() => {
    const latest = path.join(ARTIFACTS_ROOT, "fixture-scenario", "latest");
    fs.mkdirSync(latest, { recursive: true });
    fs.writeFileSync(
      path.join(latest, "summary.json"),
      JSON.stringify({ ok: true, consoleSummary: "PASS fixture-scenario 2/2" }),
    );
    fs.writeFileSync(
      path.join(latest, "steps.json"),
      JSON.stringify([{ name: "setup", ok: true, evidence: { deviceId: "[REDACTED]" } }]),
    );
    fs.writeFileSync(
      path.join(latest, "snapshots.json"),
      JSON.stringify({ requestUrl: "http://127.0.0.1/api/sse?guest_session_resume=[REDACTED]" }),
    );
    fs.writeFileSync(
      path.join(latest, "scenario-result.json"),
      JSON.stringify({ ok: true, artifacts: { binaryProof: "metadata-only" } }),
    );
    fs.writeFileSync(path.join(latest, "thumbnail.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
  });

  after(() => {
    fs.rmSync(ARTIFACTS_ROOT, { recursive: true, force: true });
  });

  test("D-36 enumerates every file under the representative artifact fixture", () => {
    const files = enumerateArtifactFiles(ARTIFACTS_ROOT);

    assert.ok(files.length > 0, "expected metadata enumeration count > 0 for representative artifacts");
    assert.ok(files.every((file) => file.absolutePath.startsWith(ARTIFACTS_ROOT)));
  });

  test("D-22/D-23 text sweep reports Tier 1 and Tier 2 metadata without raw matched snippets", () => {
    const result = sweepArtifacts(ARTIFACTS_ROOT, denylistRegistry);
    const textArtifactNames = new Set(
      result.files
        .filter((file) => file.kind === "text")
        .map((file) => path.basename(file.path)),
    );

    const message = [
      `files=${result.files.length}`,
      `textFiles=${result.textFileCount}`,
      `binaryFiles=${result.binaryFileCount}`,
      `matches=${result.matchCount}`,
      `tiers=${result.matches.map((match) => match.tier).join(",")}`,
      `paths=${result.matches.map((match) => match.path).join(",")}`,
    ].join(" ");

    assert.ok(result.files.length > 0, "expected artifact files to sweep");
    assert.ok(result.textFileCount > 0, "expected text JSON/markdown artifacts to sweep");
    for (const expected of ["summary.json", "steps.json", "snapshots.json", "scenario-result.json"]) {
      assert.ok(textArtifactNames.has(expected), `expected at least one ${expected} artifact to be swept`);
    }
    assert.equal(result.matchCount, 0, message);
    assert.doesNotMatch(message, /raw prompt|raw user|final assistant|raw tool|raw provider body|data:image|guest_session|sk-/i);
  });

  test("D-36b classifies binary artifacts separately by path, extension type, and byte size", () => {
    const files = enumerateArtifactFiles(ARTIFACTS_ROOT);
    const binaries = files.filter((file) => file.kind === "binary");

    assert.ok(binaries.length > 0, "expected binary artifact metadata count > 0");
    assert.ok(
      binaries.every(
        (file) =>
          file.absolutePath.startsWith(ARTIFACTS_ROOT) &&
          file.extension.length > 0 &&
          file.byteSize > 0,
      ),
      "binary artifacts must include path, extension/type, and byte size metadata",
    );
  });

  test("D-18/D-45 companion proof keeps structured trace, logs, and artifact redaction tests in scope", () => {
    for (const proof of companionProofs) {
      const source = fs.readFileSync(path.resolve(proof.path), "utf-8");
      for (const marker of proof.required) {
        assert.match(source, marker, `${proof.path} must retain ${marker}`);
      }
    }
  });

  test("D-02/D-20/D-21/D-24/D-26/D-27/D-32/D-33/D-34/D-35/D-36a/D-37/D-38/D-39/D-41 policy notes are represented", () => {
    const context = readPhase64Context();
    for (const decisionId of [
      "D-02",
      "D-20",
      "D-21",
      "D-24",
      "D-26",
      "D-27",
      "D-32",
      "D-33",
      "D-34",
      "D-35",
      "D-36a",
      "D-37",
      "D-38",
      "D-39",
      "D-41",
    ]) {
      assert.match(context, new RegExp(`\\*\\*${decisionId}:`), `${decisionId} must be represented in Phase 64 context`);
    }
  });
});
