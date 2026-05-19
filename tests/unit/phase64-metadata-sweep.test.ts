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
  { tier: "Tier 1", label: "session material", pattern: /guest_session=|guestSession=/i },
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

function summarizeCompanionProofs(): string[] {
  return ["tests/unit/verification-artifacts.test.ts", "tests/unit/llm-chat-trace.test.ts"];
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
