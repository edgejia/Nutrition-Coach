import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const relatedScrollTests = [
  "chat-scroll-contract.test.ts",
  "chat-scroll-live-updates.test.ts",
];
const phase81StarterLabels = [
  "我想記錄今天吃的東西",
  "示範怎麼描述一餐",
  "我不確定份量怎麼說",
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
  chatInput: await readSource("../../client/src/components/ChatInput.tsx"),
  sportIcons: await readSource("../../client/src/components/SportIcons.tsx"),
  summaryDetailScreen: await readSource("../../client/src/components/SummaryDetailScreen.tsx"),
  phase45MobileEvidence: await readSource("../../scripts/phase45-mobile-evidence.mjs"),
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

function functionBody(source: string, functionName: string) {
  const startToken = `function ${functionName}`;
  const startIndex = source.indexOf(startToken);
  assert.notEqual(startIndex, -1, `${functionName} should exist`);
  const bodyStart = source.indexOf("{", startIndex);
  assert.notEqual(bodyStart, -1, `${functionName} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(bodyStart + 1, index);
    }
  }

  assert.fail(`${functionName} body should be closed`);
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
    assert.match(cssBlock("html"), /height:\s*100%/);
    assert.match(cssBlock("html"), /overflow:\s*hidden/);
    assert.match(cssBlock("body"), /position:\s*fixed/);
    assert.match(cssBlock("body"), /inset:\s*0/);
    assert.match(cssBlock("#root"), /position:\s*fixed/);
    assert.match(cssBlock("#root"), /overflow:\s*hidden/);

    assert.match(cssBlock(".app-viewport"), /position:\s*fixed/);
    assert.match(cssBlock(".app-viewport"), /top:\s*var\(--app-visual-viewport-top,\s*0px\)/);
    assert.match(cssBlock(".app-viewport"), /right:\s*0/);
    assert.match(cssBlock(".app-viewport"), /left:\s*0/);
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
    assert.match(cssBlock(".screen-shell"), /background:\s*var\(--sp-bg\)/);

    assert.match(cssBlock(".screen-bar"), /flex-shrink:\s*0/);
    assert.match(cssBlock(".screen-bottom-bar"), /flex-shrink:\s*0/);
    assert.match(cssBlock(".screen-bottom-bar"), /position:\s*relative/);
    assert.match(cssBlock(".screen-bottom-bar"), /z-index:\s*10/);
    assert.match(cssBlock(".screen-bottom-bar"), /padding-bottom:\s*max\(0\.75rem,\s*calc\(env\(safe-area-inset-bottom\) \+ 0\.75rem\)\)/);
    assert.doesNotMatch(cssBlock(".screen-bottom-bar"), /transform:/);
    assert.doesNotMatch(cssBlock(".screen-bottom-bar"), /--app-bottom-occlusion/);

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
    assert.match(sources.mainLayout, /\bsp-app-canvas\b/);
    assert.match(sources.mainLayout, /\bvisualViewport\b/);
    assert.match(sources.mainLayout, /--app-visual-viewport-top/);
    assert.match(sources.mainLayout, /--app-visual-viewport-height/);
    assert.match(sources.mainLayout, /--app-bottom-occlusion/);
    assert.doesNotMatch(sources.mainLayout, /IOSDevice/);
    assert.doesNotMatch(sources.mainLayout, /document\.body\.style\.overflow/);
    assert.match(sources.mainLayout, /sseSummaryCoordinator\.runInitialMealsLoad\(\)/);
    assert.match(sources.mainLayout, /sseSummaryCoordinator\.runInitialMealsLoad\(\{ refreshReason: "day_rollover" \}\)/);
  });

  it("does not introduce sport demo device-frame chrome", () => {
    assert.doesNotMatch(sources.mainLayout, /IOSDevice/);
    assert.doesNotMatch(sources.mainLayout, /sp-device|sp-notch|sp-statusbar/);
    assert.doesNotMatch(sources.appCss, /\.sp-device\b/);
    assert.doesNotMatch(sources.appCss, /\.sp-notch\b/);
    assert.doesNotMatch(sources.appCss, /\.sp-statusbar\b/);
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

  it("keeps Chat scroll ownership inside the sport shell", () => {
    assert.match(sources.chatPanel, /\bscreen-shell\b/);
    assert.match(sources.chatPanel, /\bsp-chat-shell\b/);
    assert.match(sources.chatPanel, /\bscreen-bar\b/);
    assert.match(sources.chatPanel, /\bsp-chat-header\b/);
    assert.match(sources.chatPanel, /\bsp-chat-scroll\b/);
    assert.match(sources.chatPanel, /\bsp-chat-composer-bar\b/);
    assert.doesNotMatch(sources.chatPanel, /today log/);
    assert.doesNotMatch(sources.chatPanel, /sp-chat-today-log/);
    assert.match(sources.chatPanel, /formatMealCountSummary/);
    assert.match(sources.chatPanel, /formatMealCountCompact/);
    assert.match(sources.chatPanel, /今日已紀錄 \$\{mealCount\} 餐/);
    assert.match(sources.chatPanel, /\$\{mealCount\} 餐/);
    assert.match(sources.chatPanel, /\{consumedCalories\}\/\{targetCalories\} kcal/);
    assert.match(sources.chatPanel, /\{todayMealCountCompact\}/);
    assert.match(sources.chatPanel, /sp-chat-meta/);
    assert.match(sources.chatPanel, /sp-chat-separator/);
    assert.match(sources.chatPanel, /getMeals\(\{ refreshReason: "meal_mutation" \}\)/);
    assert.match(sources.chatPanel, /\bscreen-bottom-bar\b/);
    assert.match(sources.chatPanel, /\bscreen-scroll-with-input\b/);
    assert.match(sources.chatPanel, /\bscrollContainerRef\b/);
    assert.doesNotMatch(sources.chatPanel, /DashboardMiniBar/);
    assert.equal(
      countMatches(sources.chatPanel, /<div ref=\{scrollContainerRef\} className=/g),
      1,
      "ChatPanel should keep exactly one scrollContainerRef scroller",
    );

    const scrollContainerMatch = /<div ref=\{scrollContainerRef\} className="([^"]+)"/.exec(
      sources.chatPanel,
    );
    assert.ok(scrollContainerMatch, "ChatPanel should keep scrollContainerRef on a div");
    const scrollContainerClassName = scrollContainerMatch[1] ?? "";
    assert.match(scrollContainerClassName, /\bscreen-scroll-with-input\b/);
    assert.match(scrollContainerClassName, /\bsp-chat-scroll\b/);
    assertIncludesInOrder(sources.chatPanel, [
      ["Chat screen shell", '<div className="screen-shell sp-chat-shell">'],
      ["Chat header bar", '<header className="screen-bar sp-chat-header"'],
      ["Chat message scroller", '<div ref={scrollContainerRef} className="screen-scroll-with-input sp-chat-scroll">'],
      ["Chat bottom input bar", '<div className="screen-bottom-bar sp-chat-composer-bar">'],
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

  it("keeps the sport composer wired to mobile-safe send and upload contracts", () => {
    const chatInput = sources.chatInput;

    assert.match(chatInput, /SportCameraIcon/);
    assert.match(chatInput, /SportSendIcon/);
    assert.match(chatInput, /SportStopIcon/);
    assert.match(chatInput, /SportCloseIcon/);
    assert.match(chatInput, /from "\.\/SportIcons\.js"/);
    assert.ok(chatInput.includes('accept="image/jpeg,image/png,image/webp"'));
    assert.ok(chatInput.includes("onBeforeSend?.({"));
    assert.match(chatInput, /onSend\(trimmedText, image \?\? undefined\)/);
    assert.match(chatInput, /fileRef\.current\.value = ""/);
    assert.match(chatInput, /disabled \|\| !canSend/);
    assert.match(chatInput, /metaKey \|\| e\.ctrlKey/);
    assert.match(chatInput, /aria-label="附加照片"/);
    assert.match(chatInput, /aria-label="移除照片"/);
    assert.match(chatInput, /aria-label="送出"/);
    assert.match(chatInput, /aria-label="停止生成"/);
    assert.match(chatInput, /placeholder="描述你吃了什麼…"/);

    for (const className of [
      "sp-chat-input",
      "sp-chat-camera",
      "sp-chat-input-well",
      "sp-chat-textarea",
      "sp-chat-image-chip",
      "sp-chat-send",
    ]) {
      assert.match(chatInput, new RegExp(className));
    }

    assert.match(chatInput, /data-ready=\{canSend\}/);
    assert.match(chatInput, /onClick=\{submitMessage\}/);
    assert.match(chatInput, /data-streaming="true"/);
    assert.match(chatInput, /data-stopping=\{stopping\}/);
    assert.doesNotMatch(chatInput, /from "\.\/SketchIcons\.js"/);
    assert.doesNotMatch(chatInput, /<CameraIcon\b/);
    assert.doesNotMatch(chatInput, /<SendIcon\b/);
  });

  it("locks ChatInput Enter, Shift+Enter, Cmd/Ctrl+Enter, and IME branch order", () => {
    const chatInput = sources.chatInput;
    const handler = functionBody(chatInput, "handleKeyDown");

    assert.match(chatInput, /const isComposingRef = useRef\(false\)/);
    assert.match(chatInput, /onCompositionStart=\{\(\) => \{\s*isComposingRef\.current = true;\s*\}\}/);
    assert.match(chatInput, /onCompositionEnd=\{\(\) => \{\s*isComposingRef\.current = false;\s*\}\}/);
    assertIncludesInOrder(handler, [
      ["native IME guard", "e.nativeEvent.isComposing"],
      ["internal IME guard", "isComposingRef.current"],
      ["non-Enter guard", 'e.key !== "Enter"'],
      ["Shift+Enter fallthrough", "e.shiftKey"],
      ["plain Enter preventDefault", "e.preventDefault()"],
      ["plain Enter submit", "submitMessage()"],
      ["Cmd/Ctrl+Enter branch", "e.metaKey || e.ctrlKey"],
    ]);
    assert.doesNotMatch(handler, /\bdisabled\b/, "disabled should stay in submitMessage, not globally swallow keydown");
  });

  it("keeps image-only send and disabled send guards inside submitMessage", () => {
    const chatInput = sources.chatInput;
    const submitMessage = functionBody(chatInput, "submitMessage");

    assert.match(chatInput, /const canSend = Boolean\(text\.trim\(\) \|\| image\)/);
    assert.match(submitMessage, /if \(disabled \|\| !canSend\) return/);
    assert.match(submitMessage, /const trimmedText = text\.trim\(\)/);
    assert.match(submitMessage, /hasImage: image !== null/);
    assert.match(submitMessage, /hasText: trimmedText\.length > 0/);
    assert.match(submitMessage, /onSend\(trimmedText, image \?\? undefined\)/);
  });

  it("keeps Chat textarea at mobile-safe font size and four-line growth cap", () => {
    const textareaBlock = cssBlock(".sp-chat-textarea");

    assert.match(textareaBlock, /font-size:\s*16px/);
    assert.match(textareaBlock, /line-height:\s*1\.5/);
    assert.match(textareaBlock, /max-height:\s*96px/);
    assert.match(textareaBlock, /overflow-y:\s*auto/);
    assert.match(textareaBlock, /resize:\s*none/);
  });

  it("keeps proposal rows and action labels mobile wrapping safe", () => {
    const rowBlock = cssBlock(".sp-proposal-row");
    const rowValueBlock = cssBlock(".sp-proposal-row span:last-child");
    const actionBlock = cssBlock(".sp-proposal-action");

    assert.match(rowBlock, /grid-template-columns:\s*minmax\(0,\s*88px\) minmax\(0,\s*1fr\)/);
    assert.match(rowBlock, /min-width:\s*0/);
    assert.match(rowBlock, /overflow-wrap:\s*anywhere/);
    assert.match(rowBlock, /word-break:\s*break-word/);

    assert.match(sources.appCss, /\.sp-proposal-row span:first-child\s*\{[^}]*min-width:\s*0/s);
    assert.match(sources.appCss, /\.sp-proposal-row span:first-child\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    assert.match(sources.appCss, /\.sp-proposal-row span:first-child\s*\{[^}]*word-break:\s*break-word/s);

    assert.match(rowValueBlock, /min-width:\s*0/);
    assert.match(rowValueBlock, /flex-wrap:\s*wrap/);
    assert.match(rowValueBlock, /overflow-wrap:\s*anywhere/);
    assert.match(rowValueBlock, /word-break:\s*break-word/);
    assert.match(sources.appCss, /\.sp-proposal-row i,\s*\.sp-proposal-row b,\s*\.sp-proposal-row strong\s*\{[^}]*overflow-wrap:\s*anywhere/s);

    assert.match(actionBlock, /min-height:\s*44px/);
    assert.match(actionBlock, /min-width:\s*0/);
    assert.match(actionBlock, /white-space:\s*normal/);
    assert.match(actionBlock, /overflow-wrap:\s*anywhere/);

    assert.match(
      sources.appCss,
      /@media \(max-width:\s*360px\)\s*\{[\s\S]*?\.sp-proposal-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    assert.match(
      sources.appCss,
      /@media \(max-width:\s*360px\)\s*\{[\s\S]*?\.sp-proposal-row span:last-child\s*\{[\s\S]*?justify-content:\s*flex-start/,
    );
  });

  it("keeps Chat composer and Meal Edit controls reserved above bottom occlusion without moving the bottom bar twice", () => {
    assert.match(cssBlock(".sp-chat-scroll"), /var\(--app-bottom-occlusion,\s*0px\)/);
    assert.doesNotMatch(cssBlock(".screen-bottom-bar"), /var\(--app-bottom-occlusion,\s*0px\)/);
    assert.match(sources.chatPanel, /className="screen-bottom-bar sp-chat-composer-bar"/);

    assert.match(cssBlock(".sp-meal-edit-scroll"), /var\(--app-bottom-occlusion,\s*0px\)/);
    assert.match(cssBlock(".sp-meal-edit-footer"), /var\(--app-bottom-occlusion,\s*0px\)/);
    assert.match(cssBlock(".sp-meal-edit-footer button"), /min-width:\s*0/);
    assert.match(cssBlock(".sp-meal-edit-field input"), /min-width:\s*0/);
  });

  it("MOB-01 reserves single and grouped Meal Edit scrollers above the fixed footer", () => {
    const singleScroll = cssBlock(".sp-meal-edit-scroll");
    const groupedScroll = cssBlock(".sp-meal-edit-grouped-scroll");
    const footer = cssBlock(".sp-meal-edit-footer");

    assert.match(singleScroll, /calc\(128px \+ var\(--app-bottom-occlusion,\s*0px\) \+ env\(safe-area-inset-bottom\)\)/);
    assert.match(
      groupedScroll,
      /calc\(128px \+ var\(--app-bottom-occlusion,\s*0px\) \+ env\(safe-area-inset-bottom\)\)/,
      "MOB-01 grouped Meal Edit must keep the same bottom reserve as the fixed-footer single editor",
    );
    assert.match(footer, /position:\s*absolute/);
    assert.match(footer, /bottom:\s*0/);
    assert.match(footer, /var\(--app-bottom-occlusion,\s*0px\)/);
  });

  it("MOB-04 renders Chat starter only for a true-empty chat and keeps failed draft precedence", () => {
    for (const label of phase81StarterLabels) {
      assert.match(sources.chatPanel, new RegExp(label), `MOB-04 approved starter chip missing: ${label}`);
    }

    assert.match(
      sources.chatPanel,
      /messages\.length === 0/,
      "MOB-04 starter must require no persisted messages",
    );
    assert.match(
      sources.chatPanel,
      /historyLoaded && messages\.length === 0/,
      "MOB-04 starter must wait for chat history hydration before treating chat as empty",
    );
    assert.match(
      sources.chatPanel,
      /provisionalBubble === null/,
      "MOB-04 starter must hide when a provisional bubble exists",
    );
    assert.match(
      sources.chatPanel,
      /pendingHomeChatDraft === null/,
      "MOB-04 starter must hide when a Home draft is staged or sending",
    );
    assert.match(
      sources.chatPanel,
      /pendingHomeChatDraft\?\.status === "failed"[\s\S]*上一筆任務送出失敗。[\s\S]*sp-chat-starter/s,
      "MOB-04 failed draft banner should take precedence before any starter block",
    );
    assert.match(sources.chatPanel, /handleSend\(/, "MOB-04 starter chips must reuse the existing handleSend path");
    assert.match(
      sources.chatPanel,
      /async function handleSend[\s\S]*const state = useStore\.getState\(\);[\s\S]*if \(state\.sending\) return;/,
      "MOB-04 starter chips and composer sends must share an in-flight send guard",
    );
    assert.match(
      functionBody(sources.chatPanel, "handleStarterPromptClick"),
      /if \(useStore\.getState\(\)\.sending\) return;/,
      "MOB-04 starter chip taps must fail closed during an active send before React disables the buttons",
    );
    assert.match(
      functionBody(sources.chatPanel, "sendPendingDraft"),
      /if \(useStore\.getState\(\)\.sending\) return;[\s\S]*setPendingHomeChatDraft\(\{ \.\.\.draftWithoutFailedArtifact, status: "sending" \}\)/,
      "MOB-04 failed draft retry must check active sending before mutating retry state",
    );
    assert.match(
      sources.chatPanel,
      /onClick=\{\(\) => sendPendingDraft\(pendingHomeChatDraft\)\}[\s\S]*disabled=\{isChatLocked\}/,
      "MOB-04 failed draft retry button must be disabled while Chat is locked",
    );
    assert.match(
      sources.chatPanel,
      /setHistoryLoaded\(false\);[\s\S]*loadHistory\(\)[\s\S]*setHistoryLoaded\(true\);/s,
      "MOB-04 starter must stay hidden until loadHistory succeeds",
    );
    assert.doesNotMatch(sources.chatPanel, /stageHomeTaskOptionPrompt|recordHomeCtaOptionSent/);
  });

  it("MOB-04 keeps Chat starter copy compact, approved, and separate from the composer", () => {
    const starterBlock = cssBlock(".sp-chat-starter");

    assert.match(starterBlock, /display:\s*grid/);
    assert.match(starterBlock, /gap:\s*8px/);
    assert.match(starterBlock, /margin-bottom:\s*16px/);
    assert.doesNotMatch(starterBlock, /min-height:\s*100vh|height:\s*100%|font-size:\s*28px/);

    assert.match(sources.chatPanel, /從第一餐開始/, "MOB-04 starter heading should match the UI spec");
    assert.match(sources.chatPanel, /也可以點下方相機附加照片。/, "MOB-04 starter body should mention photo upload without making it a chip");
    assert.doesNotMatch(sources.chatPanel, /雞胸|飯糰|沙拉|500\s*kcal|修正上一筆/);
  });

  it("keeps stop generation in the send-control slot instead of a separate composer button", () => {
    assert.doesNotMatch(sources.chatPanel, /className="sp-chat-stop"/);
    assert.doesNotMatch(sources.appCss, /\.sp-chat-stop\s*\{/);
    assert.match(sources.chatPanel, /onStop=\{handleStopStreaming\}/);
    assert.match(sources.chatPanel, /streaming=\{sending\}/);
    assert.match(sources.chatPanel, /stopDisabled=\{stopping \|\| !activeTurnId\}/);
    assert.match(sources.chatInput, /SportStopIcon/);
    assert.match(sources.chatInput, /className="sp-chat-send sp-chat-send-stop"/);
    assert.match(sources.chatInput, /<SportStopIcon size=\{20\} stroke=\{2\} \/>/);
    assert.match(sources.sportIcons, /<rect height="18" rx="3" width="18" x="3" y="3" fill="currentColor" stroke="none" \/>/);
    assert.match(cssBlock(".sp-chat-input-well"), /grid-template-columns:\s*minmax\(0,\s*1fr\) 44px/);
    assert.match(cssBlock(".sp-chat-send-stop"), /width:\s*44px/);
    assert.match(cssBlock(".sp-chat-send-stop"), /height:\s*44px/);
    assert.match(cssBlock(".sp-chat-send-stop"), /background:\s*#f7f8f2/);
    assert.match(cssBlock(".sp-chat-send-stop"), /color:\s*#050607/);
  });

  it("keeps Phase 45 Chat-focused evidence on the Chat surface", () => {
    const mockApi = functionBody(sources.phase45MobileEvidence, "mockApiScript");
    const messagesFixture = mockApi.indexOf("const messages = [");
    const historyMock = mockApi.indexOf('if (url.pathname === "/api/chat/history") return json({ messages });');

    assert.notEqual(messagesFixture, -1, "Phase 45 evidence script should define a local messages fixture");
    assert.notEqual(historyMock, -1, "Phase 45 evidence script should mock Chat history");
    assert.ok(messagesFixture < historyMock, "Chat history mock should not reference an out-of-scope messages fixture");
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
