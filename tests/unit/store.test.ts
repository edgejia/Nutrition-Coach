import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { ProposalCardMetadata } from "../../client/src/types.js";
import {
  renderProposalExpiredCopy,
  renderProposalSupersededCopy,
} from "../../server/orchestrator/mutation-receipts.js";

// Minimal localStorage shim for Node.js (must precede store import)
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
} as Storage;

const { useStore } = await import("../../client/src/store.js");
const { normalizeLoggedMealReceipt } = await import("../../client/src/api.js");
const { formatLocalDate } = await import("../../client/src/lib/time.js");
const { buildReceiptMealEditPayload } = await import("../../client/src/meal-edit-payload.js");
const storeModuleUrl = new URL("../../client/src/store.ts", import.meta.url);
const originalFetch = globalThis.fetch;
const GOAL_PROPOSAL_EXPIRED_COPY = renderProposalExpiredCopy("goal");
const GOAL_PROPOSAL_SUPERSEDED_COPY = renderProposalSupersededCopy({
  proposalKind: "goal",
  supersededByKind: "goal",
});
const GOAL_PROPOSAL_STALE_COPY = "這個目標提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。";

async function loadFreshStore(suffix: string) {
  return import(`${storeModuleUrl.href}?${suffix}`);
}

const sampleMeals = [
  {
    id: "meal-1",
    mealRevisionId: "meal-1:r1",
    foodName: "雞胸肉便當",
    calories: 520,
    protein: 42,
    carbs: 48,
    fat: 18,
    itemCount: 1,
    loggedAt: "2026-04-01T04:30:00.000Z",
  },
  {
    id: "meal-2",
    mealRevisionId: "meal-2:r1",
    foodName: "優格",
    calories: 180,
    protein: 12,
    carbs: 20,
    fat: 6,
    itemCount: 1,
    loggedAt: "2026-04-01T08:00:00.000Z",
  },
];

const dailyTargets = { calories: 1500, protein: 120, carbs: 150, fat: 50 };

function initialHomeAnimation() {
  return {
    baseline: null,
    unseenTodayMutation: false,
    pendingIntent: null,
    homeVisibleMutationBaseline: null,
  };
}

function goalProposalCard(
  proposalId: string,
  calories: number,
  overrides: Partial<ProposalCardMetadata> = {},
): ProposalCardMetadata {
  return {
    proposalId,
    proposalKind: "goal",
    proposalLane: "goal",
    status: "active",
    isActionable: true,
    title: "每日目標提案",
    details: {
      rows: [
        { label: "卡路里", after: `${calories} kcal` },
        { label: "蛋白質", after: "120 g" },
        { label: "碳水", after: "150 g" },
        { label: "脂肪", after: "45 g" },
      ],
    },
    actions: {
      approveLabel: "套用目標",
      editLabel: "調整目標",
      rejectLabel: "取消提案",
    },
    expiresAt: "2026-06-14T08:30:00.000Z",
    lapseCopy: null,
    supersededByKind: null,
    ...overrides,
  };
}

