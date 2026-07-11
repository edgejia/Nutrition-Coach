import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const TOUR_PATH = "docs/tour.md";
const README_PATHS = ["README.md", "README-en.md"] as const;
const EXPECTED_STOP_IDS = Array.from(
  { length: 10 },
  (_, index) => `S${String(index + 1).padStart(2, "0")}`,
);
const EXPECTED_STOP_MINUTES = [3, 6, 1, 1, 2, 2, 1, 10, 2, 2] as const;
const CHECKPOINT_FIELD_LABELS = ["為何讀", "精讀範圍", "讀完應能回答", "下一站"] as const;
const REQUIRED_SOURCE_TARGETS = [
  "../README.md#為什麼做這個專案",
  "architecture.md#總覽",
  "architecture.md#主要元件",
  "architecture.md#meal-logging",
  "architecture.md#llm-boundary",
  "architecture.md#data-model",
  "capability-matrix.md#capability-matrix",
  "adr/0001-metadata-only-llm-failure-localization.md#context",
  "adr/0001-metadata-only-llm-failure-localization.md#decision",
  "adr/0001-metadata-only-llm-failure-localization.md#consequences",
  "adr/0003-structured-boundaries-and-authoritative-state.md#context",
  "adr/0003-structured-boundaries-and-authoritative-state.md#decision",
  "adr/0003-structured-boundaries-and-authoritative-state.md#consequences",
  "adr/0006-agent-side-effect-policy-taxonomy.md#context",
  "adr/0006-agent-side-effect-policy-taxonomy.md#decision",
  "adr/0006-agent-side-effect-policy-taxonomy.md#consequences",
  "adr/0010-nutrition-safety-product-floor.md#context",
  "adr/0010-nutrition-safety-product-floor.md#decision",
  "adr/0010-nutrition-safety-product-floor.md#verification",
  "ai-safety.md#threat-model-trust-and-authority-boundaries",
  "ai-safety.md#deterministic-safety-cases",
  "ai-safety.md#the-1200-kcal-product-safety-floor",
  "ai-safety.md#known-limitations-and-future-eval-questions",
  "../tests/harness/behavior-matrix.md#cases",
  "../tests/harness/behavior-matrix.md#risk-coverage-distribution",
  "../tests/harness/behavior-matrix.md#risk-to-assertion-coverage",
  "../tests/harness/cases/case-11-malicious-tool-json.ts",
  "../tests/harness/cases/case-12-unauthorized-goal-update.ts",
  "../server/orchestrator/tool-contract.ts",
] as const;
const REQUIRED_SOURCE_HEADINGS = new Map<string, string>([
  ["../README.md#為什麼做這個專案", "## 為什麼做這個專案"],
  ["architecture.md#總覽", "## 總覽"],
  ["architecture.md#主要元件", "## 主要元件"],
  ["architecture.md#meal-logging", "### Meal Logging"],
  ["architecture.md#llm-boundary", "## LLM Boundary"],
  ["architecture.md#data-model", "## Data Model"],
  ["capability-matrix.md#capability-matrix", "# Capability Matrix"],
  ["adr/0001-metadata-only-llm-failure-localization.md#context", "## Context"],
  ["adr/0001-metadata-only-llm-failure-localization.md#decision", "## Decision"],
  ["adr/0001-metadata-only-llm-failure-localization.md#consequences", "## Consequences"],
  ["adr/0003-structured-boundaries-and-authoritative-state.md#context", "## Context"],
  ["adr/0003-structured-boundaries-and-authoritative-state.md#decision", "## Decision"],
  ["adr/0003-structured-boundaries-and-authoritative-state.md#consequences", "## Consequences"],
  ["adr/0006-agent-side-effect-policy-taxonomy.md#context", "## Context"],
  ["adr/0006-agent-side-effect-policy-taxonomy.md#decision", "## Decision"],
  ["adr/0006-agent-side-effect-policy-taxonomy.md#consequences", "## Consequences"],
  ["adr/0010-nutrition-safety-product-floor.md#context", "## Context"],
  ["adr/0010-nutrition-safety-product-floor.md#decision", "## Decision"],
  ["adr/0010-nutrition-safety-product-floor.md#verification", "## Verification"],
  [
    "ai-safety.md#threat-model-trust-and-authority-boundaries",
    "## Threat model: trust and authority boundaries",
  ],
  ["ai-safety.md#deterministic-safety-cases", "## Deterministic safety cases"],
  ["ai-safety.md#the-1200-kcal-product-safety-floor", "## The 1200 kcal product safety floor"],
  [
    "ai-safety.md#known-limitations-and-future-eval-questions",
    "## Known limitations and future eval questions",
  ],
  ["../tests/harness/behavior-matrix.md#cases", "## Cases"],
  ["../tests/harness/behavior-matrix.md#risk-coverage-distribution", "## Risk Coverage Distribution"],
  ["../tests/harness/behavior-matrix.md#risk-to-assertion-coverage", "## Risk To Assertion Coverage"],
]);
const QUESTION_CONTRACT = [
  {
    id: "Q01",
    category: "portfolio_architecture",
    question: "這個 repo 除了飲食紀錄之外證明什麼工程能力，餐點紀錄扮演什麼角色？",
    expectedAnchors: [
      "trustworthy LLM application engineering",
      "typed contracts",
      "confirm-first proposals",
      "backend authority",
      "committed receipts",
      "deterministic evidence",
    ],
    directTargets: ["../README.md#為什麼做這個專案"],
  },
  {
    id: "Q02",
    category: "portfolio_architecture",
    question: "瀏覽器到持久化資料經過哪些邊界，哪裡組裝依賴，哪一層保有資料真相？",
    expectedAnchors: [
      "client transport/store -> Fastify routes -> services/orchestrator/tool contracts -> provider -> SQLite",
      "server/app.ts composition",
      "validated backend/committed state authority",
    ],
    directTargets: [
      "architecture.md#總覽",
      "architecture.md#主要元件",
      "architecture.md#meal-logging",
      "architecture.md#llm-boundary",
      "architecture.md#data-model",
    ],
  },
  {
    id: "Q03",
    category: "decisions",
    question: "為什麼 observability 只記 metadata，明確排除哪些內容？",
    expectedAnchors: [
      "turnId and allowlisted failure facts",
      "no raw prompts, inputs/transcripts, tool/provider payloads, images, sessions, DB snapshots, SSE frames, or final reply text",
    ],
    directTargets: [
      "adr/0001-metadata-only-llm-failure-localization.md#context",
      "adr/0001-metadata-only-llm-failure-localization.md#decision",
    ],
  },
  {
    id: "Q04",
    category: "decisions",
    question: "為什麼 model prose、display strings 與 loose transport 不是 authority，什麼取代它們？",
    expectedAnchors: [
      "typed/schema validation",
      "backend/transport authority",
      "atomic persisted receipts/mutation facts",
      "committed state",
    ],
    directTargets: [
      "adr/0003-structured-boundaries-and-authoritative-state.md#context",
      "adr/0003-structured-boundaries-and-authoritative-state.md#decision",
    ],
  },
  {
    id: "Q05",
    category: "decisions",
    question: "Tool call 的 guard 順序是什麼，為何 update_goals 需要 committed authority？",
    expectedAnchors: [
      "JSON parse -> Zod -> source-text guard -> side-effect policy gate -> execute",
      "proposal/commit distinction",
      "committed backend receipt authority",
    ],
    directTargets: [
      "adr/0006-agent-side-effect-policy-taxonomy.md#decision",
      "../server/orchestrator/tool-contract.ts",
    ],
  },
  {
    id: "Q06",
    category: "evidence",
    question: "Capability claims 如何追到 source/client-store/backend/handling 並避免 drift？",
    expectedAnchors: [
      "typed canonical source",
      "support state and wiring columns",
      "generator",
      "yarn matrix:gen:check",
    ],
    directTargets: ["capability-matrix.md#capability-matrix"],
  },
  {
    id: "Q07",
    category: "evidence",
    question: "CASE-11/12 證明什麼，哪些 assertions 顯示文字沒有 authority 或 mutation？",
    expectedAnchors: [
      "CASE-11 fake tool JSON",
      "assertNoTrustedToolAuthority",
      "assertNoUnauthorizedMutation",
      "CASE-12 preserved goals",
    ],
    directTargets: [
      "../tests/harness/behavior-matrix.md#cases",
      "../tests/harness/behavior-matrix.md#risk-to-assertion-coverage",
      "../tests/harness/cases/case-11-malicious-tool-json.ts",
      "../tests/harness/cases/case-12-unauthorized-goal-update.ts",
    ],
  },
  {
    id: "Q08",
    category: "evidence",
    question: "1200 kcal/day 是什麼、不是什麼，四個 enforcement layers 各做什麼？",
    expectedAnchors: [
      "conservative non-clinical product floor",
      "not universal or personalized medical advice",
      "prompt, shared policy, guarded paths, named executable evidence",
    ],
    directTargets: [
      "adr/0010-nutrition-safety-product-floor.md#decision",
      "ai-safety.md#the-1200-kcal-product-safety-floor",
    ],
  },
  {
    id: "Q09",
    category: "limitations",
    question: "#107/#108/#109 留下什麼問題，deterministic guards 不能證明什麼？",
    expectedAnchors: [
      "confusion/duplicate proposal",
      "explanation/action mismatch",
      "apply promise without pending state",
      "preserved integrity",
      "unresolved conversational quality",
    ],
    directTargets: ["ai-safety.md#known-limitations-and-future-eval-questions"],
  },
  {
    id: "Q10",
    category: "supported_future_boundary",
    question: "同瀏覽器 guest session、跨裝置 continuity、export、weekly AI insights 的支援狀態為何？",
    expectedAnchors: [
      "same-browser bootstrap supported",
      "cross-device continuity hidden-future-scope",
      "export inert-honest-placeholder",
      "weekly insights hidden-future-scope",
      "no future-surface support claim",
    ],
    directTargets: ["capability-matrix.md#capability-matrix"],
  },
] as const;
const QUESTION_CATEGORY_COUNTS = {
  portfolio_architecture: 2,
  decisions: 3,
  evidence: 3,
  limitations: 1,
  supported_future_boundary: 1,
} as const;
const README_NARRATIVE_CONTRACT = [
  {
    path: "README.md",
    heading: "為什麼做這個專案",
    nextHeading: "專案重點",
    bulletAnchors: [
      ["文字或照片", "飲食紀錄"],
      ["可信賴的 LLM 應用工程", "typed contracts", "confirm-first proposals", "backend authority", "committed receipts", "deterministic evidence"],
      ["30 分鐘", "docs/tour.md"],
    ],
  },
  {
    path: "README-en.md",
    heading: "Why this repo",
    nextHeading: "Project Highlights",
    bulletAnchors: [
      ["text or photos", "meal logging"],
      ["trustworthy LLM application engineering", "typed contracts", "confirm-first proposals", "backend authority", "committed receipts", "deterministic evidence"],
      ["30-minute", "docs/tour.md"],
    ],
  },
] as const;
const FORBIDDEN_PUBLIC_ROOT_PARTS = [
  ["docs", "research"],
  ["docs", "HANDOFF"],
  [["plan", "ning"].join("")],
] as const;

