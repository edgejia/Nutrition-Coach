import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
  get length() {
    return storage.size;
  },
  key: (index: number) => [...storage.keys()][index] ?? null,
} as Storage;

const { useStore } = await import("../../client/src/store.js");
const { getDashboardCells } = await import("../../client/src/components/Dashboard.js");
const { splitAdvice, getAdvicePresentation } = await import("../../client/src/components/CoachAdviceCard.js");
const { getUserMessagePresentation } = await import("../../client/src/components/MessageBubble.js");
const { getMealRowPresentation } = await import("../../client/src/components/MealTimeline.js");
const { getPersistedAssetPresentation, PERSISTED_ASSET_ERROR_LABEL } = await import("../../client/src/components/PersistedAssetImage.js");

describe("Editorial UI", () => {
  beforeEach(() => {
    storage.clear();
    useStore.setState({
      deviceId: "device-1",
      goal: "fat_loss",
      activeScreen: "home",
      dailyTargets: { calories: 1800, protein: 140, carbs: 180, fat: 60 },
      messages: [],
      dailySummary: {
        date: "2026-04-01",
        totalCalories: 920,
        totalProtein: 54,
        totalCarbs: 88,
        totalFat: 34,
        mealCount: 2,
      },
      coachAdvice: null,
      meals: [],
      pendingHomeChatDraft: null,
      showSettings: false,
      sending: false,
    });
  });

  it("tracks settings as an overlay flag instead of an active screen", () => {
    assert.equal(useStore.getState().showSettings, false);

    useStore.getState().setShowSettings(true);
    assert.equal(useStore.getState().showSettings, true);
    assert.equal(useStore.getState().activeScreen, "home");

    useStore.getState().clearDevice();
    assert.equal(useStore.getState().showSettings, false);
    assert.equal(useStore.getState().activeScreen, "onboarding");
  });

  it("derives four skeleton dashboard cells before the first summary arrives", () => {
    const cells = getDashboardCells(null, useStore.getState().dailyTargets);

    assert.equal(cells?.length, 4);
    assert.ok(cells?.every((cell) => cell.label.startsWith("skeleton-")));
  });

  it("renders Calories cell instead of Meals with Chinese labels", () => {
    const cells = getDashboardCells(
      { date: "2026-04-01", totalCalories: 920, totalProtein: 54, totalCarbs: 88, totalFat: 34, mealCount: 2 },
      { calories: 1800, protein: 140, carbs: 180, fat: 60 },
    );

    assert.equal(cells?.length, 4);
    const labels = cells!.map((c) => c.label);
    assert.deepEqual(labels, ["熱量", "蛋白質", "碳水", "脂肪"]);

    const calorieCell = cells![0];
    assert.equal(calorieCell.current, 920);
    assert.equal(calorieCell.target, 1800);
    assert.equal(calorieCell.unit, "kcal");
    assert.equal(calorieCell.barColor, "var(--orange)");
  });

  it("splits coach advice into headline and body at the first sentence break", () => {
    assert.deepEqual(splitAdvice("先補蛋白質。晚餐吃雞胸肉與優格。"), {
      headline: "先補蛋白質。",
      body: "晚餐吃雞胸肉與優格。",
    });
  });

  it("returns guided empty-state copy instead of an em dash when no meals exist", () => {
    const presentation = getAdvicePresentation(
      {
        date: "2026-04-01",
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        mealCount: 0,
      },
      useStore.getState().dailyTargets,
      null,
    );

    assert.deepEqual(presentation, {
      state: "empty",
      message: "先用對話記下第一餐。今天還沒有紀錄。到「對話」描述你吃了什麼。",
    });
  });

  it("returns split advice text and dynamic nutrition tags in Chinese", () => {
    const presentation = getAdvicePresentation(
      {
        date: "2026-04-01",
        totalCalories: 1200,
        totalProtein: 60,
        totalCarbs: 110,
        totalFat: 55,
        mealCount: 3,
      },
      useStore.getState().dailyTargets,
      "先補蛋白質。晚餐選高蛋白、低油脂的食物。",
    );

    assert.deepEqual(presentation, {
      state: "ready",
      headline: "先補蛋白質。",
      body: "晚餐選高蛋白、低油脂的食物。",
      tags: ["蛋白質差 80g", "脂肪接近上限", "晚餐還有空間"],
    });
  });

  it("simulates CTA click by setting pending draft and switching to chat", () => {
    useStore.getState().setActiveScreen("home");

    const ctaText = "推薦三個便利商店高蛋白選擇";
    useStore.getState().setPendingHomeChatDraft({
      id: "test-cta",
      text: ctaText,
      status: "staged",
    });
    useStore.getState().setActiveScreen("chat");

    const state = useStore.getState();
    assert.equal(state.activeScreen, "chat");
    assert.equal(state.pendingHomeChatDraft?.text, ctaText);
    assert.equal(state.pendingHomeChatDraft?.status, "staged");
  });

  it("guards task-oriented failed staged-send copy", async () => {
    const chatPanelSource = await readFile(
      fileURLToPath(new URL("../../client/src/components/ChatPanel.tsx", import.meta.url)),
      "utf8",
    );

    assert.match(chatPanelSource, /上一筆任務送出失敗。/);
    assert.match(chatPanelSource, /重試送出/);
    assert.match(chatPanelSource, /取消送出/);
    assert.doesNotMatch(chatPanelSource, /上一筆草稿送出失敗。|取消草稿/);
  });

  it("CHAT-02 D-10..D-15 failed banner cancel uses named local cleanup instead of direct draft clearing", async () => {
    const chatPanelSource = await readFile(
      fileURLToPath(new URL("../../client/src/components/ChatPanel.tsx", import.meta.url)),
      "utf8",
    );

    assert.match(chatPanelSource, /上一筆任務送出失敗。/);
    assert.match(chatPanelSource, /重試送出/);
    assert.match(chatPanelSource, /取消送出/);
    assert.match(
      chatPanelSource,
      /function cancelFailedPendingDraft\(draft: PendingHomeChatDraft\)/,
      "D-10/D-12 cancel must use a named local cleanup handler that can remove only the draft-linked artifact",
    );
    assert.match(chatPanelSource, /onClick=\{\(\) => cancelFailedPendingDraft\(pendingHomeChatDraft\)\}/);
    assert.doesNotMatch(
      chatPanelSource,
      /onClick=\{clearPendingHomeChatDraft\}/,
      "D-13/D-14 cancel must not be a generic draft clear or active-stream abort path",
    );
  });

  it("prefers persisted imageUrl when restoring image-only user chat messages", () => {
    const presentation = getUserMessagePresentation({
      id: "msg-image",
      role: "user",
      content: "(圖片)",
      imageAssetId: "asset-1",
      imageUrl: "/api/assets/asset-1",
      createdAt: "2026-04-19T00:00:00.000Z",
    });

    assert.equal(presentation.imageSrc, "/api/assets/asset-1");
    assert.equal(presentation.text, "");
    assert.equal(presentation.isImageOnly, true);
  });

  it("derives meal-row thumbnail and macro presentation for persisted meal images", () => {
    const presentation = getMealRowPresentation({
      id: "meal-1",
      foodName: "雞腿便當",
      calories: 620,
      protein: 34.4,
      carbs: 55.2,
      fat: 19.1,
      itemCount: 1,
      imageAssetId: "asset-1",
      imageUrl: "/api/assets/asset-1?deviceId=device-1",
      loggedAt: "2026-04-19T12:30:00.000Z",
    });

    assert.equal(presentation.thumbnailSrc, "/api/assets/asset-1?deviceId=device-1");
    assert.equal(presentation.macroSummary, "620 kcal · P34 · C55 · F19");
  });

  it("switches persisted assets to a stable fallback label after load failure", () => {
    const initial = getPersistedAssetPresentation("/api/assets/asset-1");
    const failed = getPersistedAssetPresentation("/api/assets/asset-1", true);

    assert.equal(initial.shouldRenderImage, true);
    assert.equal(initial.shouldRenderFallback, false);
    assert.equal(failed.shouldRenderImage, false);
    assert.equal(failed.shouldRenderFallback, true);
    assert.equal(failed.fallbackLabel, PERSISTED_ASSET_ERROR_LABEL);
  });
});
