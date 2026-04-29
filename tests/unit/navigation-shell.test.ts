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

const sources = {
  types: await readSource("../../client/src/types.ts"),
  store: await readSource("../../client/src/store.ts"),
  mainLayout: await readSource("../../client/src/components/MainLayout.tsx"),
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
    assert.equal(countMatches(sources.bottomTabBar, /label: "首頁"/g), 1);
    assert.equal(countMatches(sources.bottomTabBar, /label: "對話"/g), 1);
    assert.equal(countMatches(sources.bottomTabBar, /label: "歷史"/g), 1);
    assert.match(sources.bottomTabBar, /aria-label="主要導覽"/);
    assert.match(sources.bottomTabBar, /secondaryScreen[\s\S]+return null/);
  });

  it("stores the secondary stack state in Zustand", () => {
    assert.match(sources.store, /secondaryScreen/);
    assert.match(sources.store, /openSecondaryScreen/);
    assert.match(sources.store, /closeSecondaryScreen/);
  });

  it("wires the app canvas, primary slots, and secondary placeholders", () => {
    assert.match(sources.mainLayout, /sk-app-canvas/);
    assert.match(sources.mainLayout, /BottomTabBar/);
    assert.match(sources.mainLayout, /secondaryScreen/);
    assert.match(sources.mainLayout, /HistoryScreen/);
    assert.match(sources.mainLayout, /HistoryDayDetailScreen/);
    assert.doesNotMatch(sources.mainLayout, /Day Detail shell/);
    assert.match(sources.mainLayout, /Meal Edit shell/);
    assert.doesNotMatch(sources.mainLayout, /BrowserRouter/);
    assert.doesNotMatch(sources.mainLayout, /activeScreen === "summary"/);
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
