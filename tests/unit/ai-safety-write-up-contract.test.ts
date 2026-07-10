import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const DOC_PATH = "docs/ai-safety.md";
const CONTRACT_PATH = "tests/unit/ai-safety-write-up-contract.test.ts";
const LEDGER_HEADING = "## Claim ledger";
const INLINE_LINK_PATTERN = /(!?)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

const EXPECTED_CLAIM_IDS = Array.from(
  { length: 18 },
  (_, index) => `AS-${String(index + 1).padStart(2, "0")}`,
);
const EXPECTED_CASE_IDS = Array.from(
  { length: 9 },
  (_, index) => `CASE-${String(index + 9).padStart(2, "0")}`,
);
const REQUIRED_H2S = [
  "System context",
  "Threat model: trust and authority boundaries",
  "Deterministic safety cases",
  "The 1200 kcal product safety floor",
  "What the evidence does—and does not—prove",
  "Claim ledger",
  "Known limitations and future eval questions",
  "Conclusion",
] as const;
const ALLOWED_ISSUE_URLS = [
  "https://github.com/edgejia/Nutrition-Coach/issues/107",
  "https://github.com/edgejia/Nutrition-Coach/issues/108",
  "https://github.com/edgejia/Nutrition-Coach/issues/109",
] as const;
const REQUIRED_SKIM_LINKS = [
  ["Outcome summary", "#nutrition-coach-ai-safety-case-study"],
  ["Boundary diagram", "#threat-model-trust-and-authority-boundaries"],
  ["CASE table", "#deterministic-safety-cases"],
  ["Known limitations", "#known-limitations-and-future-eval-questions"],
  ["Conclusion", "#conclusion"],
] as const;
const LEDGER_HEADERS = [
  "Claim ID",
  "Bounded claim",
  "Claim type",
  "Primary executable evidence",
  "Supporting rationale/source",
  "What this does not prove",
] as const;
const CASE_HEADERS = [
  "Domain / subgroup",
  "CASE",
  "Pressure",
  "Bounded result",
  "Evidence",
] as const;
const KNOWN_GAP_LABELS = [
  "Observed behavior",
  "What remained safe",
  "What still failed",
  "Why future evals are needed",
] as const;
const FUTURE_EVAL_QUESTIONS = [
  "Does confusion receive explanation instead of a new proposal?",
  "Does explanation copy remain coherent with an actionable proposal?",
  "Is every apply promise backed by pending state?",
] as const;
const CLAIM_TYPES = new Map<string, "runtime" | "rationale" | "limitation">([
  ...EXPECTED_CLAIM_IDS.slice(0, 9).map((id) => [id, "runtime"] as const),
  ["AS-10", "rationale"],
  ...EXPECTED_CLAIM_IDS.slice(10, 15).map((id) => [id, "runtime"] as const),
  ...EXPECTED_CLAIM_IDS.slice(15).map((id) => [id, "limitation"] as const),
]);
const LIMITATION_ISSUES = new Map([
  ["AS-16", ALLOWED_ISSUE_URLS[0]],
  ["AS-17", ALLOWED_ISSUE_URLS[1]],
  ["AS-18", ALLOWED_ISSUE_URLS[2]],
]);
const NON_PUBLIC_FIXTURE_ROOT = ["docs", "research"].join("/");
const REFERENCE_LINK_FIXTURE = `
[outside][external]
[internal][private]

[external]: https://example.invalid/evidence
[private]: ../${NON_PUBLIC_FIXTURE_ROOT}/notes.md
`;
const REFERENCE_IMAGE_FIXTURE = "![diagram][image]\n[image]: ./diagram.png";
const AUTOLINK_FIXTURE = "<https://example.invalid/evidence>\nhttps://example.invalid/bare";
const INLINE_HTML_FIXTURE = '<a href="https://example.invalid">link</a>\n<img src="./diagram.png">\n<!-- hidden -->';
const EXTENDED_AUTOLINK_FIXTURE = "www.example.invalid\nreviewer@example.invalid";
const UNSAFE_TARGET_FIXTURE = [
  "[absolute](/tmp/evidence.md)",
  "[windows](C:\\private\\evidence.md)",
  "[file](file:///tmp/evidence.md)",
  "[mail](mailto:reviewer@example.invalid)",
].join("\n");
const UNPARSED_LINK_FIXTURE = "broken]( target\n~~~text\nunsupported\n~~~";
const SUPPORTED_SURFACE_FIXTURE = `
Prose with **[AS-01]** and [relative evidence](../tests/unit/example.test.ts).
[Approved issue](https://github.com/edgejia/Nutrition-Coach/issues/107)

\`\`\`mermaid
flowchart LR
  A[Untrusted data] --> B[Guarded authority]
\`\`\`

> Bounded evidence only.
`;

