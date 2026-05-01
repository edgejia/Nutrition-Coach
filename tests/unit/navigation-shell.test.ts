import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

function countPrimaryScrollHelpers(source: string) {
  return countMatches(source, /\bscreen-scroll(?:-with-input|-safe)?\b/g);
}

const hiddenDialogueLabelPattern = new RegExp(`label: "${"對話"}"`);

const sources = {
  types: await readSource("../../client/src/types.ts"),
  store: await readSource("../../client/src/store.ts"),
  mainLayout: await readSource("../../client/src/components/MainLayout.tsx"),
  mealEditScreen: await readSource("../../client/src/components/MealEditScreen.tsx"),
  bottomTabBar: await readSource("../../client/src/components/BottomTabBar.tsx"),
  homeScreen: await readSource("../../client/src/components/HomeScreen.tsx"),
  chatPanel: await readSource("../../client/src/components/ChatPanel.tsx"),
  historyScreen: await readSource("../../client/src/components/HistoryScreen.tsx"),
};

describe("navigation shell source contract", () => {
  it("narrows primary tabs and removes summary from active screens", () => {
    assert.match(sources.types, /PrimaryTab = "home" \| "chat" \| "history"/);
    assert.doesNotMatch(sources.types, /"summary"/);
  });

  it("renders exactly three bottom tabs and hides under secondary screens", () => {
    assert.match(sources.bottomTabBar, /SportIcons.js/);
    assert.match(sources.bottomTabBar, /SportHomeIcon/);
    assert.match(sources.bottomTabBar, /SportChatIcon/);
    assert.match(sources.bottomTabBar, /SportHistoryIcon/);
    assert.match(sources.bottomTabBar, /ariaLabel: "首頁"/);
    assert.match(sources.bottomTabBar, /ariaLabel: "記錄餐點"/);
    assert.match(sources.bottomTabBar, /ariaLabel: "歷史"/);
    assert.match(sources.bottomTabBar, /aria-label="主要導覽"/);
    assert.match(sources.bottomTabBar, /aria-label=\{tab\.ariaLabel\}/);
    assert.match(sources.bottomTabBar, /aria-current=\{isActive \? "page" : undefined\}/);
    assert.match(sources.bottomTabBar, /setActiveScreen\("chat"\)/);
    assert.match(sources.bottomTabBar, /setActiveScreen\("chat"\)/, 'expected setActiveScreen("chat") route');
    assert.match(sources.bottomTabBar, /secondaryScreen[\s\S]+return null/);
    assert.doesNotMatch(sources.bottomTabBar, /label: "首頁"/);
    assert.doesNotMatch(sources.bottomTabBar, hiddenDialogueLabelPattern);
    assert.doesNotMatch(sources.bottomTabBar, /label: "歷史"/);
    assert.doesNotMatch(sources.bottomTabBar, />HOME</);
    assert.doesNotMatch(sources.bottomTabBar, />LOG</);
    assert.doesNotMatch(sources.bottomTabBar, />TREND</);
    assert.doesNotMatch(sources.bottomTabBar, /<span>\{tab\.label\}<\/span>/);
    assert.doesNotMatch(sources.bottomTabBar, /openSecondaryScreen\(\{ screen: "mealEdit"/);
    assert.doesNotMatch(sources.bottomTabBar, /manual/i);
    assert.doesNotMatch(sources.bottomTabBar, /modal/i);
  });

  it("stores the secondary stack state in Zustand", () => {
    assert.match(sources.store, /secondaryScreen/);
    assert.match(sources.store, /openSecondaryScreen/);
    assert.match(sources.store, /closeSecondaryScreen/);
  });

  it("wires the app canvas, primary slots, and secondary placeholders", () => {
    assert.match(sources.mainLayout, /sp-app-canvas/);
    assert.match(sources.mainLayout, /BottomTabBar/);
    assert.match(sources.mainLayout, /secondaryScreen/);
    assert.match(sources.mainLayout, /HistoryScreen/);
    assert.match(sources.mainLayout, /HistoryDayDetailScreen/);
    assert.match(sources.mainLayout, /MealEditScreen/);
    assert.doesNotMatch(sources.mainLayout, /IOSDevice/);
    assert.doesNotMatch(sources.mainLayout, /Day Detail shell/);
    assert.doesNotMatch(sources.mainLayout, /Meal Edit shell/);
    assert.doesNotMatch(sources.mainLayout, /BrowserRouter/);
    assert.doesNotMatch(sources.mainLayout, /activeScreen === "summary"/);
  });

  it("hides BottomTabBar only when Chat is active", () => {
    assert.match(sources.mainLayout, /activeScreen === "home" && <HomeScreen \/>/);
    assert.match(sources.mainLayout, /activeScreen === "chat" && <ChatPanel \/>/);
    assert.match(sources.mainLayout, /activeScreen === "history" && <HistoryScreen \/>/);
    assert.match(sources.mainLayout, /activeScreen !== "chat" && <BottomTabBar \/>/);
    assert.doesNotMatch(sources.mainLayout, /activeScreen === "chat" && <BottomTabBar \/>/);
  });

  it("keeps exactly one primary scroller helper per primary screen", () => {
    for (const [label, source] of [
      ["HomeScreen", sources.homeScreen],
      ["ChatPanel", sources.chatPanel],
      ["HistoryScreen", sources.historyScreen],
    ] as const) {
      assert.equal(
        countPrimaryScrollHelpers(source),
        1,
        `${label} should contain exactly one primary scroller helper`,
      );
    }
  });
});
