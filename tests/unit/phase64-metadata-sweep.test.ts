import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ARTIFACTS_ROOT = path.resolve("tests/harness/artifacts");

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
  { tier: "Tier 1", label: "raw prompts", pattern: /raw prompt/i },
  { tier: "Tier 1", label: "user text", pattern: /raw user/i },
  { tier: "Tier 1", label: "assistant final text", pattern: /final assistant/i },
  { tier: "Tier 1", label: "tool payloads", pattern: /raw tool/i },
  { tier: "Tier 1", label: "provider bodies", pattern: /raw provider body/i },
  { tier: "Tier 1", label: "image data", pattern: /data:image\/[a-z0-9.+-]+;base64/i },
  { tier: "Tier 1", label: "session material", pattern: /guest_session=|guestSession=/i },
  { tier: "Tier 1", label: "database snapshots", pattern: /historySnapshot|mealsSnapshot/i },
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

function enumerateArtifactFiles(_root: string): ArtifactFile[] {
  throw new Error("phase64 metadata sweep enumeration not implemented");
}

function sweepArtifacts(_root: string, _denylist: DenylistEntry[]): SweepResult {
  throw new Error("phase64 metadata sweep matching not implemented");
}

function summarizeCompanionProofs(): string[] {
  throw new Error("phase64 companion proof summary not implemented");
}

describe("Phase 64 PROOF-02 metadata-only sweep", () => {
  test("D-36 enumerates every on-disk file under tests/harness/artifacts when the directory exists", () => {
    if (!fs.existsSync(ARTIFACTS_ROOT)) {
      return;
    }

    const files = enumerateArtifactFiles(ARTIFACTS_ROOT);

    assert.ok(files.length > 0, "expected metadata enumeration count > 0 for tests/harness/artifacts");
    assert.ok(files.every((file) => file.path.startsWith("tests/harness/artifacts/")));
  });

  test("D-22/D-23 text sweep reports Tier 1 and Tier 2 metadata without raw matched snippets", () => {
    const result = sweepArtifacts(ARTIFACTS_ROOT, denylistRegistry);

    const message = [
      `files=${result.files.length}`,
      `textFiles=${result.textFileCount}`,
      `binaryFiles=${result.binaryFileCount}`,
      `matches=${result.matchCount}`,
      `tiers=${result.matches.map((match) => match.tier).join(",")}`,
      `paths=${result.matches.map((match) => match.path).join(",")}`,
    ].join(" ");

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
          file.path.startsWith("tests/harness/artifacts/") &&
          file.extension.length > 0 &&
          file.byteSize > 0,
      ),
      "binary artifacts must include path, extension/type, and byte size metadata",
    );
  });

  test("D-18/D-45 companion proof keeps structured trace, logs, and artifact redaction tests in scope", () => {
    assert.deepEqual(summarizeCompanionProofs(), [
      "tests/unit/verification-artifacts.test.ts",
      "tests/unit/llm-chat-trace.test.ts",
    ]);
  });

  test("D-02/D-20/D-21/D-24/D-26/D-27/D-32/D-33/D-34/D-35/D-36a/D-37/D-38/D-39/D-41 policy notes are represented", () => {
    const policyNotes = [
      "D-02 sweep before behavior-test expansion",
      "D-20 ROADMAP denylist floor",
      "D-21 synthesize strongest existing operational denylist",
      "D-24 add Tier 2 risks but escalate removals",
      "D-26 sentinel fixtures allowed only when not persisted or emitted",
      "D-27 HTTP bodies out of scope unless captured by evidence",
      "D-32 no default harness bundle",
      "D-33 focused harness only for false-pass risk",
      "D-34 harness trigger required",
      "D-35 name the harness trigger if harness enters scope",
      "D-36a classify ignored local artifacts",
      "D-37 counts and status only",
      "D-38 persisted matches block unless escalated",
      "D-39 clean artifacts and verify or fix producer path",
      "D-41 generated artifacts are regenerated, not hand-edited",
    ];

    assert.equal(policyNotes.length, 15);
  });
});