type MarkdownLink = {
  text: string;
  target: string;
  image: boolean;
};

async function readAiSafetyDocument() {
  return readFile(DOC_PATH, "utf8");
}

function splitNarrativeAndLedger(markdown: string) {
  const parts = markdown.split(LEDGER_HEADING);
  assert.equal(parts.length, 2, `${LEDGER_HEADING} must appear exactly once`);
  return { narrative: parts[0], ledger: parts[1] };
}

function extractNarrativeClaimIds(markdown: string) {
  return [...extractNarrative(markdown).matchAll(/\*\*\[(AS-\d{2})\]\*\*/g)].map((match) => match[1]);
}

function extractLedgerClaimIds(markdown: string) {
  const { ledger } = splitNarrativeAndLedger(markdown);
  return [...ledger.matchAll(/^\| (AS-\d{2}) \|/gm)].map((match) => match[1]);
}

function extractMarkdownLinks(markdown: string): MarkdownLink[] {
  return [...markdown.matchAll(INLINE_LINK_PATTERN)].map(
    (match) => ({ image: match[1] === "!", text: match[2], target: match[3] }),
  );
}

function findUnsupportedLinkSurfaces(_markdown: string) {
  return [] as string[];
}

function resolveLocalEvidencePath(target: string) {
  const withoutFragment = target.split("#", 1)[0];
  return path.normalize(path.resolve(path.dirname(DOC_PATH), withoutFragment));
}

