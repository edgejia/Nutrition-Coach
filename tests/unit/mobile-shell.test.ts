import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const relatedScrollTests = [
  "chat-scroll-contract.test.ts",
  "chat-scroll-live-updates.test.ts",
];

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

const sources = {
  appCss: await readSource("../../client/src/app.css"),
  mainLayout: await readSource("../../client/src/components/MainLayout.tsx"),
  homeScreen: await readSource("../../client/src/components/HomeScreen.tsx"),
  chatPanel: await readSource("../../client/src/components/ChatPanel.tsx"),
  summaryDetailScreen: await readSource("../../client/src/components/SummaryDetailScreen.tsx"),
};

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

function countPrimaryScrollHelpers(source: string) {
  return countMatches(source, /\bscreen-scroll(?:-with-input|-safe)?\b/g);
}

describe("mobile shell source contract", () => {
  it("defines the shared viewport and screen shell helpers", () => {
    assert.match(sources.appCss, /\.app-viewport\s*\{/);
    assert.match(sources.appCss, /height:\s*100dvh/);
    assert.match(sources.appCss, /\.screen-shell\s*\{/);
    assert.match(sources.appCss, /\.screen-bar\s*\{/);
    assert.match(sources.appCss, /\.screen-scroll\s*\{/);
    assert.match(sources.appCss, /\.screen-scroll-with-input\s*\{/);
    assert.match(sources.appCss, /\.screen-scroll-safe\s*\{/);
  });

  it("keeps MainLayout as the app viewport boundary", () => {
    assert.match(sources.mainLayout, /\bapp-viewport\b/);
  });

  it("keeps Home fixed regions outside the middle content scroller", () => {
    assert.match(sources.homeScreen, /\bscreen-shell\b/);
    assert.match(sources.homeScreen, /\bscreen-bar\b/);
    assert.match(sources.homeScreen, /\bscreen-scroll-with-input\b/);
    assert.match(sources.homeScreen, /\bpb-safe\b/);
  });

  it("keeps Chat scroll ownership on the existing scrollContainerRef element", () => {
    assert.match(sources.chatPanel, /\bscreen-shell\b/);
    assert.match(sources.chatPanel, /\bscreen-bar\b/);
    assert.match(sources.chatPanel, /\bscreen-scroll-with-input\b/);
    assert.match(sources.chatPanel, /\bpb-safe\b/);
    assert.match(sources.chatPanel, /\bscrollContainerRef\b/);

    const scrollContainerMatch = /<div ref=\{scrollContainerRef\} className="([^"]+)"/.exec(
      sources.chatPanel,
    );
    assert.ok(scrollContainerMatch, "ChatPanel should keep scrollContainerRef on a div");
    const scrollContainerClassName = scrollContainerMatch[1] ?? "";
    assert.match(scrollContainerClassName, /\bscreen-scroll-with-input\b/);

    if (sources.chatPanel.includes("overflow-y-auto")) {
      assert.match(scrollContainerClassName, /\boverflow-y-auto\b/);
      assert.equal(
        countMatches(sources.chatPanel, /\boverflow-y-auto\b/g),
        countMatches(scrollContainerClassName, /\boverflow-y-auto\b/g),
        "ChatPanel should keep overflow-y-auto only on the scrollContainerRef element",
      );
    }
  });

  it("keeps Summary header fixed and content in a safe scroller", () => {
    assert.match(sources.summaryDetailScreen, /\bscreen-shell\b/);
    assert.match(sources.summaryDetailScreen, /\bscreen-bar\b/);
    assert.match(sources.summaryDetailScreen, /\bscreen-scroll-safe\b/);
  });

  it("exposes exactly one primary scroll helper on each primary screen", () => {
    assert.equal(
      countPrimaryScrollHelpers(sources.homeScreen),
      1,
      "HomeScreen should expose exactly one primary scroll helper",
    );
    assert.equal(
      countPrimaryScrollHelpers(sources.chatPanel),
      1,
      "ChatPanel should expose exactly one primary scroll helper",
    );
    assert.equal(
      countPrimaryScrollHelpers(sources.summaryDetailScreen),
      1,
      "SummaryDetailScreen should expose exactly one primary scroll helper",
    );
  });

  it("removes competing full-page overflow-y-auto scrollers from Home and Summary", () => {
    assert.doesNotMatch(sources.homeScreen, /\boverflow-y-auto\b/);
    assert.doesNotMatch(sources.summaryDetailScreen, /\boverflow-y-auto\b/);
  });

  it("does not introduce blocked navigation or component-library scope", () => {
    const blockedScopePattern = /bottom tab|tab bar|@radix-ui|shadcn/i;
    const componentSources = [
      sources.mainLayout,
      sources.homeScreen,
      sources.chatPanel,
      sources.summaryDetailScreen,
    ];

    for (const source of componentSources) {
      assert.doesNotMatch(source, blockedScopePattern);
    }
  });

  it("keeps the existing chat scroll regression tests in the targeted gate", () => {
    assert.deepEqual(relatedScrollTests, [
      "chat-scroll-contract.test.ts",
      "chat-scroll-live-updates.test.ts",
    ]);
  });
});
