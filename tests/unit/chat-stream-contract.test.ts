import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

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
      'event: done\ndata: {"didLogMeal":true,"loggedMeal":{"foodName":"雞胸肉沙拉","calories":420,"protein":32,"carbs":14,"fat":22}}\n\n',
    ]);

    let donePayload:
      | {
          didLogMeal: boolean;
          loggedMeal?: { foodName: string; calories: number; protein: number; carbs: number; fat: number };
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

  it("commitProvisionalBubble preserves loggedMeal on final assistant message", () => {
    useStore.getState().setProvisionalBubble({
      id: "bubble-1",
      statusLabel: "",
      content: "已記錄",
      isStreaming: true,
    });

    useStore.getState().commitProvisionalBubble({
      didLogMeal: true,
      loggedMeal: { foodName: "雞胸肉沙拉", calories: 420, protein: 32, carbs: 14, fat: 22 },
    });

    const message = useStore.getState().messages[0];
    assert.equal(message?.didLogMeal === true, true);
    assert.equal(message?.loggedMeal?.foodName, "雞胸肉沙拉");
  });
});