describe("AppStore", () => {
  beforeEach(() => {
    storage.clear();
    useStore.setState({
      deviceId: null,
      goal: null,
      activeScreen: "onboarding",
      guestSessionStatus: "ready",
      guestSessionRecoveryAttempted: false,
      dailyTargets: null,
      messages: [],
      dailySummary: null,
      coachAdvice: null,
      meals: [],
      pendingHomeChatDraft: null,
      lastMealMutation: null,
      homeAnimation: initialHomeAnimation(),
      showSettings: false,
      secondaryScreen: null,
      sending: false,
      provisionalBubble: null,
    });
    globalThis.fetch = originalFetch;
    // Reset rollover refresh handler to avoid cross-test leakage (D-19)
    useStore.getState().setRolloverRefreshHandler(null);
  });

  it("defaults activeScreen to onboarding without a stored device", async () => {
    const freshStore = await loadFreshStore(`store-no-device-${Date.now()}`);
    assert.equal(freshStore.useStore.getState().activeScreen, "onboarding");
    assert.equal(freshStore.useStore.getState().guestSessionStatus, "ready");
  });

  it("defaults activeScreen to home when a device is already stored", async () => {
    storage.set("deviceId", "existing-device");
    storage.set("goal", "fat_loss");
    storage.set("dailyTargets", JSON.stringify({ calories: 1500, protein: 120, carbs: 150, fat: 50 }));

    const freshStore = await loadFreshStore(`store-with-device-${Date.now()}`);
    assert.equal(freshStore.useStore.getState().activeScreen, "home");
    assert.equal(freshStore.useStore.getState().guestSessionStatus, "unknown");
  });

  it("setDevice persists deviceId, goal, and targets to localStorage and enters home", () => {
    useStore.getState().setDevice("d-1", "fat_loss", { calories: 1500, protein: 120, carbs: 150, fat: 50 });
    assert.equal(useStore.getState().deviceId, "d-1");
    assert.equal(useStore.getState().activeScreen, "home");
    assert.equal(useStore.getState().guestSessionStatus, "ready");
    assert.equal(storage.get("deviceId"), "d-1");
    assert.equal(storage.get("goal"), "fat_loss");
    assert.ok(storage.get("dailyTargets"));
  });

  it("tracks guest-session bootstrap and recovery state without clearing device identity", () => {
    useStore.getState().setDevice("d-1", "fat_loss", { calories: 1500, protein: 120, carbs: 150, fat: 50 });
    useStore.getState().setGuestSessionStatus("establishing");
    useStore.getState().markGuestSessionRecoveryAttempted();
    useStore.getState().setGuestSessionStatus("recovery_required");

    assert.equal(useStore.getState().deviceId, "d-1");
    assert.equal(useStore.getState().guestSessionStatus, "recovery_required");
    assert.equal(useStore.getState().guestSessionRecoveryAttempted, true);

    useStore.getState().resetGuestSessionRecovery();
    assert.equal(useStore.getState().guestSessionRecoveryAttempted, false);
  });

  it("clears stale device identity and enters recovery when bootstrap returns 401", async () => {
    useStore.getState().setDevice("stale-device", "fat_loss", {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });

    let requestBody: unknown;
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "/api/device/session");
      assert.equal(init?.method, "POST");
      requestBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ error: "No guest session available" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    };

    const bootstrapped = await useStore.getState().bootstrapGuestSession();

    assert.equal(bootstrapped, false);
    assert.deepEqual(requestBody, { legacyDeviceId: "stale-device" });
    assert.equal(storage.get("deviceId"), undefined);
    assert.equal(localStorage.getItem("deviceId"), null);
    assert.equal(storage.get("goal"), "fat_loss");
    assert.equal(storage.get("dailyTargets"), JSON.stringify({ calories: 1500, protein: 120, carbs: 150, fat: 50 }));
    assert.equal(useStore.getState().deviceId, null);
    assert.equal(useStore.getState().guestSessionStatus, "recovery_required");
  });

  it("clearDevice removes all localStorage entries and resets dashboard-first state", () => {
    useStore.getState().setDevice("d-1", "fat_loss", { calories: 1500, protein: 120, carbs: 150, fat: 50 });
    useStore.getState().setActiveScreen("chat");
    useStore.getState().setCoachAdvice("今天攝取均衡，繼續保持！");
    useStore.getState().setMeals(sampleMeals);
    useStore.getState().recordMealMutation(formatLocalDate(new Date()));
    useStore.getState().setPendingHomeChatDraft({ id: "draft-1", text: "午餐吃了沙拉", status: "failed" });
    useStore.getState().clearDevice();

    assert.equal(useStore.getState().deviceId, null);
    assert.equal(useStore.getState().activeScreen, "onboarding");
    assert.equal(useStore.getState().guestSessionStatus, "ready");
    assert.equal(useStore.getState().guestSessionRecoveryAttempted, false);
    assert.equal(useStore.getState().coachAdvice, null);
    assert.deepEqual(useStore.getState().meals, []);
    assert.deepEqual(useStore.getState().homeAnimation, initialHomeAnimation());
    assert.equal(useStore.getState().pendingHomeChatDraft, null);
    assert.equal(storage.has("deviceId"), false);
  });

  it("addMessage appends to messages list", () => {
    useStore.getState().addMessage({ id: "1", role: "user", content: "hello", createdAt: "2026-01-01T00:00:00Z" });
    useStore.getState().addMessage({ id: "2", role: "assistant", content: "hi", createdAt: "2026-01-01T00:00:01Z" });
    assert.equal(useStore.getState().messages.length, 2);
    assert.equal(useStore.getState().messages[0].content, "hello");
  });

  it("setMessages replaces entire messages list", () => {
    useStore.getState().addMessage({ id: "1", role: "user", content: "old", createdAt: "2026-01-01T00:00:00Z" });
    useStore.getState().setMessages([{ id: "2", role: "assistant", content: "new", createdAt: "2026-01-01T00:00:00Z" }]);
    assert.equal(useStore.getState().messages.length, 1);
    assert.equal(useStore.getState().messages[0].content, "new");
  });

  it("setDailySummary updates summary state when date matches today", () => {
    const today = formatLocalDate(new Date());
    useStore.getState().setDailySummary({ date: today, totalCalories: 500, totalProtein: 30, totalCarbs: 60, totalFat: 15, mealCount: 1 });
    assert.equal(useStore.getState().dailySummary?.totalCalories, 500);
    assert.equal(useStore.getState().dailySummary?.date, today);
  });

  it("setDailySummary drops summary when date mismatch vs local today (D-10)", () => {
    // Seed a trusted summary for today.
    const today = formatLocalDate(new Date());
    useStore.getState().setDailySummary({ date: today, totalCalories: 400, totalProtein: 25, totalCarbs: 50, totalFat: 12, mealCount: 1 });
    assert.equal(useStore.getState().dailySummary?.totalCalories, 400);

    // Attempt to overwrite with a stale yesterday-dated summary.
    useStore.getState().setDailySummary({ date: "1999-01-01", totalCalories: 99999, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 99 });

    // Previous trusted summary is preserved; mismatched summary did not mutate state.
    assert.equal(useStore.getState().dailySummary?.totalCalories, 400);
    assert.equal(useStore.getState().dailySummary?.date, today);
  });

  it("setDailySummary invokes registered rollover handler on date mismatch without throwing (D-13)", () => {
    let handlerCallCount = 0;
    useStore.getState().setRolloverRefreshHandler(() => {
      handlerCallCount++;
    });

    // Stale date triggers handler exactly once.
    useStore.getState().setDailySummary({ date: "1999-01-01", totalCalories: 1, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 });

    assert.equal(handlerCallCount, 1);
    assert.equal(useStore.getState().dailySummary, null);
  });

  it("setDailySummary does not throw when rollover handler throws synchronously (T-09-06)", () => {
    useStore.getState().setRolloverRefreshHandler(() => {
      throw new Error("boom");
    });

    // Must not propagate to caller (SSE/chat path protection).
    assert.doesNotThrow(() => {
      useStore.getState().setDailySummary({ date: "1999-01-01", totalCalories: 1, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 });
    });
    assert.equal(useStore.getState().dailySummary, null);
  });

  it("setDailySummary does not throw when rollover handler returns a rejected promise (T-09-06)", async () => {
    useStore.getState().setRolloverRefreshHandler(() => Promise.reject(new Error("async boom")));

    assert.doesNotThrow(() => {
      useStore.getState().setDailySummary({ date: "1999-01-01", totalCalories: 1, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0 });
    });
    assert.equal(useStore.getState().dailySummary, null);
    // Let the microtask rejection settle to prove we caught it.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("setDailySummary does not invoke rollover handler when date matches today", () => {
    let handlerCallCount = 0;
    useStore.getState().setRolloverRefreshHandler(() => {
      handlerCallCount++;
    });

    const today = formatLocalDate(new Date());
    useStore.getState().setDailySummary({ date: today, totalCalories: 100, totalProtein: 5, totalCarbs: 10, totalFat: 2, mealCount: 1 });

    assert.equal(handlerCallCount, 0);
    assert.equal(useStore.getState().dailySummary?.totalCalories, 100);
  });

  it("setDailySummary rejects malformed summary shapes without mutating state or firing rollover", () => {
    let handlerCallCount = 0;
    useStore.getState().setRolloverRefreshHandler(() => {
      handlerCallCount++;
    });

    const today = formatLocalDate(new Date());
    const trusted = {
      date: today,
      totalCalories: 500,
      totalProtein: 30,
      totalCarbs: 60,
      totalFat: 15,
      mealCount: 1,
    };
    useStore.getState().setDailySummary(trusted);

    assert.doesNotThrow(() => {
      useStore.getState().setDailySummary({
        date: today,
        totalCalories: "999",
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        mealCount: 1,
      } as any);
    });

    assert.deepEqual(useStore.getState().dailySummary, trusted);
    assert.equal(handlerCallCount, 0);
  });

  it("setDailyTargets persists to localStorage", () => {
    const targets = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
    useStore.getState().setDailyTargets(targets);
    assert.deepEqual(useStore.getState().dailyTargets, targets);
    assert.equal(storage.get("dailyTargets"), JSON.stringify(targets));
  });

  it("setDailyTargets rejects malformed targets without mutating state or localStorage", () => {
    const trusted = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
    useStore.getState().setDailyTargets(trusted);
    const storedBefore = storage.get("dailyTargets");

    assert.doesNotThrow(() => {
      useStore.getState().setDailyTargets({ calories: 1800, protein: "130", carbs: 200, fat: 60 } as any);
    });

    assert.deepEqual(useStore.getState().dailyTargets, trusted);
    assert.equal(storage.get("dailyTargets"), storedBefore);
  });

  it("setMeals rejects malformed meal rows without replacing previous state", () => {
    useStore.getState().setMeals(sampleMeals);

    assert.doesNotThrow(() => {
      useStore.getState().setMeals([
        sampleMeals[0],
        {
          id: "meal-bad",
          foodName: "壞資料",
          calories: 100,
          protein: 5,
          carbs: 10,
          fat: 4,
          itemCount: 1,
          loggedAt: "2026-04-01T09:00:00.000Z",
          mealPeriod: "brunch",
        },
      ] as any);
    });

    assert.deepEqual(useStore.getState().meals, sampleMeals);
  });

  it("setMeals derives a same-day daily summary fallback for reload before SSE arrives", () => {
    useStore.getState().setMeals(sampleMeals);

    assert.deepEqual(useStore.getState().meals, sampleMeals);
    assert.deepEqual(useStore.getState().dailySummary, {
      date: formatLocalDate(new Date()),
      totalCalories: 700,
      totalProtein: 54,
      totalCarbs: 68,
      totalFat: 24,
      mealCount: 2,
    });
  });

  it("arms cold-start replay on the first home-visible meal commit only", () => {
    useStore.setState({ activeScreen: "home", dailyTargets, homeAnimation: initialHomeAnimation() });

    useStore.getState().setMeals(sampleMeals);
    const firstHomeAnimation = useStore.getState().homeAnimation;

    assert.deepEqual(firstHomeAnimation.baseline, {
      date: formatLocalDate(new Date()),
      kcal: 700,
      protein: 54,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    });
    assert.deepEqual(firstHomeAnimation.pendingIntent, {
      kind: "replay",
      from: null,
      token: 1,
      origin: "cold_start",
    });

    useStore.getState().setMeals([{ ...sampleMeals[0], calories: 540 }, sampleMeals[1]]);
    const secondHomeAnimation = useStore.getState().homeAnimation;

    assert.equal(secondHomeAnimation.baseline?.kcal, 720);
    assert.equal(secondHomeAnimation.pendingIntent?.token, 1);
    assert.equal(secondHomeAnimation.pendingIntent?.origin, "cold_start");
  });

  it("freezes the home animation baseline while away from home", () => {
    useStore.setState({ activeScreen: "home", dailyTargets, homeAnimation: initialHomeAnimation() });
    useStore.getState().setMeals(sampleMeals);
    const baseline = useStore.getState().homeAnimation.baseline;

    useStore.getState().setActiveScreen("chat");
    useStore.getState().setMeals([{ ...sampleMeals[0], calories: 540 }, sampleMeals[1]]);

    assert.deepEqual(useStore.getState().homeAnimation.baseline, baseline);
    assert.equal(useStore.getState().dailySummary?.totalCalories, 720);
  });

  it("setActiveScreen arms replay when returning from chat without unseen today mutations", () => {
    const today = formatLocalDate(new Date());
    const frozenBaseline = {
      date: today,
      kcal: 700,
      protein: 54,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    };

    useStore.setState({
      activeScreen: "chat",
      dailyTargets,
      dailySummary: {
        date: today,
        totalCalories: 820,
        totalProtein: 64,
        totalCarbs: 78,
        totalFat: 30,
        mealCount: 3,
      },
      homeAnimation: {
        baseline: frozenBaseline,
        unseenTodayMutation: false,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().setActiveScreen("home");

    assert.equal(useStore.getState().activeScreen, "home");
    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent, {
      kind: "replay",
      from: null,
      token: 1,
      origin: "nav_from_chat",
    });
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, false);
  });

  it("setActiveScreen arms a collapsed delta when returning from chat with an unseen today mutation", () => {
    const today = formatLocalDate(new Date());
    const frozenBaseline = {
      date: today,
      kcal: 700,
      protein: 54,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    };

    useStore.setState({
      activeScreen: "chat",
      dailyTargets,
      dailySummary: {
        date: today,
        totalCalories: 900,
        totalProtein: 70,
        totalCarbs: 90,
        totalFat: 32,
        mealCount: 3,
      },
      homeAnimation: {
        baseline: frozenBaseline,
        unseenTodayMutation: true,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().setActiveScreen("home");

    assert.equal(useStore.getState().homeAnimation.pendingIntent?.kind, "delta");
    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent?.from, frozenBaseline);
    assert.equal(useStore.getState().homeAnimation.pendingIntent?.origin, "nav_from_chat");
    assert.equal(useStore.getState().homeAnimation.baseline?.kcal, 900);
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, false);
  });

  it("setActiveScreen returning from history arms a navigation replay", () => {
    const today = formatLocalDate(new Date());

    useStore.setState({
      activeScreen: "history",
      dailyTargets,
      dailySummary: {
        date: today,
        totalCalories: 700,
        totalProtein: 54,
        totalCarbs: 68,
        totalFat: 24,
        mealCount: 2,
      },
      homeAnimation: {
        baseline: {
          date: today,
          kcal: 700,
          protein: 54,
          carbs: 68,
          fat: 24,
          targets: dailyTargets,
        },
        unseenTodayMutation: false,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().setActiveScreen("home");

    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent, {
      kind: "replay",
      from: null,
      token: 1,
      origin: "nav_from_history",
    });
  });

  it("setActiveScreen does not arm a home animation intent when leaving home", () => {
    const pendingIntent = {
      kind: "replay" as const,
      from: null,
      token: 4,
      origin: "cold_start" as const,
    };

    useStore.setState({
      activeScreen: "home",
      homeAnimation: {
        baseline: null,
        unseenTodayMutation: false,
        pendingIntent,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().setActiveScreen("chat");

    assert.equal(useStore.getState().activeScreen, "chat");
    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent, pendingIntent);
  });

  it("tracks activeScreen changes and meal collection helpers", () => {
    useStore.getState().setActiveScreen("history");
    useStore.getState().setMeals(sampleMeals);
    useStore.getState().removeMeal("meal-1");

    assert.equal(useStore.getState().activeScreen, "history");
    assert.deepEqual(useStore.getState().meals, [sampleMeals[1]]);
  });

  it("tracks secondary screen stack without clearing tab state", () => {
    useStore.getState().setActiveScreen("chat");
    useStore.getState().setPendingHomeChatDraft({ id: "draft-1", text: "晚餐吃了鮭魚", status: "staged" });
    useStore.getState().openSecondaryScreen("settings");

    assert.deepEqual(useStore.getState().secondaryScreen, { screen: "settings", origin: "chat" });
    assert.equal(useStore.getState().pendingHomeChatDraft?.id, "draft-1");

    useStore.getState().closeSecondaryScreen();
    assert.equal(useStore.getState().secondaryScreen, null);
    assert.equal(useStore.getState().pendingHomeChatDraft?.id, "draft-1");
  });

  it("opens Day Detail with payload without clearing pending chat draft", () => {
    useStore.getState().setActiveScreen("history");
    useStore.getState().setPendingHomeChatDraft({ id: "draft-2", text: "午餐吃了沙拉", status: "staged" });
    useStore.getState().openDayDetail(
      { dateKey: "2026-04-29", targetMealId: "meal-2", label: "history-snapshot" },
      "history",
    );

    assert.deepEqual(useStore.getState().secondaryScreen, {
      screen: "dayDetail",
      origin: "history",
      payload: { dateKey: "2026-04-29", targetMealId: "meal-2", label: "history-snapshot" },
    });
    assert.equal(useStore.getState().pendingHomeChatDraft?.id, "draft-2");

    useStore.getState().closeSecondaryScreen();
    assert.equal(useStore.getState().secondaryScreen, null);
    assert.equal(useStore.getState().pendingHomeChatDraft?.id, "draft-2");
  });

  it("openMealEdit stores payload and preserves pending Home Chat draft", () => {
    useStore.getState().setActiveScreen("chat");
    useStore.getState().setPendingHomeChatDraft({ id: "draft-3", text: "晚餐要補蛋白", status: "staged" });

    useStore.getState().openMealEdit(
      {
        mealId: "meal-1",
        dateKey: "2026-04-30",
        foodName: "雞胸肉沙拉",
        mealRevisionId: "meal-1:r1",
        calories: 420,
        protein: 32,
        carbs: 14,
        fat: 22,
        itemCount: 1,
      },
      "chat",
    );

    assert.deepEqual(useStore.getState().secondaryScreen, {
      screen: "mealEdit",
      origin: "chat",
        payload: {
          mealId: "meal-1",
          dateKey: "2026-04-30",
          foodName: "雞胸肉沙拉",
          mealRevisionId: "meal-1:r1",
          calories: 420,
        protein: 32,
        carbs: 14,
        fat: 22,
        itemCount: 1,
      },
    });
    assert.equal(useStore.getState().pendingHomeChatDraft?.id, "draft-3");
  });

  it("NAV-02 returns Meal Edit launched from Day Detail back to the same detail context", () => {
    const returnToDayDetail = {
      dateKey: "2026-05-06",
      targetMealId: "meal-focused",
      label: "history-snapshot" as const,
    };
    const payload = {
      mealId: "meal-focused",
      dateKey: "2026-05-06",
      foodName: "雞腿便當",
      mealRevisionId: "meal-focused:r1",
      calories: 640,
      protein: 36,
      carbs: 72,
      fat: 18,
      itemCount: 1,
    };

    useStore.getState().openMealEdit(payload, "history", { returnToDayDetail });

    assert.deepEqual(useStore.getState().secondaryScreen, {
      screen: "mealEdit",
      origin: "history",
      payload,
      returnToDayDetail,
    }, "NAV-02 openMealEdit(payload, \"history\", { returnToDayDetail }) must retain focused Day Detail context");

    useStore.getState().closeSecondaryScreen();
    assert.deepEqual(useStore.getState().secondaryScreen, {
      screen: "dayDetail",
      origin: "history",
      payload: returnToDayDetail,
    }, "NAV-02 closeSecondaryScreen() must restore Day Detail when Meal Edit has returnToDayDetail");

    useStore.getState().openMealEdit(payload, "home");
    useStore.getState().closeSecondaryScreen();
    assert.equal(useStore.getState().secondaryScreen, null, "NAV-02 Home Meal Edit closes to null");

    useStore.getState().openMealEdit(payload, "chat");
    useStore.getState().closeSecondaryScreen();
    assert.equal(useStore.getState().secondaryScreen, null, "NAV-02 Chat Meal Edit closes to null");
  });

  it("goBack closes settings secondary screen before leaving primary navigation", () => {
    useStore.getState().setActiveScreen("history");
    useStore.getState().openSecondaryScreen("settings", "history");

    const handled = useStore.getState().goBack();

    assert.equal(handled, true);
    assert.equal(useStore.getState().activeScreen, "history");
    assert.equal(useStore.getState().secondaryScreen, null);
  });

  it("goBack closes day detail secondary screen before leaving primary navigation", () => {
    useStore.getState().setActiveScreen("history");
    useStore.getState().openDayDetail({ dateKey: "2026-05-06", label: "history-snapshot" }, "history");

    const handled = useStore.getState().goBack();

    assert.equal(handled, true);
    assert.equal(useStore.getState().activeScreen, "history");
    assert.equal(useStore.getState().secondaryScreen, null);
  });

  it("goBack restores Day Detail when Meal Edit was launched with returnToDayDetail", () => {
    const returnToDayDetail = {
      dateKey: "2026-05-06",
      targetMealId: "meal-focused",
      label: "history-snapshot" as const,
    };
    const payload = {
      mealId: "meal-focused",
      dateKey: "2026-05-06",
      foodName: "雞腿便當",
      mealRevisionId: "meal-focused:r1",
      calories: 640,
      protein: 36,
      carbs: 72,
      fat: 18,
      itemCount: 1,
    };

    useStore.getState().setActiveScreen("history");
    useStore.getState().openMealEdit(payload, "history", { returnToDayDetail });

    const handled = useStore.getState().goBack();

    assert.equal(handled, true);
    assert.equal(useStore.getState().activeScreen, "history");
    assert.deepEqual(useStore.getState().secondaryScreen, {
      screen: "dayDetail",
      origin: "history",
      payload: returnToDayDetail,
    });
  });

  it("goBack returns chat and history primary screens to home", () => {
    useStore.getState().setActiveScreen("chat");
    assert.equal(useStore.getState().goBack(), true);
    assert.equal(useStore.getState().activeScreen, "home");

    useStore.getState().setActiveScreen("history");
    assert.equal(useStore.getState().goBack(), true);
    assert.equal(useStore.getState().activeScreen, "home");
  });

  it("goBack returns false at home root without mutating state", () => {
    useStore.getState().setDevice("d-1", "fat_loss", { calories: 1500, protein: 120, carbs: 150, fat: 50 });
    const before = useStore.getState();

    const handled = useStore.getState().goBack();

    assert.equal(handled, false);
    assert.equal(useStore.getState().activeScreen, "home");
    assert.equal(useStore.getState().secondaryScreen, null);
    assert.equal(useStore.getState().sending, before.sending);
    assert.deepEqual(useStore.getState().messages, before.messages);
  });

  it("goBack returns false during onboarding and leaves the pre-shell gate untouched", () => {
    useStore.getState().clearDevice();

    const handled = useStore.getState().goBack();

    assert.equal(handled, false);
    assert.equal(useStore.getState().activeScreen, "onboarding");
    assert.equal(useStore.getState().secondaryScreen, null);
  });

  it("goBack unwinds one navigation layer while preserving sending and proposal-card message state", () => {
    const proposalCard = {
      proposalId: "proposal-1",
      proposalKind: "meal_estimate" as const,
      proposalLane: "meal_mutation" as const,
      status: "active" as const,
      isActionable: true,
      title: "調整熱量估算",
      details: { rows: [{ label: "熱量", before: "500", after: "650" }] },
      actions: {
        approveLabel: "套用",
        editLabel: "我再說明",
        rejectLabel: "不用",
      },
      expiresAt: "2026-05-06T12:00:00.000Z",
      lapseCopy: null,
      supersededByKind: null,
    };
    const messages = [
      {
        id: "assistant-proposal",
        role: "assistant" as const,
        content: "要套用這個估算嗎？",
        createdAt: "2026-05-06T11:00:00.000Z",
        proposalCard,
      },
    ];
    useStore.setState({ activeScreen: "chat", sending: true, messages });

    const handled = useStore.getState().goBack();

    assert.equal(handled, true);
    assert.equal(useStore.getState().activeScreen, "home");
    assert.equal(useStore.getState().sending, true);
    assert.deepEqual(useStore.getState().messages, messages);
    assert.deepEqual(useStore.getState().messages[0]?.proposalCard, proposalCard);
  });

  it("recordMealMutation tracks affected date with a monotonic nonce", () => {
    useStore.getState().recordMealMutation("2026-04-30");
    const first = useStore.getState().lastMealMutation;
    useStore.getState().recordMealMutation("2026-04-30");
    const second = useStore.getState().lastMealMutation;

    assert.deepEqual(first, { affectedDate: "2026-04-30", nonce: 1 });
    assert.deepEqual(second, { affectedDate: "2026-04-30", nonce: 2 });
  });

  it("recordMealMutation marks only away today mutations as unseen", () => {
    const today = formatLocalDate(new Date());

    useStore.setState({ activeScreen: "chat", homeAnimation: initialHomeAnimation() });
    useStore.getState().recordMealMutation(today);
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, true);

    useStore.setState({ activeScreen: "chat", homeAnimation: initialHomeAnimation() });
    useStore.getState().recordMealMutation("1999-01-01");
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, false);

    useStore.setState({ activeScreen: "home", homeAnimation: initialHomeAnimation() });
    useStore.getState().openMealEdit(
      {
        mealId: "meal-1",
        mealRevisionId: "meal-1:r1",
        dateKey: today,
        foodName: "雞胸肉便當",
        calories: 520,
        protein: 42,
        carbs: 48,
        fat: 18,
        itemCount: 1,
      },
      "home",
    );
    useStore.getState().recordMealMutation(today);
    assert.equal(useStore.getState().activeScreen, "home");
    assert.equal(useStore.getState().secondaryScreen?.screen, "mealEdit");
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, false);
  });

  it("requestHomeEntryAnimation commits a pending intent with origin and clears unseen mutations", () => {
    const today = formatLocalDate(new Date());
    const frozenBaseline = {
      date: today,
      kcal: 700,
      protein: 54,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    };

    useStore.setState({
      activeScreen: "chat",
      dailyTargets,
      dailySummary: {
        date: today,
        totalCalories: 820,
        totalProtein: 64,
        totalCarbs: 78,
        totalFat: 30,
        mealCount: 3,
      },
      homeAnimation: {
        baseline: frozenBaseline,
        unseenTodayMutation: true,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().requestHomeEntryAnimation("nav_from_chat");
    const chatIntent = useStore.getState().homeAnimation.pendingIntent;

    assert.deepEqual(chatIntent, {
      kind: "delta",
      from: frozenBaseline,
      token: 1,
      origin: "nav_from_chat",
    });
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, false);
    assert.equal(useStore.getState().homeAnimation.baseline?.kcal, 820);

    useStore.getState().requestHomeEntryAnimation("nav_from_history");
    assert.equal(useStore.getState().homeAnimation.pendingIntent?.kind, "replay");
    assert.equal(useStore.getState().homeAnimation.pendingIntent?.from, null);
    assert.equal(useStore.getState().homeAnimation.pendingIntent?.token, 2);
    assert.equal(useStore.getState().homeAnimation.pendingIntent?.origin, "nav_from_history");
  });

  it("goBack from an overlay does not create or consume home animation intent", () => {
    useStore.setState({
      activeScreen: "home",
      homeAnimation: {
        baseline: null,
        unseenTodayMutation: false,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });
    useStore.getState().openSecondaryScreen("settings", "home");

    assert.equal(useStore.getState().goBack(), true);
    assert.equal(useStore.getState().secondaryScreen, null);
    assert.equal(useStore.getState().homeAnimation.pendingIntent, null);
  });

  it("goBack from chat returns home and arms a nav_from_chat replay intent", () => {
    const today = formatLocalDate(new Date());

    useStore.setState({
      activeScreen: "chat",
      dailyTargets,
      dailySummary: {
        date: today,
        totalCalories: 700,
        totalProtein: 54,
        totalCarbs: 68,
        totalFat: 24,
        mealCount: 2,
      },
      homeAnimation: {
        baseline: {
          date: today,
          kcal: 700,
          protein: 54,
          carbs: 68,
          fat: 24,
          targets: dailyTargets,
        },
        unseenTodayMutation: false,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });

    assert.equal(useStore.getState().goBack(), true);
    assert.equal(useStore.getState().activeScreen, "home");
    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent, {
      kind: "replay",
      from: null,
      token: 1,
      origin: "nav_from_chat",
    });
  });

  it("applyManualHomeRefresh replays unchanged totals against the old baseline", () => {
    const today = formatLocalDate(new Date());
    const baseline = {
      date: today,
      kcal: 700,
      protein: 54,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    };

    useStore.setState({
      activeScreen: "home",
      dailyTargets,
      homeAnimation: {
        baseline,
        unseenTodayMutation: true,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().applyManualHomeRefresh(sampleMeals);

    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent, {
      kind: "replay",
      from: null,
      token: 1,
      origin: "manual_refresh",
    });
    assert.deepEqual(useStore.getState().homeAnimation.baseline, baseline);
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, false);
    assert.equal(useStore.getState().dailySummary?.totalCalories, 700);
  });

  it("applyManualHomeRefresh derives a changed refresh delta from the old baseline", () => {
    const today = formatLocalDate(new Date());
    const oldBaseline = {
      date: today,
      kcal: 700,
      protein: 54,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    };
    const changedMeals = [{ ...sampleMeals[0], calories: 540, protein: 44 }, sampleMeals[1]];

    useStore.setState({
      activeScreen: "home",
      dailyTargets,
      homeAnimation: {
        baseline: oldBaseline,
        unseenTodayMutation: true,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().applyManualHomeRefresh(changedMeals);

    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent, {
      kind: "delta",
      from: oldBaseline,
      token: 1,
      origin: "manual_refresh",
    });
    assert.deepEqual(useStore.getState().homeAnimation.baseline, {
      date: today,
      kcal: 720,
      protein: 56,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    });
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, false);
  });

  it("applyMealMutationRefresh animates a Home-visible delete from the pre-mutation baseline", () => {
    const today = formatLocalDate(new Date());
    const oldBaseline = {
      date: today,
      kcal: 700,
      protein: 54,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    };
    const deletedMealSummary = {
      date: today,
      totalCalories: 180,
      totalProtein: 12,
      totalCarbs: 20,
      totalFat: 6,
      mealCount: 1,
    };

    useStore.setState({
      activeScreen: "home",
      dailyTargets,
      homeAnimation: {
        baseline: oldBaseline,
        unseenTodayMutation: false,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().recordMealMutation(today);
    useStore.getState().setDailySummary(deletedMealSummary);
    useStore.getState().applyMealMutationRefresh([sampleMeals[1]]);

    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent, {
      kind: "delta",
      from: oldBaseline,
      token: 1,
      origin: "meal_mutation",
    });
    assert.deepEqual(useStore.getState().homeAnimation.baseline, {
      date: today,
      kcal: 180,
      protein: 12,
      carbs: 20,
      fat: 6,
      targets: dailyTargets,
    });
    assert.equal(useStore.getState().homeAnimation.homeVisibleMutationBaseline, null);
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, false);
  });

  it("applyMealMutationRefresh preserves away mutation state for chat-to-home delta", () => {
    const today = formatLocalDate(new Date());
    const oldBaseline = {
      date: today,
      kcal: 700,
      protein: 54,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    };
    const changedMeals = [{ ...sampleMeals[0], calories: 540, protein: 44 }, sampleMeals[1]];

    useStore.setState({
      activeScreen: "chat",
      dailyTargets,
      homeAnimation: {
        baseline: oldBaseline,
        unseenTodayMutation: false,
        pendingIntent: null,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().recordMealMutation(today);
    useStore.getState().applyMealMutationRefresh(changedMeals);

    assert.deepEqual(useStore.getState().homeAnimation.baseline, oldBaseline);
    assert.equal(useStore.getState().homeAnimation.unseenTodayMutation, true);
    assert.equal(useStore.getState().homeAnimation.pendingIntent, null);

    useStore.getState().setActiveScreen("home");

    assert.equal(useStore.getState().homeAnimation.pendingIntent?.kind, "delta");
    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent?.from, oldBaseline);
    assert.equal(useStore.getState().homeAnimation.pendingIntent?.origin, "nav_from_chat");
  });

  it("applyMealMutationRefresh preserves an existing Home-visible mutation intent during duplicate refreshes", () => {
    const today = formatLocalDate(new Date());
    const oldBaseline = {
      date: today,
      kcal: 700,
      protein: 54,
      carbs: 68,
      fat: 24,
      targets: dailyTargets,
    };
    const currentBaseline = {
      date: today,
      kcal: 180,
      protein: 12,
      carbs: 20,
      fat: 6,
      targets: dailyTargets,
    };
    const pendingIntent = {
      kind: "delta" as const,
      from: oldBaseline,
      token: 3,
      origin: "meal_mutation" as const,
    };

    useStore.setState({
      activeScreen: "home",
      dailyTargets,
      homeAnimation: {
        baseline: currentBaseline,
        unseenTodayMutation: false,
        pendingIntent,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().applyMealMutationRefresh([sampleMeals[1]]);

    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent, pendingIntent);
    assert.deepEqual(useStore.getState().homeAnimation.baseline, currentBaseline);
  });

  it("consumeHomeAnimationIntent clears only the matching pending token", () => {
    const pendingIntent = {
      kind: "replay" as const,
      from: null,
      token: 3,
      origin: "cold_start" as const,
    };
    useStore.setState({
      homeAnimation: {
        baseline: null,
        unseenTodayMutation: false,
        pendingIntent,
        homeVisibleMutationBaseline: null,
      },
    });

    useStore.getState().consumeHomeAnimationIntent(2);
    assert.deepEqual(useStore.getState().homeAnimation.pendingIntent, pendingIntent);

    useStore.getState().consumeHomeAnimationIntent(3);
    assert.equal(useStore.getState().homeAnimation.pendingIntent, null);
  });

  it("redactChatReceiptIdentity makes matching chat receipts display-only without removing receipt content", () => {
    useStore.getState().setMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "已幫你記錄雞腿便當。",
        createdAt: "2026-04-30T04:00:00.000Z",
        didLogMeal: true,
        loggedMeal: {
          mealId: "meal-1",
          mealRevisionId: "meal-1:r1",
          dateKey: "2026-04-30",
          receiptStatus: "active",
          loggedAt: "2026-04-30T04:00:00.000Z",
          foodName: "雞腿便當",
          calories: 640,
          protein: 30,
          carbs: 78,
          fat: 20,
          itemCount: 1,
          imageAssetId: "asset-lunch",
          imageUrl: "/api/assets/asset-lunch",
        },
      },
      {
        id: "assistant-1-stale",
        role: "assistant",
        content: "舊版雞腿便當。",
        createdAt: "2026-04-30T04:05:00.000Z",
        didLogMeal: true,
        loggedMeal: {
          receiptMealId: "meal-1",
          receiptStatus: "stale_revision",
          loggedAt: "2026-04-30T04:00:00.000Z",
          foodName: "舊版雞腿便當",
          calories: 700,
          protein: 32,
          carbs: 84,
          fat: 22,
          itemCount: 1,
          imageAssetId: "asset-lunch-old",
          imageUrl: "/api/assets/asset-lunch-old",
        },
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: "已幫你記錄鮭魚飯糰。",
        createdAt: "2026-04-30T08:00:00.000Z",
        didLogMeal: true,
        loggedMeal: {
          mealId: "meal-2",
          mealRevisionId: "meal-2:r1",
          dateKey: "2026-04-30",
          receiptStatus: "active",
          loggedAt: "2026-04-30T08:00:00.000Z",
          foodName: "鮭魚飯糰",
          calories: 280,
          protein: 14,
          carbs: 36,
          fat: 8,
          itemCount: 1,
          imageAssetId: "asset-salmon",
          imageUrl: "/api/assets/asset-salmon",
        },
      },
    ]);

    useStore.getState().redactChatReceiptIdentity("meal-1");

    const [redactedMessage, redactedStaleMessage, untouchedMessage] = useStore.getState().messages;
    assert.equal(redactedMessage?.loggedMeal?.mealId, undefined);
    assert.equal(redactedMessage?.loggedMeal?.mealRevisionId, undefined);
    assert.equal(redactedMessage?.loggedMeal?.dateKey, undefined);
    assert.equal(redactedMessage?.loggedMeal?.receiptMealId, "meal-1");
    assert.equal((redactedMessage?.loggedMeal as any)?.receiptStatus, "deleted");
    assert.equal(redactedMessage?.loggedMeal?.foodName, "雞腿便當");
    assert.equal(redactedMessage?.loggedMeal?.calories, 640);
    assert.equal(redactedMessage?.loggedMeal?.protein, 30);
    assert.equal(redactedMessage?.loggedMeal?.carbs, 78);
    assert.equal(redactedMessage?.loggedMeal?.fat, 20);
    assert.equal(redactedMessage?.loggedMeal?.itemCount, 1);
    assert.equal(redactedMessage?.loggedMeal?.imageAssetId, "asset-lunch");
    assert.equal(redactedMessage?.loggedMeal?.imageUrl, "/api/assets/asset-lunch");
    assert.equal(buildReceiptMealEditPayload(redactedMessage?.loggedMeal), null);

    assert.equal(redactedStaleMessage?.loggedMeal?.mealId, undefined);
    assert.equal(redactedStaleMessage?.loggedMeal?.mealRevisionId, undefined);
    assert.equal(redactedStaleMessage?.loggedMeal?.dateKey, undefined);
    assert.equal(redactedStaleMessage?.loggedMeal?.receiptMealId, "meal-1");
    assert.equal((redactedStaleMessage?.loggedMeal as any)?.receiptStatus, "deleted");
    assert.equal(redactedStaleMessage?.loggedMeal?.foodName, "舊版雞腿便當");
    assert.equal(redactedStaleMessage?.loggedMeal?.calories, 700);
    assert.equal(redactedStaleMessage?.loggedMeal?.imageAssetId, "asset-lunch-old");
    assert.equal(buildReceiptMealEditPayload(redactedStaleMessage?.loggedMeal), null);

    assert.equal(untouchedMessage?.loggedMeal?.mealId, "meal-2");
    assert.equal(untouchedMessage?.loggedMeal?.receiptMealId, undefined);
    assert.equal(untouchedMessage?.loggedMeal?.mealRevisionId, "meal-2:r1");
    assert.equal((untouchedMessage?.loggedMeal as any)?.receiptStatus, "active");
    assert.equal(buildReceiptMealEditPayload(untouchedMessage?.loggedMeal)?.mealId, "meal-2");
    assert.equal(buildReceiptMealEditPayload(untouchedMessage?.loggedMeal)?.mealRevisionId, "meal-2:r1");
  });

  it("normalizes receiptStatus values and omits malformed transport statuses", () => {
    const active = normalizeLoggedMealReceipt({
      mealId: "meal-active",
      mealRevisionId: "meal-active:r1",
      dateKey: "2026-04-30",
      receiptStatus: "active",
      foodName: "雞腿便當",
      calories: 640,
      protein: 30,
      carbs: 78,
      fat: 20,
      itemCount: 1,
    } as any);
    assert.equal((active as any).receiptStatus, "active");

    const deleted = normalizeLoggedMealReceipt({
      foodName: "已刪除雞腿便當",
      calories: 640,
      protein: 30,
      carbs: 78,
      fat: 20,
      itemCount: 1,
      receiptStatus: "deleted",
    } as any);
    assert.equal((deleted as any).receiptStatus, "deleted");

    const stale = normalizeLoggedMealReceipt({
      foodName: "舊版鮭魚飯糰",
      calories: 280,
      protein: 14,
      carbs: 36,
      fat: 8,
      itemCount: 1,
      receiptStatus: "stale_revision",
    } as any);
    assert.equal((stale as any).receiptStatus, "stale_revision");

    const malformed = normalizeLoggedMealReceipt({
      foodName: "壞狀態便當",
      calories: 640,
      protein: 30,
      carbs: 78,
      fat: 20,
      itemCount: 1,
      receiptStatus: "removed",
    } as any);
    assert.equal((malformed as any).receiptStatus, undefined);
  });

  it("buildReceiptMealEditPayload rejects display-only receipts even when identity fields remain", () => {
    assert.equal(buildReceiptMealEditPayload({
      mealId: "meal-deleted",
      mealRevisionId: "meal-deleted:r1",
      dateKey: "2026-04-30",
      receiptStatus: "deleted",
      loggedAt: "2026-04-30T04:00:00.000Z",
      foodName: "已刪除雞腿便當",
      calories: 640,
      protein: 30,
      carbs: 78,
      fat: 20,
      itemCount: 1,
      imageAssetId: "asset-lunch",
      imageUrl: "/api/assets/asset-lunch",
    } as any), null);

    assert.equal(buildReceiptMealEditPayload({
      mealId: "meal-stale",
      mealRevisionId: "meal-stale:r1",
      dateKey: "2026-04-30",
      receiptStatus: "stale_revision",
      loggedAt: "2026-04-30T04:00:00.000Z",
      foodName: "舊版雞腿便當",
      calories: 640,
      protein: 30,
      carbs: 78,
      fat: 20,
      itemCount: 1,
    } as any), null);
  });

  it("stores and clears the pending home chat draft", () => {
    useStore.getState().setPendingHomeChatDraft({ id: "draft-1", text: "晚餐吃了鮭魚", status: "staged" });
    assert.deepEqual(useStore.getState().pendingHomeChatDraft, {
      id: "draft-1",
      text: "晚餐吃了鮭魚",
      status: "staged",
    });

    useStore.getState().clearPendingHomeChatDraft();
    assert.equal(useStore.getState().pendingHomeChatDraft, null);
  });

  it("CHAT-01 D-01..D-09 removes only the explicit draft-linked failed assistant message", () => {
    useStore.getState().setMessages([
      {
        id: "artifact-draft-failed",
        role: "assistant",
        content: "抱歉，發生錯誤，請再試一次。",
        createdAt: "2026-06-05T04:00:00.000Z",
        status: "error",
      },
      {
        id: "artifact-unrelated-error",
        role: "assistant",
        content: "另一筆較新的錯誤也要保留",
        createdAt: "2026-06-05T04:01:00.000Z",
        status: "error",
      },
      {
        id: "user-draft",
        role: "user",
        content: "午餐吃了飯糰",
        createdAt: "2026-06-05T04:00:00.000Z",
      },
    ]);

    useStore.getState().clearDraftLinkedAssistantArtifact("artifact-draft-failed");

    assert.deepEqual(
      useStore.getState().messages.map((message) => message.id),
      ["artifact-unrelated-error", "user-draft"],
      "D-03/D-07/D-08 cleanup must key by explicit artifact id and preserve unrelated assistant errors plus user bubbles",
    );
  });

  it("CHAT-02 D-10..D-15 clears only the matching draft-linked provisional artifact", () => {
    useStore.getState().setMessages([
      {
        id: "assistant-history",
        role: "assistant",
        content: "歷史回覆保留",
        createdAt: "2026-06-05T04:00:00.000Z",
      },
    ]);
    useStore.getState().setProvisionalBubble({
      id: "artifact-provisional",
      statusLabel: "",
      content: "送出失敗",
      isStreaming: false,
      status: "error",
    });

    useStore.getState().clearDraftLinkedAssistantArtifact("artifact-provisional");

    assert.equal(useStore.getState().provisionalBubble, null, "D-10 clears the linked provisional artifact");
    assert.deepEqual(
      useStore.getState().messages.map((message) => message.id),
      ["assistant-history"],
      "D-11/D-12 cancel cleanup must not delete durable messages",
    );
  });

  it("CHAT-01/CHAT-02 D-07 and D-08 leave state unchanged for an unknown artifact id", () => {
    const messages = [
      {
        id: "assistant-failed",
        role: "assistant" as const,
        content: "失敗訊息保留",
        createdAt: "2026-06-05T04:00:00.000Z",
        status: "error" as const,
      },
      {
        id: "user-message",
        role: "user" as const,
        content: "午餐吃了飯糰",
        createdAt: "2026-06-05T04:00:00.000Z",
      },
    ];
    useStore.getState().setMessages(messages);
    useStore.getState().setProvisionalBubble({
      id: "artifact-live",
      statusLabel: "思考中...",
      content: "",
      isStreaming: true,
    });

    useStore.getState().clearDraftLinkedAssistantArtifact("missing-artifact");

    assert.deepEqual(useStore.getState().messages, messages);
    assert.equal(useStore.getState().provisionalBubble?.id, "artifact-live");
  });
});

describe("ProvisionalBubble actions", () => {
  beforeEach(() => {
    storage.clear();
    useStore.setState({
      messages: [],
      dailySummary: null,
      sending: false,
      provisionalBubble: null,
      guestSessionStatus: "ready",
      guestSessionRecoveryAttempted: false,
    });
    // Reset rollover refresh handler to avoid cross-test leakage (D-19)
    useStore.getState().setRolloverRefreshHandler(null);
  });

  it("setProvisionalBubble sets the bubble state", () => {
    useStore.getState().setProvisionalBubble({
      id: "b-1",
      statusLabel: "思考中...",
      content: "",
      isStreaming: true,
    });

    assert.equal(useStore.getState().provisionalBubble?.id, "b-1");
    assert.equal(useStore.getState().provisionalBubble?.statusLabel, "思考中...");
  });

  it("setProvisionalBubble(null) clears the bubble", () => {
    useStore.getState().setProvisionalBubble({
      id: "b-1",
      statusLabel: "",
      content: "",
      isStreaming: true,
    });

    useStore.getState().setProvisionalBubble(null);

    assert.equal(useStore.getState().provisionalBubble, null);
  });

  it("setProvisionalStatus updates statusLabel without touching content", () => {
    useStore.getState().setProvisionalBubble({
      id: "b-1",
      statusLabel: "思考中...",
      content: "",
      isStreaming: true,
    });

    useStore.getState().setProvisionalStatus("分析圖片中...");

    assert.equal(useStore.getState().provisionalBubble?.statusLabel, "分析圖片中...");
    assert.equal(useStore.getState().provisionalBubble?.content, "");
  });

  it("setProvisionalStatus is no-op when provisionalBubble is null", () => {
    useStore.getState().setProvisionalStatus("分析圖片中...");

    assert.equal(useStore.getState().provisionalBubble, null);
  });

  it("appendProvisionalToken clears statusLabel and appends content (D-04)", () => {
    useStore.getState().setProvisionalBubble({
      id: "b-1",
      statusLabel: "思考中...",
      content: "",
      isStreaming: true,
    });

    useStore.getState().appendProvisionalToken("你好");

    assert.equal(useStore.getState().provisionalBubble?.statusLabel, "");
    assert.equal(useStore.getState().provisionalBubble?.content, "你好");
  });

  it("appendProvisionalToken accumulates across multiple calls", () => {
    useStore.getState().setProvisionalBubble({
      id: "b-1",
      statusLabel: "",
      content: "",
      isStreaming: true,
    });

    useStore.getState().appendProvisionalToken("Hello");
    useStore.getState().appendProvisionalToken(" World");

    assert.equal(useStore.getState().provisionalBubble?.content, "Hello World");
  });

  it("appendProvisionalToken is no-op when provisionalBubble is null", () => {
    useStore.getState().appendProvisionalToken("token");

    assert.equal(useStore.getState().provisionalBubble, null);
  });

  it("commitProvisionalBubble atomically adds message and clears bubble (D-06, D-07)", () => {
    useStore.getState().setProvisionalBubble({
      id: "msg-1",
      statusLabel: "",
      content: "完整回覆",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({ didLogMeal: true });

    assert.equal(useStore.getState().provisionalBubble, null);
    assert.equal(useStore.getState().messages.length, 1);
    assert.equal(useStore.getState().messages[0].id, "msg-1");
    assert.equal(useStore.getState().messages[0].role, "assistant");
    assert.equal(useStore.getState().messages[0].content, "完整回覆");
    assert.equal(useStore.getState().messages[0].didLogMeal, true);
  });

  it("commitProvisionalBubble redacts prior matching receipt identity when a delete commits", () => {
    useStore.getState().setMessages([
      {
        id: "assistant-logged-deleted",
        role: "assistant",
        content: "已幫你記錄雞腿便當。",
        createdAt: "2026-04-30T04:00:00.000Z",
        didLogMeal: true,
        loggedMeal: {
          mealId: "meal-delete",
          mealRevisionId: "meal-delete:r1",
          dateKey: "2026-04-30",
          receiptStatus: "active",
          loggedAt: "2026-04-30T04:00:00.000Z",
          foodName: "雞腿便當",
          calories: 640,
          protein: 30,
          carbs: 78,
          fat: 20,
          itemCount: 1,
          imageAssetId: "asset-lunch",
          imageUrl: "/api/assets/asset-lunch",
        },
      },
      {
        id: "assistant-logged-kept",
        role: "assistant",
        content: "已幫你記錄鮭魚飯糰。",
        createdAt: "2026-04-30T08:00:00.000Z",
        didLogMeal: true,
        loggedMeal: {
          mealId: "meal-keep",
          mealRevisionId: "meal-keep:r1",
          dateKey: "2026-04-30",
          receiptStatus: "active",
          loggedAt: "2026-04-30T08:00:00.000Z",
          foodName: "鮭魚飯糰",
          calories: 280,
          protein: 14,
          carbs: 36,
          fat: 8,
          itemCount: 1,
          imageAssetId: "asset-salmon",
          imageUrl: "/api/assets/asset-salmon",
        },
      },
    ]);
    useStore.getState().setProvisionalBubble({
      id: "assistant-delete-confirmation",
      statusLabel: "",
      content: "已刪除雞腿便當，已從當日紀錄移除。",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({
      didLogMeal: true,
      deletedMealId: "meal-delete",
    });

    const [redactedMessage, untouchedMessage, deleteConfirmation] = useStore.getState().messages;
    assert.equal(redactedMessage?.loggedMeal?.mealId, undefined);
    assert.equal(redactedMessage?.loggedMeal?.mealRevisionId, undefined);
    assert.equal(redactedMessage?.loggedMeal?.dateKey, undefined);
    assert.equal((redactedMessage?.loggedMeal as any)?.receiptStatus, "deleted");
    assert.equal(redactedMessage?.loggedMeal?.foodName, "雞腿便當");
    assert.equal(redactedMessage?.loggedMeal?.calories, 640);
    assert.equal(redactedMessage?.loggedMeal?.protein, 30);
    assert.equal(redactedMessage?.loggedMeal?.carbs, 78);
    assert.equal(redactedMessage?.loggedMeal?.fat, 20);
    assert.equal(redactedMessage?.loggedMeal?.itemCount, 1);
    assert.equal(redactedMessage?.loggedMeal?.imageAssetId, "asset-lunch");
    assert.equal(redactedMessage?.loggedMeal?.imageUrl, "/api/assets/asset-lunch");
    assert.equal(buildReceiptMealEditPayload(redactedMessage?.loggedMeal), null);

    assert.equal(untouchedMessage?.loggedMeal?.mealId, "meal-keep");
    assert.equal(untouchedMessage?.loggedMeal?.mealRevisionId, "meal-keep:r1");
    assert.equal(untouchedMessage?.loggedMeal?.dateKey, "2026-04-30");
    assert.equal((untouchedMessage?.loggedMeal as any)?.receiptStatus, "active");
    assert.equal(buildReceiptMealEditPayload(untouchedMessage?.loggedMeal)?.mealId, "meal-keep");

    assert.equal(deleteConfirmation?.id, "assistant-delete-confirmation");
    assert.equal(deleteConfirmation?.loggedMeal, undefined);
    assert.equal(deleteConfirmation?.content, "已刪除雞腿便當，已從當日紀錄移除。");
  });

  it("commitProvisionalBubble retains supplied full turnId for finalized error messages", () => {
    const turnId = "a1b2c3d4-1111-4222-8333-0123456789ab";
    useStore.getState().setProvisionalBubble({
      id: "msg-error",
      statusLabel: "",
      content: "抱歉，發生錯誤，請再試一次。",
      isStreaming: false,
    });

    useStore.getState().commitProvisionalBubble({
      didLogMeal: false,
      status: "error",
      turnId,
    });

    const message = useStore.getState().messages[0];
    const messageRecord = message as unknown as Record<string, unknown>;
    assert.equal(message.status, "error");
    assert.equal(message.turnId, turnId);
    assert.equal(messageRecord.referenceCode, undefined);
    assert.equal(messageRecord.turnReference, undefined);
  });

  it("commitStoppedProvisionalBubble retains supplied full turnId for stopped messages", () => {
    const turnId = "b2c3d4e5-1111-4222-8333-0123456789ab";
    useStore.getState().setProvisionalBubble({
      id: "msg-stopped",
      statusLabel: "",
      content: "部分回覆",
      isStreaming: true,
    });

    useStore.getState().commitStoppedProvisionalBubble({ didLogMeal: false, turnId });

    const message = useStore.getState().messages[0];
    assert.equal(message.status, "stopped");
    assert.equal(message.turnId, turnId);
  });

  it("commitProvisionalBubble does not synthesize turnId or reference fields for normal completion", () => {
    useStore.getState().setProvisionalBubble({
      id: "msg-normal",
      statusLabel: "",
      content: "完整回覆",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({ didLogMeal: true });

    const message = useStore.getState().messages[0];
    const messageRecord = message as unknown as Record<string, unknown>;
    assert.equal(message.status, undefined);
    assert.equal(message.turnId, undefined);
    assert.equal(messageRecord.referenceCode, undefined);
    assert.equal(messageRecord.turnReference, undefined);
  });

  it("commitProvisionalBubble is no-op when provisionalBubble is null", () => {
    useStore.getState().commitProvisionalBubble({ didLogMeal: false });

    assert.equal(useStore.getState().messages.length, 0);
  });

  it("commitProvisionalBubble routes dailySummary through guarded setDailySummary when date matches (D-12)", () => {
    useStore.getState().setProvisionalBubble({
      id: "msg-1",
      statusLabel: "",
      content: "已記錄",
      isStreaming: true,
    });

    const today = formatLocalDate(new Date());
    useStore.getState().commitProvisionalBubble({
      didLogMeal: true,
      dailySummary: {
        date: today,
        totalCalories: 620,
        totalProtein: 35,
        totalCarbs: 70,
        totalFat: 22,
        mealCount: 2,
      },
    });

    assert.equal(useStore.getState().provisionalBubble, null);
    assert.equal(useStore.getState().messages.length, 1);
    assert.equal(useStore.getState().dailySummary?.totalCalories, 620);
    assert.equal(useStore.getState().dailySummary?.date, today);
  });

  it("commitProvisionalBubble dailySummary with date mismatch is dropped by guard but message still commits (D-12)", () => {
    let handlerCallCount = 0;
    useStore.getState().setRolloverRefreshHandler(() => {
      handlerCallCount++;
    });

    useStore.getState().setProvisionalBubble({
      id: "msg-stale",
      statusLabel: "",
      content: "已記錄",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({
      didLogMeal: true,
      dailySummary: {
        date: "1999-01-01",
        totalCalories: 99999,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        mealCount: 1,
      },
    });

    // Message commits; provisional cleared; summary dropped; handler fired.
    assert.equal(useStore.getState().provisionalBubble, null);
    assert.equal(useStore.getState().messages.length, 1);
    assert.equal(useStore.getState().dailySummary, null);
    assert.equal(handlerCallCount, 1);
  });

  it("commitProvisionalBubble supersedes older active goal cards when a newer goal proposal arrives", () => {
    useStore.getState().setMessages([
      {
        id: "assistant-goal-old",
        role: "assistant",
        content: "請確認 2050 kcal。",
        createdAt: "2026-06-14T08:00:00.000Z",
        proposalCard: goalProposalCard("goal-old", 2050),
      },
    ]);
    useStore.getState().setProvisionalBubble({
      id: "assistant-goal-new",
      statusLabel: "",
      content: "請確認 1800 kcal。",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({
      didLogMeal: false,
      proposalCard: goalProposalCard("goal-new", 1800),
    });

    const [oldMessage, newMessage] = useStore.getState().messages;
    assert.equal(oldMessage?.proposalCard?.status, "superseded");
    assert.equal(oldMessage?.proposalCard?.isActionable, false);
    assert.equal(oldMessage?.proposalCard?.supersededByKind, "goal");
    assert.equal(newMessage?.proposalCard?.status, "active");
    assert.equal(newMessage?.proposalCard?.isActionable, true);
    assert.equal(
      useStore.getState().messages.filter((message) =>
        message.proposalCard?.proposalKind === "goal" &&
        message.proposalCard.status === "active" &&
        message.proposalCard.isActionable
      ).length,
      1,
    );
  });

  it("commitProvisionalBubble pairs superseded goal cards with backend replacement copy even when active cards carry expiry copy", () => {
    useStore.getState().setMessages([
      {
        id: "assistant-goal-old",
        role: "assistant",
        content: "請確認 2050 kcal。",
        createdAt: "2026-06-14T08:00:00.000Z",
        proposalCard: goalProposalCard("goal-old", 2050, {
          lapseCopy: GOAL_PROPOSAL_EXPIRED_COPY,
        }),
      },
    ]);
    useStore.getState().setProvisionalBubble({
      id: "assistant-goal-new",
      statusLabel: "",
      content: "請確認 1800 kcal。",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({
      didLogMeal: false,
      proposalCard: goalProposalCard("goal-new", 1800, {
        lapseCopy: GOAL_PROPOSAL_EXPIRED_COPY,
      }),
    });

    const [oldMessage] = useStore.getState().messages;
    assert.equal(oldMessage?.proposalCard?.status, "superseded");
    assert.equal(oldMessage?.proposalCard?.lapseCopy, GOAL_PROPOSAL_SUPERSEDED_COPY);
    assert.notEqual(oldMessage?.proposalCard?.lapseCopy, GOAL_PROPOSAL_EXPIRED_COPY);
  });

  it("commitProvisionalBubble deactivates active goal cards when dailyTargets commit without a new proposal", () => {
    useStore.getState().setMessages([
      {
        id: "assistant-goal-old",
        role: "assistant",
        content: "請確認 2050 kcal。",
        createdAt: "2026-06-14T08:00:00.000Z",
        proposalCard: goalProposalCard("goal-old", 2050),
      },
    ]);
    useStore.getState().setProvisionalBubble({
      id: "assistant-update",
      statusLabel: "",
      content: "已更新每日目標。",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({
      didLogMeal: false,
      dailyTargets: { calories: 1800, protein: 125, carbs: 170, fat: 50 },
    });

    const oldMessage = useStore.getState().messages[0];
    assert.equal(oldMessage?.proposalCard?.status, "stale");
    assert.equal(oldMessage?.proposalCard?.isActionable, false);
    assert.equal(useStore.getState().dailyTargets?.calories, 1800);
    assert.equal(
      useStore.getState().messages.some((message) =>
        message.proposalCard?.proposalKind === "goal" &&
        message.proposalCard.status === "active" &&
        message.proposalCard.isActionable
      ),
      false,
    );
  });

  it("commitProvisionalBubble pairs stale goal cards with stale copy even when active cards carry expiry copy", () => {
    useStore.getState().setMessages([
      {
        id: "assistant-goal-old",
        role: "assistant",
        content: "請確認 2050 kcal。",
        createdAt: "2026-06-14T08:00:00.000Z",
        proposalCard: goalProposalCard("goal-old", 2050, {
          lapseCopy: GOAL_PROPOSAL_EXPIRED_COPY,
        }),
      },
    ]);
    useStore.getState().setProvisionalBubble({
      id: "assistant-update",
      statusLabel: "",
      content: "已更新每日目標。",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({
      didLogMeal: false,
      dailyTargets: { calories: 1800, protein: 125, carbs: 170, fat: 50 },
    });

    const oldMessage = useStore.getState().messages[0];
    assert.equal(oldMessage?.proposalCard?.status, "stale");
    assert.equal(oldMessage?.proposalCard?.lapseCopy, GOAL_PROPOSAL_STALE_COPY);
    assert.notEqual(oldMessage?.proposalCard?.lapseCopy, GOAL_PROPOSAL_EXPIRED_COPY);
  });

  it("commitProvisionalBubble finalizes message when malformed authoritative additions are rejected", () => {
    const trustedTargets = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
    useStore.getState().setDailyTargets(trustedTargets);
    const storedTargetsBefore = storage.get("dailyTargets");

    const today = formatLocalDate(new Date());
    useStore.getState().setDailySummary({
      date: today,
      totalCalories: 400,
      totalProtein: 25,
      totalCarbs: 50,
      totalFat: 12,
      mealCount: 1,
    });

    useStore.getState().setProvisionalBubble({
      id: "msg-malformed-authority",
      statusLabel: "",
      content: "已記錄",
      isStreaming: true,
    });

    assert.doesNotThrow(() => {
      useStore.getState().commitProvisionalBubble({
        didLogMeal: true,
        dailyTargets: { calories: 1800, protein: 130, carbs: "200", fat: 60 } as any,
        dailySummary: {
          date: today,
          totalCalories: 999,
          totalProtein: null,
          totalCarbs: 0,
          totalFat: 0,
          mealCount: 1,
        } as any,
      });
    });

    assert.equal(useStore.getState().provisionalBubble, null);
    assert.equal(useStore.getState().messages.length, 1);
    assert.equal(useStore.getState().messages[0].id, "msg-malformed-authority");
    assert.deepEqual(useStore.getState().dailyTargets, trustedTargets);
    assert.equal(storage.get("dailyTargets"), storedTargetsBefore);
    assert.equal(useStore.getState().dailySummary?.totalCalories, 400);
  });

  it("commitProvisionalBubble without dailySummary leaves dailySummary untouched and handler unfired", () => {
    let handlerCallCount = 0;
    useStore.getState().setRolloverRefreshHandler(() => {
      handlerCallCount++;
    });

    useStore.getState().setProvisionalBubble({
      id: "msg-no-summary",
      statusLabel: "",
      content: "好的",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({ didLogMeal: false });

    assert.equal(useStore.getState().provisionalBubble, null);
    assert.equal(useStore.getState().messages.length, 1);
    assert.equal(useStore.getState().dailySummary, null);
    assert.equal(handlerCallCount, 0);
  });
});
