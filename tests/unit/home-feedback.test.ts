import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

const { getDisplayedCoachAdvice, formatHomeHeaderDate, stageHomeTaskOptionPrompt, sendHomeCtaTaskOption } = await import(
  "../../client/src/components/HomeScreen.js"
);
const { recordHomeCtaIntentSelected, recordHomeCtaOptionSent } = await import("../../client/src/api.js");

function installFetchStub(handler: typeof fetch) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = previousFetch;
  };
}

describe("Home screen helpers", () => {
  it("prefers freshly derived coach advice over stale stored advice", () => {
    const advice = getDisplayedCoachAdvice(
      "昨天的舊建議",
      {
        date: "2026-04-01",
        totalCalories: 900,
        totalProtein: 40,
        totalCarbs: 80,
        totalFat: 20,
        mealCount: 2,
      },
      { calories: 1800, protein: 140, carbs: 180, fat: 60 },
    );

    assert.equal(advice, "蛋白質還差 100g，晚餐建議高蛋白食物");
  });

  it("formats HomeHeader date keys with the existing zh-TW month/day/weekday style", () => {
    const expected = new Date(2026, 2, 25).toLocaleDateString("zh-TW", {
      month: "long",
      day: "numeric",
      weekday: "short",
    });

    assert.equal(formatHomeHeaderDate("2026-03-25"), expected);
  });

  it("falls back to today's local date when HomeHeader date key is malformed", () => {
    const today = new Date();
    const expected = today.toLocaleDateString("zh-TW", {
      month: "long",
      day: "numeric",
      weekday: "short",
    });

    assert.equal(formatHomeHeaderDate("not-a-date"), expected);
  });

  it("stages a second-layer task option prompt and switches to chat", () => {
    const staged: unknown[] = [];
    const screens: string[] = [];

    stageHomeTaskOptionPrompt(
      "推薦三個便利商店高蛋白選擇",
      (draft) => staged.push(draft),
      (screen) => screens.push(screen),
      () => "task-option-1",
    );

    assert.deepEqual(staged, [
      {
        id: "task-option-1",
        text: "推薦三個便利商店高蛋白選擇",
        status: "staged",
      },
    ]);
    assert.deepEqual(screens, ["chat"]);
  });

  it("posts redacted Home CTA intent selection events", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const restoreFetch = installFetchStub(async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(null, { status: 204 });
    });

    try {
      await recordHomeCtaIntentSelected("protein");
    } finally {
      restoreFetch();
    }

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, "/api/observability/client-event");
    assert.equal(requests[0]?.init.method, "POST");
    assert.equal(requests[0]?.init.credentials, "same-origin");
    assert.deepEqual(requests[0]?.init.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(String(requests[0]?.init.body)), {
      event: "home_cta_intent_selected",
      intent: "protein",
    });
  });

  it("posts redacted Home CTA option events without prompt text", async () => {
    const rawPrompt = "推薦三個便利商店高蛋白選擇";
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const restoreFetch = installFetchStub(async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      return new Response(null, { status: 204 });
    });

    try {
      await recordHomeCtaOptionSent("protein", "protein-convenience-store");
    } finally {
      restoreFetch();
    }

    const body = String(requests[0]?.init.body);
    assert.deepEqual(JSON.parse(body), {
      event: "home_cta_option_sent",
      intent: "protein",
      promptKey: "protein-convenience-store",
    });
    assert.doesNotMatch(body, /prompt"/);
    assert.doesNotMatch(body, new RegExp(rawPrompt));
  });

  it("swallows failed Home CTA observability posts", async () => {
    const restoreFetch = installFetchStub(async () => new Response(null, { status: 500 }));

    try {
      await assert.doesNotReject(recordHomeCtaOptionSent("next_meal", "next-meal-eating-out"));
    } finally {
      restoreFetch();
    }

    const restoreRejectedFetch = installFetchStub(async () => {
      throw new Error("network unavailable");
    });

    try {
      await assert.doesNotReject(recordHomeCtaIntentSelected("food_logging"));
    } finally {
      restoreRejectedFetch();
    }
  });

  it("records second-layer task option IDs while preserving prompt handoff", () => {
    const rawPrompt = "推薦三個便利商店高蛋白選擇";
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const staged: unknown[] = [];
    const screens: string[] = [];
    const restoreFetch = installFetchStub(async (input, init) => {
      requests.push({ url: String(input), init: init ?? {} });
      throw new Error("observability unavailable");
    });

    try {
      sendHomeCtaTaskOption(
        {
          id: "protein-convenience-store",
          label: rawPrompt,
          prompt: rawPrompt,
        },
        {
          id: "protein",
          label: "補蛋白質",
          options: [],
        },
        (draft) => staged.push(draft),
        (screen) => screens.push(screen),
        () => "task-option-2",
      );
    } finally {
      restoreFetch();
    }

    assert.equal(requests.length, 1);
    const body = String(requests[0]?.init.body);
    assert.deepEqual(JSON.parse(body), {
      event: "home_cta_option_sent",
      intent: "protein",
      promptKey: "protein-convenience-store",
    });
    assert.doesNotMatch(body, new RegExp(rawPrompt));
    assert.deepEqual(staged, [
      {
        id: "task-option-2",
        text: rawPrompt,
        status: "staged",
      },
    ]);
    assert.deepEqual(screens, ["chat"]);
  });
});