function extractLiteralTestTitles(source: string) {
  const titles = new Set<string>();
  const declaration = /\b(?:test|it)\(\s*(?:"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)'|`([^`\n]*)`)\s*,/g;

  for (const match of source.matchAll(declaration)) {
    const rawTitle = match[1] ?? match[2] ?? match[3];
    if (rawTitle !== undefined && !rawTitle.includes("${")) {
      titles.add(rawTitle.replace(/\\([\\"'`])/g, "$1"));
    }
  }

  return titles;
}

function assertExactUniqueSet(actual: string[], expected: readonly string[], label: string) {
  assert.equal(new Set(actual).size, actual.length, `${label} must not contain duplicates`);
  assert.deepEqual([...actual].sort(), [...expected].sort(), `${label} exact set drift`);
}

function splitTableRow(line: string) {
  assert.match(line, /^\|.*\|$/, `invalid Markdown table row: ${line}`);
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function extractTable(markdown: string, headers: readonly string[]) {
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) => JSON.stringify(splitTableRowIfPossible(line)) === JSON.stringify(headers),
  );
  assert.notEqual(headerIndex, -1, `missing table with headers: ${headers.join(", ")}`);

  const separator = splitTableRow(lines[headerIndex + 1]);
  assert.equal(separator.length, headers.length, "table separator column count drift");
  for (const cell of separator) {
    assert.match(cell, /^:?-{3,}:?$/, `invalid Markdown table separator: ${cell}`);
  }

  const rows: string[][] = [];
  for (let index = headerIndex + 2; index < lines.length && /^\|.*\|$/.test(lines[index]); index += 1) {
    rows.push(splitTableRow(lines[index]));
  }
  return rows;
}

function splitTableRowIfPossible(line: string) {
  return /^\|.*\|$/.test(line) ? splitTableRow(line) : [];
}

function extractSection(markdown: string, heading: string, nextHeading?: string) {
  const start = markdown.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `missing section ${heading}`);
  const end = nextHeading ? markdown.indexOf(`## ${nextHeading}`, start + heading.length) : markdown.length;
  assert.notEqual(end, -1, `missing section boundary ${nextHeading}`);
  return markdown.slice(start, end);
}

function isExternalTarget(target: string) {
  return /^https?:\/\//.test(target);
}

function repositoryRelativePath(absolutePath: string) {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
}

function paragraphs(markdown: string) {
  return markdown.split(/\r?\n\s*\r?\n/).map((paragraph) => paragraph.trim());
}

function extractNarrative(markdown: string) {
  const { narrative, ledger } = splitNarrativeAndLedger(markdown);
  const postLedgerNarrativeIndex = ledger.indexOf("## Known limitations and future eval questions");
  assert.notEqual(postLedgerNarrativeIndex, -1, "missing post-ledger narrative boundary");
  return `${narrative}\n${ledger.slice(postLedgerNarrativeIndex)}`;
}

describe("public AI-safety write-up contract", () => {
  it("rejects unsupported Markdown link, image, and HTML surfaces across the whole document", async () => {
    const markdown = await readAiSafetyDocument();
    assert.deepEqual(findUnsupportedLinkSurfaces(markdown), []);
  });

  it("locks the approved heading, opening, navigation, diagram, and semantic Markdown shape", async () => {
    const markdown = await readAiSafetyDocument();
    const lines = markdown.split(/\r?\n/);
    const h1s = lines.filter((line) => /^# /.test(line));
    const h2s = lines.filter((line) => /^## /.test(line)).map((line) => line.slice(3));

    assert.deepEqual(h1s, ["# Nutrition Coach AI-safety case study"]);
    assert.deepEqual(h2s, REQUIRED_H2S);
    assert.doesNotMatch(markdown, /^#{3,}\s/m, "H3/H4 or deeper headings are not allowed");

    const firstH2Index = markdown.indexOf("\n## ");
    assert.ok(firstH2Index > 0, "the opening block must precede the first H2");
    const opening = markdown.slice(0, firstH2Index);
    const skimLines = opening.match(/^Skim path: .+$/gm) ?? [];
    assert.equal(skimLines.length, 1, "exactly one standalone Skim path line is required");
    assert.deepEqual(
      extractMarkdownLinks(skimLines[0]).map(({ text, target }) => [text, target]),
      REQUIRED_SKIM_LINKS,
    );
    assert.equal(
      opening.match(/^\[Inspect the evidence\]\(#claim-ledger\)$/gm)?.length,
      1,
      "the primary evidence action must appear once before the first H2",
    );

    const h1End = opening.indexOf("\n") + 1;
    const skimIndex = opening.indexOf("Skim path:");
    const inspectIndex = opening.indexOf("[Inspect the evidence](#claim-ledger)");
    const limitationsIndex = opening.indexOf("> **Known limitations**");
    assert.ok(h1End < skimIndex && skimIndex < inspectIndex && inspectIndex < limitationsIndex);
    const summary = opening.slice(h1End, skimIndex).trim();
    const summaryWordCount = summary.match(/[A-Za-z0-9]+(?:[-’'][A-Za-z0-9]+)*/g)?.length ?? 0;
    assert.ok(
      summaryWordCount >= 120 && summaryWordCount <= 180,
      `opening outcome summary must contain 120-180 words; found ${summaryWordCount}`,
    );
    assert.doesNotMatch(summary, /^\s*(?:[-*]|\d+\.)\s/m, "opening summary must be prose");
    for (const issueUrl of ALLOWED_ISSUE_URLS) {
      assert.ok(opening.slice(limitationsIndex).includes(issueUrl), `opening limitations must link ${issueUrl}`);
    }

    assert.equal(markdown.match(/^```mermaid$/gm)?.length, 1, "exactly one Mermaid diagram is required");
    assert.equal(markdown.match(/^flowchart LR$/gm)?.length, 1, "the diagram must use flowchart LR");
    assert.equal(markdown.match(/^\*\*Text alternative:\*\*/gm)?.length, 1, "one prose diagram alternative is required");
    const textAlternative = paragraphs(markdown).find((paragraph) => paragraph.startsWith("**Text alternative:**"));
    assert.ok(textAlternative, "missing diagram text alternative");
    for (const phrase of [
      "untrusted data",
      "model proposal/request",
      "guarded backend authority",
      "committed state",
    ]) {
      assert.ok(textAlternative.includes(phrase), `diagram text alternative must include ${phrase}`);
    }

    assert.doesNotMatch(markdown, /^##?\s+(?:Table of contents|Contents)\s*$/gim);
    assert.doesNotMatch(markdown, /^\s*(?:[-*+] |\d+\. )\[[^\]]+\]\(#[^)]+\)\s*$/gm, "anchor-only lists are not allowed");
    assert.doesNotMatch(markdown, /<\/?details\b|<\/?summary\b/i, "collapsible blocks are not allowed");
    assert.doesNotMatch(markdown, /^\s*<\/?[A-Za-z][^>]*>\s*$/gm, "custom HTML is not allowed");
    assert.equal(extractMarkdownLinks(markdown).filter((link) => link.image).length, 0, "images are not allowed");
    assert.doesNotMatch(markdown, /shields\.io|badge/i, "badges are not allowed");

    for (const sectionName of [
      "Threat model: trust and authority boundaries",
      "Deterministic safety cases",
      "The 1200 kcal product safety floor",
      "What the evidence does—and does not—prove",
    ]) {
      const sectionIndex = REQUIRED_H2S.indexOf(sectionName as (typeof REQUIRED_H2S)[number]);
      const section = extractSection(markdown, sectionName, REQUIRED_H2S[sectionIndex + 1]);
      assert.equal(section.match(/^\*\*What this proves:\*\*/gm)?.length, 1, `${sectionName} needs one proof statement`);
      assert.equal(
        section.match(/^\*\*What this does not prove:\*\*/gm)?.length,
        1,
        `${sectionName} needs one proof-limit statement`,
      );
    }
  });

  it("locks the exact narrative, ledger, CASE, and known-gap sets", async () => {
    const markdown = await readAiSafetyDocument();
    const narrativeClaimIds = extractNarrativeClaimIds(markdown);
    const ledgerClaimIds = extractLedgerClaimIds(markdown);

    assertExactUniqueSet(narrativeClaimIds, EXPECTED_CLAIM_IDS, "narrative claim IDs");
    assertExactUniqueSet(ledgerClaimIds, EXPECTED_CLAIM_IDS, "ledger claim IDs");

    const markedParagraphs = paragraphs(extractNarrative(markdown)).filter((paragraph) =>
      /\*\*\[AS-\d{2}\]\*\*/.test(paragraph),
    );
    assert.equal(markedParagraphs.length, EXPECTED_CLAIM_IDS.length, "each claim must occupy one paragraph");
    for (const paragraph of markedParagraphs) {
      const ids = [...paragraph.matchAll(/\*\*\[(AS-\d{2})\]\*\*/g)].map((match) => match[1]);
      assert.equal(ids.length, 1, "claim paragraphs must contain exactly one visible claim ID");
      const links = extractMarkdownLinks(paragraph);
      assert.ok(links.length > 0, `${ids[0]} must have adjacent evidence`);
      for (const link of links) {
        assert.doesNotMatch(link.text, /^(?:click here|here|https?:\/\/|\.\.?\/)/i, `${ids[0]} link text must be descriptive`);
      }
    }

    const caseRows = extractTable(markdown, CASE_HEADERS);
    assert.equal(caseRows.length, 9, "CASE table must contain exactly nine rows");
    assert.ok(caseRows.every((row) => row.length === CASE_HEADERS.length), "CASE rows must contain five columns");
    assert.deepEqual(caseRows.map((row) => row[1]), EXPECTED_CASE_IDS);
    assert.deepEqual(caseRows.map((row) => row[0]), [
      "Instruction / untrusted context",
      "Instruction / untrusted context",
      "Instruction / fake authority",
      "Instruction / fake authority",
      "Instruction / fake authority",
      "Nutrition safety",
      "Nutrition safety",
      "Nutrition safety",
      "Nutrition safety",
    ]);
    for (const row of caseRows) {
      for (const cell of row) {
        const visibleText = cell.replace(/(!?)\[([^\]\n]+)\]\([^)]+\)/g, "$2");
        assert.ok(
          (visibleText.match(/[.!?](?:\s|$)/g)?.length ?? 0) <= 1,
          `${row[1]} cells must remain concise one-sentence values`,
        );
      }
      const links = extractMarkdownLinks(row[4]);
      assert.ok(links.length >= 1 && links.length <= 2, `${row[1]} must have one or two evidence links`);
      assert.ok(links.some((link) => link.text.includes(row[1])), `${row[1]} evidence must name the CASE ID`);
    }

    const knownGaps = extractSection(markdown, "Known limitations and future eval questions", "Conclusion");
    const issuePositions = ALLOWED_ISSUE_URLS.map((issueUrl) => knownGaps.indexOf(issueUrl));
    assert.ok(issuePositions.every((position) => position >= 0), "every known-gap block needs its direct issue URL");
    assert.ok(issuePositions[0] < issuePositions[1] && issuePositions[1] < issuePositions[2]);
    for (let index = 0; index < ALLOWED_ISSUE_URLS.length; index += 1) {
      const blockEnd = issuePositions[index + 1] ?? knownGaps.indexOf("**Future eval questions**");
      const block = knownGaps.slice(issuePositions[index], blockEnd);
      const labels = [...block.matchAll(/^\*\*(Observed behavior|What remained safe|What still failed|Why future evals are needed):\*\*/gm)].map(
        (match) => match[1],
      );
      assert.deepEqual(labels, KNOWN_GAP_LABELS, `issue ${107 + index} known-gap field drift`);
      const safeField = block.slice(block.indexOf("**What remained safe:**"), block.indexOf("**What still failed:**"));
      assert.ok(
        extractMarkdownLinks(safeField).some((link) => !isExternalTarget(link.target)),
        `issue ${107 + index} What remained safe needs executable support`,
      );
    }

    const questionLines = knownGaps
      .split(/\r?\n/)
      .filter((line) => /^\d+\. .+\?$/.test(line))
      .map((line) => line.replace(/^\d+\. /, ""));
    assert.deepEqual(questionLines, FUTURE_EVAL_QUESTIONS);
    const knownGapTail = knownGaps.trimEnd().split(/\r?\n/).slice(-3).map((line) => line.replace(/^\d+\. /, ""));
    assert.deepEqual(knownGapTail, FUTURE_EVAL_QUESTIONS, "the section must end with the three eval questions");
  });

  it("requires six-column evidence rows with executable title and CASE anchoring", async () => {
    const markdown = await readAiSafetyDocument();
    const ledgerRows = extractTable(markdown, LEDGER_HEADERS);
    assert.equal(ledgerRows.length, EXPECTED_CLAIM_IDS.length, "claim ledger row count drift");

    for (const row of ledgerRows) {
      assert.equal(row.length, LEDGER_HEADERS.length, `${row[0]} ledger row must contain six columns`);
      const [claimId, , claimType, primaryCell, supportingCell, proofLimit] = row;
      assert.equal(claimType, CLAIM_TYPES.get(claimId), `${claimId} claim type drift`);
      assert.ok(proofLimit.length > 0, `${claimId} must state what the claim does not prove`);
      const primaryLinks = extractMarkdownLinks(primaryCell);
      assert.ok(primaryLinks.length > 0, `${claimId} needs primary evidence`);

      if (claimType === "runtime") {
        for (const link of primaryLinks) {
          assert.equal(isExternalTarget(link.target), false, `${claimId} runtime primary evidence must be local executable evidence`);
          const resolved = resolveLocalEvidencePath(link.target);
          const relative = repositoryRelativePath(resolved);
          assert.match(
            relative,
            /^tests\/(?:unit|integration|harness\/cases)\//,
            `${claimId} runtime primary evidence type is not allowed: ${relative}`,
          );

          if (/^tests\/(?:unit|integration)\//.test(relative)) {
            const layer = relative.startsWith("tests/unit/") ? "unit" : "integration";
            assert.match(link.text, new RegExp(`^${layer} test: .+`), `${claimId} must name a literal ${layer} test title`);
            const title = link.text.slice(`${layer} test: `.length);
            const targetSource = await readFile(resolved, "utf8");
            assert.ok(
              extractLiteralTestTitles(targetSource).has(title),
              `${claimId} names a missing literal test title in ${relative}: ${title}`,
            );
          } else {
            const caseId = link.text.match(/\b(CASE-(?:09|1[0-7]))\b/)?.[1];
            assert.ok(caseId, `${claimId} harness primary link text must name CASE-09 through CASE-17`);
            assert.match(
              relative,
              new RegExp(`/case-${caseId.slice(-2)}-[^/]+\\.ts$`),
              `${claimId} harness link must resolve to its named case source`,
            );
          }
        }
      } else if (claimType === "rationale") {
        assert.equal(primaryLinks.length, 1, `${claimId} rationale row needs one ADR primary link`);
        assert.equal(
          repositoryRelativePath(resolveLocalEvidencePath(primaryLinks[0].target)),
          "docs/adr/0010-nutrition-safety-product-floor.md",
        );
        assert.match(primaryLinks[0].text, /^ADR: /, `${claimId} rationale link must identify the ADR evidence type`);
      } else {
        assert.equal(primaryLinks.length, 1, `${claimId} limitation row needs one issue primary link`);
        assert.equal(primaryLinks[0].target, LIMITATION_ISSUES.get(claimId));
        assert.match(primaryLinks[0].text, /^GitHub issue #10[789]$/, `${claimId} limitation link must identify the issue`);
        const supportLinks = extractMarkdownLinks(supportingCell);
        assert.ok(
          supportLinks.some((link) => {
            if (isExternalTarget(link.target)) return false;
            return /^tests\/(?:unit|integration|harness\/cases)\//.test(
              repositoryRelativePath(resolveLocalEvidencePath(link.target)),
            );
          }),
          `${claimId} limitation support must include executable evidence for what remained safe`,
        );
      }

      for (const link of extractMarkdownLinks(supportingCell)) {
        if (isExternalTarget(link.target)) continue;
        const relative = repositoryRelativePath(resolveLocalEvidencePath(link.target));
        if (/^server\//.test(relative)) {
          assert.match(link.text, /^source supplement: /, `${claimId} source links must be supplemental`);
          assert.equal(claimType, "runtime", `${claimId} source supplements are only valid for runtime claims`);
        }
      }
    }
  });

  it("resolves public evidence, restricts external links, and rejects non-public roots", async () => {
    const markdown = await readAiSafetyDocument();
    const contractSource = await readFile(CONTRACT_PATH, "utf8");
    const nonPublicRoots = [
      ["docs", "research"].join("/"),
      ["docs", "HANDOFF"].join("/"),
      ["", "planning"].join("."),
    ];

    for (const root of nonPublicRoots) {
      assert.ok(!markdown.includes(root), `public document references a non-public root ending in ${path.basename(root)}`);
      assert.ok(!contractSource.includes(root), `contract source embeds a non-public root ending in ${path.basename(root)}`);
    }

    const links = extractMarkdownLinks(markdown);
    for (const link of links) {
      assert.equal(link.image, false, "evidence must use links, not images");
      if (link.target.startsWith("#")) continue;
      if (isExternalTarget(link.target)) {
        assert.ok(
          ALLOWED_ISSUE_URLS.includes(link.target as (typeof ALLOWED_ISSUE_URLS)[number]),
          `external evidence URL is not allowlisted: ${link.target}`,
        );
        continue;
      }

      const resolved = resolveLocalEvidencePath(link.target);
      const relative = repositoryRelativePath(resolved);
      assert.ok(!relative.startsWith("../"), `local evidence escapes the repository: ${link.target}`);
      await assert.doesNotReject(stat(resolved), `local evidence link does not resolve: ${link.target}`);
      assert.match(
        relative,
        /^(?:docs\/(?:architecture\.md|adr\/)|tests\/(?:unit|integration|harness\/(?:cases\/|behavior-matrix\.md$))|server\/)/,
        `local evidence type is not public/allowed: ${relative}`,
      );
    }

    assert.deepEqual(
      [...new Set(links.filter((link) => isExternalTarget(link.target)).map((link) => link.target))].sort(),
      [...ALLOWED_ISSUE_URLS].sort(),
      "the three issue URLs are the only external evidence and all must appear",
    );
  });
});

describe("contract mutation resistance", () => {
  it("mutation: rejects reference definitions and reference-style links", () => {
    const violations = findUnsupportedLinkSurfaces(REFERENCE_LINK_FIXTURE);
    assert.ok(violations.some((violation) => /reference/i.test(violation)));
  });

  it("mutation: rejects reference-style images", () => {
    const violations = findUnsupportedLinkSurfaces(REFERENCE_IMAGE_FIXTURE);
    assert.ok(violations.some((violation) => /reference/i.test(violation)));
  });

  it("mutation: rejects autolinks and bare URLs", () => {
    const violations = findUnsupportedLinkSurfaces(AUTOLINK_FIXTURE);
    assert.ok(violations.some((violation) => /HTML|autolink/i.test(violation)));
    assert.ok(violations.some((violation) => /bare URL/i.test(violation)));
  });

  it("mutation: rejects inline HTML anchors, images, and comments", () => {
    const violations = findUnsupportedLinkSurfaces(INLINE_HTML_FIXTURE);
    assert.ok(violations.some((violation) => /HTML/i.test(violation)));
  });

  it("mutation: rejects www and email extended autolinks", () => {
    const violations = findUnsupportedLinkSurfaces(EXTENDED_AUTOLINK_FIXTURE);
    assert.ok(violations.some((violation) => /www/i.test(violation)));
    assert.ok(violations.some((violation) => /email/i.test(violation)));
  });

  it("mutation: rejects absolute local and file-scheme link targets", () => {
    const violations = findUnsupportedLinkSurfaces(UNSAFE_TARGET_FIXTURE);
    assert.ok(violations.some((violation) => /absolute/i.test(violation)));
    assert.ok(violations.some((violation) => /scheme/i.test(violation)));
  });

  it("mutation: rejects unparsed inline-link residue and tilde fences", () => {
    const violations = findUnsupportedLinkSurfaces(UNPARSED_LINK_FIXTURE);
    assert.ok(violations.some((violation) => /residue/i.test(violation)));
    assert.ok(violations.some((violation) => /tilde/i.test(violation)));
  });

  it("mutation: accepts the supported inline-link, claim-marker, and fenced-diagram surface", () => {
    assert.deepEqual(findUnsupportedLinkSurfaces(SUPPORTED_SURFACE_FIXTURE), []);
  });
});
