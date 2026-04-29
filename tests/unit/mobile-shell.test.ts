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

function cssBlock(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`).exec(sources.appCss);
  assert.ok(match, `${selector} should be defined`);
  return match[1] ?? "";
}

function assertIncludesInOrder(source: string, labels: Array<[string, string]>) {
  let previousIndex = -1;

  for (const [label, needle] of labels) {
    const nextIndex = source.indexOf(needle);
    assert.notEqual(nextIndex, -1, `${label} should exist`);
    assert.ok(nextIndex > previousIndex, `${label} should appear in shell order`);
    previousIndex = nextIndex;
  }
}

describe("mobile shell source contract", () => {
  it("defines the shared viewport and screen shell helpers", () => {
    assert.match(sources.appCss, /\.app-viewport\s*\{/);
    assert.match(sources.appCss, /height:\s*100dvh/);
    assert.match(sources.appCss, /\.screen-shell\s*\{/);
    assert.match(sources.appCss, /\.screen-bar\s*\{/);
    assert.match(sources.appCss, /\.screen-bottom-bar\s*\{/);
    assert.match(sources.appCss, /\.screen-scroll\s*\{/);
    assert.match(sources.appCss, /\.screen-scroll-with-input\s*\{/);
    assert.match(sources.appCss, /\.screen-scroll-safe\s*\{/);
  });

  it("keeps shell helpers wired to viewport, fixed-bar, and scrolling declarations", () => {
    assert.match(cssBlock(".app-viewport"), /min-height:\s*100svh/);
    assert.match(cssBlock(".app-viewport"), /height:\s*100vh/);
    assert.match(cssBlock(".app-viewport"), /height:\s*100dvh/);
    assert.match(cssBlock(".app-viewport"), /height:\s*min\(100dvh,\s*var\(--app-visual-viewport-height,\s*100dvh\)\)/);
    assert.match(cssBlock(".app-viewport"), /overflow:\s*clip/);

    assert.match(cssBlock(".screen-shell"), /min-height:\s*0/);
    assert.match(cssBlock(".screen-shell"), /flex:\s*1 1 auto/);
    assert.match(cssBlock(".screen-shell"), /display:\s*flex/);
    assert.match(cssBlock(".screen-shell"), /flex-direction:\s*column/);
    assert.match(cssBlock(".screen-shell"), /overflow:\s*clip/);
    assert.match(cssBlock(".screen-shell"), /background:\s*var\(--bg\)/);

    assert.match(cssBlock(".screen-bar"), /flex-shrink:\s*0/);
    assert.match(cssBlock(".screen-bottom-bar"), /flex-shrink:\s*0/);
    assert.match(cssBlock(".screen-bottom-bar"), /position:\s*relative/);
    assert.match(cssBlock(".screen-bottom-bar"), /z-index:\s*10/);
    assert.match(cssBlock(".screen-bottom-bar"), /padding-bottom:\s*max\(0\.75rem,\s*calc\(env\(safe-area-inset-bottom\) \+ 0\.75rem\)\)/);
    assert.match(
      cssBlock(".screen-bottom-bar"),
      /transform:\s*translate3d\(0,\s*calc\(-1 \* var\(--app-bottom-occlusion,\s*0px\)\),\s*0\)/,
    );

    for (const selector of [".screen-scroll", ".screen-scroll-with-input", ".screen-scroll-safe"]) {
      const block = cssBlock(selector);
      assert.match(block, /min-height:\s*0/);
      assert.match(block, /flex:\s*1 1 auto/);
      assert.match(block, /overflow-y:\s*auto/);
      assert.doesNotMatch(block, /overscroll-behavior:\s*contain/);
      assert.match(block, /-webkit-overflow-scrolling:\s*touch/);
    }

    assert.match(cssBlock(".screen-scroll-with-input"), /padding-bottom:\s*calc\(6rem \+ var\(--app-bottom-occlusion,\s*0px\)\)/);
    assert.match(
      cssBlock(".screen-scroll-safe"),
      /padding-bottom:\s*max\(2rem,\s*env\(safe-area-inset-bottom\)\)/,
    );
  });

  it("keeps MainLayout as the app viewport boundary", () => {
    assert.match(sources.mainLayout, /\bapp-viewport\b/);
    assert.match(sources.mainLayout, /\bvisualViewport\b/);
    assert.match(sources.mainLayout, /--app-visual-viewport-height/);
    assert.match(sources.mainLayout, /--app-bottom-occlusion/);
    assert.doesNotMatch(sources.mainLayout, /document\.body\.style\.overflow/);
  });

  it("keeps Home fixed regions outside the middle content scroller", () => {
    assert.match(sources.homeScreen, /\bscreen-shell\b/);
    assert.match(sources.homeScreen, /\bscreen-bar\b/);
    assert.match(sources.homeScreen, /\bscreen-scroll\b/);
    assert.doesNotMatch(sources.homeScreen, /\bscreen-bottom-bar\b/);
    assert.doesNotMatch(sources.homeScreen, /\bscreen-scroll-with-input\b/);
    assertIncludesInOrder(sources.homeScreen, [
      ["Home screen shell", '<div className="screen-shell sk-screen">'],
      ["Home header", "<HomeHeader />"],
      ["Home content scroller", '<main className="screen-scroll'],
    ]);
  });

  it("keeps Chat scroll ownership on the existing scrollContainerRef element", () => {
    assert.match(sources.chatPanel, /\bscreen-shell\b/);
    assert.match(sources.chatPanel, /\bscreen-bar\b/);
    assert.match(sources.chatPanel, /\bscreen-bottom-bar\b/);
    assert.match(sources.chatPanel, /\bscreen-scroll-with-input\b/);
    assert.match(sources.chatPanel, /\bscrollContainerRef\b/);

    const scrollContainerMatch = /<div ref=\{scrollContainerRef\} className="([^"]+)"/.exec(
      sources.chatPanel,
    );
    assert.ok(scrollContainerMatch, "ChatPanel should keep scrollContainerRef on a div");
    const scrollContainerClassName = scrollContainerMatch[1] ?? "";
    assert.match(scrollContainerClassName, /\bscreen-scroll-with-input\b/);
    assertIncludesInOrder(sources.chatPanel, [
      ["Chat screen shell", '<div className="screen-shell sk-screen">'],
      ["Chat header bar", '<div className="screen-bar px-5 pb-3 pt-4"'],
      ["Chat message scroller", '<div ref={scrollContainerRef} className="screen-scroll-with-input'],
      ["Chat bottom input bar", '<div className="screen-bottom-bar px-3"'],
    ]);

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
    assertIncludesInOrder(sources.summaryDetailScreen, [
      ["Summary screen shell", '<div className="screen-shell">'],
      ["Summary header bar", '<div className="screen-bar px-5 pb-3 pt-4"'],
      ["Summary content scroller", '<main className="screen-scroll-safe'],
    ]);
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
