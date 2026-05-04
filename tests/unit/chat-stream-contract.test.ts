import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
} as Storage;

const originalFetch = globalThis.fetch;

const root = fileURLToPath(new URL("../..", import.meta.url));

async function readSource(path: string) {
  return readFile(`${root}/${path}`, "utf8");
}

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function mockStreamFetch(chunks: string[]) {
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    body: makeSSEStream(chunks),
    headers: new Headers({ "content-type": "text/event-stream" }),
  }) as Response) as typeof fetch;
}

const { sendMessageStream } = await import("../../client/src/api.js");
const { useStore } = await import("../../client/src/store.js");

describe("chat stream contract", () => {
  beforeEach(() => {
    storage.clear();
    useStore.setState({
      messages: [],
      dailySummary: null,
      provisionalBubble: null,
      guestSessionStatus: "ready",
      guestSessionRecoveryAttempted: false,
    });
    useStore.getState().setRolloverRefreshHandler(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sendMessageStream passes valid loggedMeal from event: done to onDone", async () => {
    mockStreamFetch([
      'event: done\ndata: {"didLogMeal":true,"loggedMeal":{"foodName":"雞胸肉沙拉","calories":420,"protein":32,"carbs":14,"fat":22,"mealId":"meal-1","dateKey":"2026-03-25","loggedAt":"2026-03-25T12:00:00.000Z","imageAssetId":null,"imageUrl":null}}\n\n',
    ]);

    let donePayload:
      | {
          didLogMeal: boolean;
          loggedMeal?: {
            foodName: string;
            calories: number;
            protein: number;
            carbs: number;
            fat: number;
            mealId?: string;
            dateKey?: string;
            loggedAt?: string;
            imageAssetId?: string | null;
            imageUrl?: string | null;
          };
        }
      | undefined;

    await sendMessageStream("我吃了雞胸肉沙拉", {
      onStatus: () => undefined,
      onToken: () => undefined,
      onDone: (data) => {
        donePayload = data;
      },
      onError: (message) => {
        throw new Error(message);
      },
    });

    assert.equal(donePayload?.didLogMeal, true);
    assert.equal(donePayload?.loggedMeal?.foodName, "雞胸肉沙拉");
    assert.equal(donePayload?.loggedMeal?.protein, 32);
    assert.equal(donePayload?.loggedMeal?.mealId, "meal-1");
    assert.equal(donePayload?.loggedMeal?.dateKey, "2026-03-25");
    assert.equal(donePayload?.loggedMeal?.loggedAt, "2026-03-25T12:00:00.000Z");
    assert.equal(donePayload?.loggedMeal?.imageAssetId, null);
    assert.equal(donePayload?.loggedMeal?.imageUrl, null);
  });

  it("sendMessageStream ignores malformed loggedMeal payloads", async () => {
    mockStreamFetch([
      'event: done\ndata: {"didLogMeal":true,"loggedMeal":{"foodName":"雞胸肉沙拉","calories":420,"protein":32}}\n\n',
    ]);

    let donePayload: { didLogMeal: boolean; loggedMeal?: unknown } | undefined;

    await sendMessageStream("partial", {
      onStatus: () => undefined,
      onToken: () => undefined,
      onDone: (data) => {
        donePayload = data;
      },
      onError: (message) => {
        throw new Error(message);
      },
    });

    assert.equal(donePayload?.didLogMeal, true);
    assert.equal(donePayload?.loggedMeal, undefined);
  });

  it("sendMessageStream exposes turnId status metadata and parses event: stopped as terminal", async () => {
    mockStreamFetch([
      'event: status\ndata: {"label":"思考中...","turnId":"turn-1"}\n\n',
      'event: chunk\ndata: {"token":"已"}\n\n',
      'event: stopped\ndata: {"stopped":true,"turnId":"turn-1","tokensStreamed":1,"didLogMeal":true,"didMutateMeal":true,"loggedMeal":{"foodName":"雞腿便當","calories":720,"protein":42,"carbs":80,"fat":24,"mealId":"meal-1","dateKey":"2026-05-05","loggedAt":"2026-05-05T04:00:00.000Z","imageAssetId":null,"imageUrl":null},"dailySummary":{"date":"2026-05-05","totalCalories":720,"totalProtein":42,"totalCarbs":80,"totalFat":24,"mealCount":1},"dailyTargets":{"calories":1800,"protein":130,"carbs":150,"fat":50},"affectedDate":"2026-05-05"}\n\n',
    ]);

    const turnIds: string[] = [];
    const tokens: string[] = [];
    let stoppedPayload:
      | {
          stopped: true;
          turnId?: string;
          tokensStreamed: number;
          didLogMeal?: boolean;
          didMutateMeal?: boolean;
          loggedMeal?: { foodName: string };
          dailySummary?: { date: string };
          dailyTargets?: { calories: number };
          affectedDate?: string;
        }
      | undefined;
    let doneCalled = false;
    const errors: string[] = [];

    await sendMessageStream("stop please", {
      onTurnStart: (turnId) => turnIds.push(turnId),
      onStatus: () => undefined,
      onToken: (token) => tokens.push(token),
      onDone: () => {
        doneCalled = true;
      },
      onStopped: (data) => {
        stoppedPayload = data;
      },
      onError: (message) => errors.push(message),
    });

    assert.deepEqual(turnIds, ["turn-1"]);
    assert.deepEqual(tokens, ["已"]);
    assert.equal(doneCalled, false);
    assert.deepEqual(errors, []);
    assert.equal(stoppedPayload?.stopped, true);
    assert.equal(stoppedPayload?.turnId, "turn-1");
    assert.equal(stoppedPayload?.tokensStreamed, 1);
    assert.equal(stoppedPayload?.didLogMeal, true);
    assert.equal(stoppedPayload?.didMutateMeal, true);
    assert.equal(stoppedPayload?.loggedMeal?.foodName, "雞腿便當");
    assert.equal(stoppedPayload?.dailySummary?.date, "2026-05-05");
    assert.equal(stoppedPayload?.dailyTargets?.calories, 1800);
    assert.equal(stoppedPayload?.affectedDate, "2026-05-05");
  });

  it("sendMessageStream rejects malformed loggedMeal optional identity fields", async () => {
    mockStreamFetch([
      'event: done\ndata: {"didLogMeal":true,"loggedMeal":{"foodName":"雞胸肉沙拉","calories":420,"protein":32,"carbs":14,"fat":22,"mealId":42,"dateKey":"2026-03-25","loggedAt":"2026-03-25T12:00:00.000Z"}}\n\n',
    ]);

    let donePayload: { didLogMeal: boolean; loggedMeal?: unknown } | undefined;

    await sendMessageStream("bad optional", {
      onStatus: () => undefined,
      onToken: () => undefined,
      onDone: (data) => {
        donePayload = data;
      },
      onError: (message) => {
        throw new Error(message);
      },
    });

    assert.equal(donePayload?.didLogMeal, true);
    assert.equal(donePayload?.loggedMeal, undefined);
  });

  it("commitProvisionalBubble preserves loggedMeal on final assistant message", () => {
    useStore.getState().setProvisionalBubble({
      id: "bubble-1",
      statusLabel: "",
      content: "已記錄",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({
      didLogMeal: true,
      loggedMeal: {
        foodName: "雞胸肉沙拉",
        calories: 420,
        protein: 32,
        carbs: 14,
        fat: 22,
        mealId: "meal-1",
        dateKey: "2026-03-25",
        loggedAt: "2026-03-25T12:00:00.000Z",
        imageAssetId: null,
        imageUrl: null,
      },
    });

    const message = useStore.getState().messages[0];
    assert.equal(message?.didLogMeal === true, true);
    assert.equal(message?.loggedMeal?.foodName, "雞胸肉沙拉");
    assert.equal(message?.loggedMeal?.mealId, "meal-1");
    assert.equal(message?.loggedMeal?.dateKey, "2026-03-25");
  });

  it("commitStoppedProvisionalBubble preserves partial text, stopped marker, receipt, and summary extras", () => {
    useStore.getState().setProvisionalBubble({
      id: "bubble-stopped",
      statusLabel: "",
      content: "已記錄",
      isStreaming: true,
    });

    useStore.getState().commitStoppedProvisionalBubble({
      loggedMeal: {
        foodName: "雞腿便當",
        calories: 720,
        protein: 42,
        carbs: 80,
        fat: 24,
        mealId: "meal-1",
        dateKey: "2026-05-05",
        loggedAt: "2026-05-05T04:00:00.000Z",
        imageAssetId: null,
        imageUrl: null,
      },
      dailySummary: {
        date: "2026-05-05",
        totalCalories: 720,
        totalProtein: 42,
        totalCarbs: 80,
        totalFat: 24,
        mealCount: 1,
      },
    });

    const message = useStore.getState().messages[0];
    assert.equal(message?.status, "stopped");
    assert.equal(message?.content, "已記錄\n\n已停止");
    assert.equal(message?.loggedMeal?.foodName, "雞腿便當");
    assert.equal(useStore.getState().dailySummary?.totalCalories, 720);
    assert.equal(useStore.getState().provisionalBubble, null);
  });

  it("commitStoppedProvisionalBubble uses empty stopped copy when no text streamed", () => {
    useStore.getState().setProvisionalBubble({
      id: "bubble-empty-stopped",
      statusLabel: "",
      content: "",
      isStreaming: true,
    });

    useStore.getState().commitStoppedProvisionalBubble({});

    const message = useStore.getState().messages[0];
    assert.equal(message?.status, "stopped");
    assert.equal(message?.content, "已停止，沒有產生新的回覆。");
  });

  it("clears unauthorized Chat sends out of the provisional sending state", async () => {
    const chatPanel = await readSource("client/src/components/ChatPanel.tsx");
    const unauthorizedBranches = [...chatPanel.matchAll(/if \(err instanceof Error && err\.message === "UNAUTHORIZED"\) \{([\s\S]*?)\n\s*return;\n\s*\}/g)];
    const branchSource = unauthorizedBranches
      .map((match) => match[1] ?? "")
      .find((source) => source.includes("setProvisionalBubble(null)"));

    assert.ok(branchSource, "ChatPanel should keep an explicit chat-send UNAUTHORIZED branch");
    assert.match(branchSource, /setProvisionalBubble\(null\)/);
    assert.match(branchSource, /setSending\(false\)/);
    assert.match(branchSource, /recoverGuestSession\(\)/);
  });
});