type MarkdownLink = { text: string; target: string; image: boolean };
type TourStop = { id: string; title: string; minutes: number; body: string; fields: Map<string, string> };

function extractMarkdownLinks(markdown: string): MarkdownLink[] {
  return [...markdown.matchAll(/(!?)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(
    (match) => ({ image: match[1] === "!", text: match[2], target: match[3] }),
  );
}

function extractTourStops(markdown: string): TourStop[] {
  const headings = [...markdown.matchAll(/^### (S\d{2}) · ([^（\n]+)（(\d+) 分鐘）$/gm)];
  return headings.map((heading, index) => {
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const body = markdown.slice(start, end);
    const fields = new Map(
      [...body.matchAll(/^- \*\*(為何讀|精讀範圍|讀完應能回答|下一站)：\*\*\s+(.+)$/gm)].map(
        (match) => [match[1], match[2]],
      ),
    );
    return { id: heading[1], title: heading[2], minutes: Number(heading[3]), body, fields };
  });
}

function extractSection(markdown: string, heading: string, nextHeading?: string) {
  const startMarker = `## ${heading}`;
  const start = markdown.indexOf(startMarker);
  assert.notEqual(start, -1, `missing section ${startMarker}`);
  const end = nextHeading ? markdown.indexOf(`## ${nextHeading}`, start + startMarker.length) : markdown.length;
  assert.notEqual(end, -1, `missing section boundary ## ${nextHeading}`);
  return markdown.slice(start, end);
}

function extractReadmeNarrative(markdown: string, contract: (typeof README_NARRATIVE_CONTRACT)[number]) {
  const section = extractSection(markdown, contract.heading, contract.nextHeading);
  const introEnd = markdown.indexOf("\n## ");
  assert.equal(markdown.indexOf(`## ${contract.heading}`), introEnd + 1, `${contract.path} narrative must follow the introduction`);
  const bullets = section.split(/\r?\n/).filter((line) => /^- /.test(line));
  assert.equal(bullets.length, 3, `${contract.path} narrative must contain exactly three bullets`);
  return { section, bullets };
}

function assertExactUniqueSet(actual: string[], expected: readonly string[], label: string) {
  assert.equal(new Set(actual).size, actual.length, `${label} must not contain duplicates`);
  assert.deepEqual([...actual].sort(), [...expected].sort(), `${label} exact set drift`);
}

function resolvePublicTarget(sourcePath: string, target: string) {
  const withoutFragment = target.split("#", 1)[0];
  return path.normalize(path.resolve(path.dirname(sourcePath), withoutFragment));
}

function repositoryRelativePath(absolutePath: string) {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
}

describe("reviewer tour contract", () => {
  it("locks ten stops, thirty minutes, four checkpoint fields, and the exact question distribution", () => {
    assertExactUniqueSet(EXPECTED_STOP_IDS, Array.from({ length: 10 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`), "stop IDs");
    assert.deepEqual(EXPECTED_STOP_MINUTES, [3, 6, 1, 1, 2, 2, 1, 10, 2, 2]);
    assert.equal(EXPECTED_STOP_MINUTES.reduce((sum, minutes) => sum + minutes, 0), 30);
    assertExactUniqueSet([...CHECKPOINT_FIELD_LABELS], ["為何讀", "精讀範圍", "讀完應能回答", "下一站"], "checkpoint fields");
    assertExactUniqueSet(QUESTION_CONTRACT.map(({ id }) => id), Array.from({ length: 10 }, (_, index) => `Q${String(index + 1).padStart(2, "0")}`), "question IDs");

    const categoryCounts = Object.fromEntries(
      Object.keys(QUESTION_CATEGORY_COUNTS).map((category) => [
        category,
        QUESTION_CONTRACT.filter((question) => question.category === category).length,
      ]),
    );
    assert.deepEqual(categoryCounts, QUESTION_CATEGORY_COUNTS);
    for (const question of QUESTION_CONTRACT) {
      assert.ok(question.question.length > 0, `${question.id} needs exact question semantics`);
      assert.ok(question.expectedAnchors.length > 0, `${question.id} needs expected anchors`);
      assert.ok(question.directTargets.length > 0, `${question.id} needs a direct primary source`);
    }
  });

  it("locks the unique required ten-stop journey and direct one/two-hop answer sources", async () => {
    let markdown: string;
    try {
      markdown = await readFile(TOUR_PATH, "utf8");
    } catch {
      assert.fail(`${TOUR_PATH} is missing`);
    }
    const stops = extractTourStops(markdown);
    assert.deepEqual(stops.map(({ id }) => id), EXPECTED_STOP_IDS, `${TOUR_PATH} stop order drift`);
    assert.deepEqual(stops.map(({ minutes }) => minutes), EXPECTED_STOP_MINUTES, `${TOUR_PATH} minute allocation drift`);
    assert.equal(stops.reduce((sum, stop) => sum + stop.minutes, 0), 30, `${TOUR_PATH} required path must total 30 minutes`);
    for (const stop of stops) {
      assertExactUniqueSet([...stop.fields.keys()], CHECKPOINT_FIELD_LABELS, `${stop.id} checkpoint fields`);
    }
    const stopSourceJobs = [
      ["../README.md#為什麼做這個專案"],
      ["architecture.md#總覽", "architecture.md#主要元件", "architecture.md#meal-logging", "architecture.md#llm-boundary", "architecture.md#data-model"],
      ["capability-matrix.md#capability-matrix"],
      ["adr/0001-metadata-only-llm-failure-localization.md#context", "adr/0001-metadata-only-llm-failure-localization.md#decision", "adr/0001-metadata-only-llm-failure-localization.md#consequences"],
      ["adr/0003-structured-boundaries-and-authoritative-state.md#context", "adr/0003-structured-boundaries-and-authoritative-state.md#decision", "adr/0003-structured-boundaries-and-authoritative-state.md#consequences"],
      ["adr/0006-agent-side-effect-policy-taxonomy.md#context", "adr/0006-agent-side-effect-policy-taxonomy.md#decision", "adr/0006-agent-side-effect-policy-taxonomy.md#consequences", "../server/orchestrator/tool-contract.ts"],
      ["adr/0010-nutrition-safety-product-floor.md#context", "adr/0010-nutrition-safety-product-floor.md#decision", "adr/0010-nutrition-safety-product-floor.md#verification"],
      ["ai-safety.md#threat-model-trust-and-authority-boundaries", "ai-safety.md#deterministic-safety-cases", "ai-safety.md#the-1200-kcal-product-safety-floor"],
      ["../tests/harness/behavior-matrix.md#cases", "../tests/harness/behavior-matrix.md#risk-coverage-distribution", "../tests/harness/behavior-matrix.md#risk-to-assertion-coverage", "../tests/harness/cases/case-11-malicious-tool-json.ts", "../tests/harness/cases/case-12-unauthorized-goal-update.ts"],
      ["ai-safety.md#known-limitations-and-future-eval-questions", "capability-matrix.md#capability-matrix"],
    ] as const;
    for (let index = 0; index < stops.length; index += 1) {
      const stopTargets = extractMarkdownLinks(stops[index].body).map(({ target }) => target);
      for (const target of stopSourceJobs[index]) {
        assert.ok(stopTargets.includes(target), `${stops[index].id} missing its ordered source job ${target}`);
      }
    }

    const requiredLinks = extractMarkdownLinks(markdown).filter((link) =>
      REQUIRED_SOURCE_TARGETS.includes(link.target as (typeof REQUIRED_SOURCE_TARGETS)[number]),
    );
    assertExactUniqueSet(requiredLinks.map(({ target }) => target), REQUIRED_SOURCE_TARGETS, "required tour source targets");
    for (const question of QUESTION_CONTRACT) {
      assert.ok(
        question.directTargets.every((target) => requiredLinks.some((link) => link.target === target)),
        `${question.id} primary answer sources must be direct ${TOUR_PATH} links (one hop; README -> tour -> source is two)`,
      );
    }
    assert.equal(markdown.match(/^## 30 分鐘唯一必讀路徑$/gm)?.length, 1, "one unique required path is required");
    assert.doesNotMatch(markdown, /(?:依角色|role-based|替代路徑|alternative route)/i, "alternative role-based routes are forbidden");
    const optionalIndex = markdown.indexOf("## 30 分鐘之外的延伸閱讀");
    if (optionalIndex !== -1) {
      assert.ok(optionalIndex > markdown.lastIndexOf("### S10"), "optional reading must be outside the required path");
      assert.match(markdown.slice(optionalIndex), /不計入 30 分鐘/, "optional reading must be visibly outside the budget");
    }
  });

  for (const contract of README_NARRATIVE_CONTRACT) {
    it(`locks ${contract.path} ${contract.heading} three-role narrative`, async () => {
      const markdown = await readFile(contract.path, "utf8");
      const { section, bullets } = extractReadmeNarrative(markdown, contract);
      for (let index = 0; index < contract.bulletAnchors.length; index += 1) {
        for (const anchor of contract.bulletAnchors[index]) {
          assert.ok(bullets[index].includes(anchor), `${contract.path} bullet ${index + 1} missing ${anchor}`);
        }
      }
      const tourLinks = extractMarkdownLinks(section).filter(({ target }) => target === "docs/tour.md");
      assert.equal(tourLinks.length, 1, `${contract.path} narrative needs one docs/tour.md link`);
    });
  }

  it("pairs every fragmented source target with one exact unique heading", async () => {
    assert.equal(REQUIRED_SOURCE_HEADINGS.size, REQUIRED_SOURCE_TARGETS.filter((target) => target.includes("#")).length);
    for (const [target, expectedHeading] of REQUIRED_SOURCE_HEADINGS) {
      const sourcePath = resolvePublicTarget(TOUR_PATH, target);
      const relative = repositoryRelativePath(sourcePath);
      assert.ok(!relative.startsWith("../"), `source target escapes repository: ${target}`);
      const source = await readFile(sourcePath, "utf8");
      assert.equal(
        source.split(/\r?\n/).filter((line) => line === expectedHeading).length,
        1,
        `${target} must pair with exactly one ${expectedHeading}`,
      );
    }
  });

  it("uses existing unit discovery and release wiring without script changes", async () => {
    const [packageSource, releaseSource] = await Promise.all([
      readFile("package.json", "utf8"),
      readFile("scripts/release-check.mjs", "utf8"),
    ]);
    const packageJson = JSON.parse(packageSource) as { scripts: Record<string, string> };
    assert.match(packageJson.scripts.test, /tests\/unit\/\*\.test\.ts/);
    assert.match(packageJson.scripts["test:unit"], /tests\/unit\/\*\.test\.ts/);
    assert.match(releaseSource, /runStep\("Full test suite", \["test"\]\)/);
    assert.match(releaseSource, /runStep\("Capability matrix generated doc drift", \["matrix:gen:check"\]\)/);
    assert.match(releaseSource, /runStep\("Behavior matrix generated doc drift", \["behavior-matrix:gen:check"\]\)/);
    await assert.doesNotReject(stat("tests/unit/reviewer-tour-contract.test.ts"));
  });
});
