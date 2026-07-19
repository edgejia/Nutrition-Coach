process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import type {
  ChatMessage,
  GenerateObjectRequest,
  GenerateObjectResult,
  LLMProvider,
  LLMResponse,
  LLMRoundResult,
  ToolDefinition,
} from "../../server/llm/types.js";
import type {
  AdmissionDecision,
  AdmissionKind,
  AdmissionLimiter,
  AdmissionSubject,
} from "../../server/services/admission-limiter.js";
import { createRuntimeTurnLifecycle } from "../../server/services/turn-state.js";

class AbortableProvider implements LLMProvider {
  aborted = 0;
  started = Promise.resolve();
  private readonly lateToolResponse: boolean;
  private resolveStarted: () => void = () => {};
  private resolveLateToolResponse: () => void = () => {};

  constructor(lateToolResponse = false) {
    this.lateToolResponse = lateToolResponse;
    this.started = new Promise((resolve) => { this.resolveStarted = resolve; });
  }

  async chat(_messages: ChatMessage[], _tools: ToolDefinition[]): Promise<LLMResponse> {
    return { content: "unused" };
  }

  async chatRound(
    _messages: ChatMessage[],
    _tools: ToolDefinition[],
    opts?: { signal?: AbortSignal },
  ): Promise<LLMRoundResult> {
    this.resolveStarted();
    if (opts?.signal) {
      if (opts.signal.aborted) {
        this.aborted += 1;
      } else {
        opts.signal.addEventListener("abort", () => { this.aborted += 1; }, { once: true });
      }
    }
    if (this.lateToolResponse) {
      await new Promise<void>((resolve) => { this.resolveLateToolResponse = resolve; });
      return {
        kind: "response",
        response: {
          toolCalls: [{
            id: "late-log-food",
            type: "function",
            function: {
              name: "log_food",
              arguments: JSON.stringify({
                items: [{ food_name: "late mutation", calories: 100, protein: 1, carbs: 20, fat: 0.5 }],
              }),
            },
          }],
        },
      };
    }
    return {
      kind: "stream",
      streamGenerator: this.waitForAbort(opts?.signal),
    };
  }

  releaseLateToolResponse() {
    this.resolveLateToolResponse();
  }

  async *waitForAbort(signal?: AbortSignal): AsyncGenerator<string> {
    await new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      signal?.addEventListener("abort", () => {
        this.aborted += 1;
        resolve();
      }, { once: true });
    });
  }

  async generateObject<T>(
    _messages: ChatMessage[],
    _request: GenerateObjectRequest<T>,
  ): Promise<GenerateObjectResult<T>> {
    throw new Error("generateObject unexpectedly called");
  }
}

class CountingAdmissionLimiter implements AdmissionLimiter {
  providerReleaseCount = 0;
  activeProvider = 0;

  tryAcquire(kind: AdmissionKind, subject?: AdmissionSubject): AdmissionDecision {
    let released = false;
    if (kind === "provider") this.activeProvider += 1;
    return {
      ok: true,
      permit: {
        kind,
        subjectKey: subject?.deviceId ?? "phase-127",
        release: () => {
          if (released) return;
          released = true;
          if (kind === "provider") {
            this.providerReleaseCount += 1;
            this.activeProvider -= 1;
          }
        },
      },
    };
  }

  async run<T>(_kind: AdmissionKind, _subject: AdmissionSubject | undefined, work: () => Promise<T>): Promise<T> {
    return work();
  }

  reset() {
    this.providerReleaseCount = 0;
    this.activeProvider = 0;
  }
}

type TestSseTransport = {
  replyRaw: EventEmitter;
  stream: EventEmitter;
  turnId: string;
};

describe("Phase 127 NC-COR-03 chat lifecycle", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let provider: AbortableProvider;
  let limiter: CountingAdmissionLimiter;
  let deviceId: string;
  let cookie: string;
  let transport: TestSseTransport | undefined;
  let disconnected = false;
  let lateFramesAfterDisconnect = 0;
  let summaryPublishes = 0;

  beforeEach(async () => {
    provider = new AbortableProvider(true);
    limiter = new CountingAdmissionLimiter();
    transport = undefined;
    disconnected = false;
    lateFramesAfterDisconnect = 0;
    summaryPublishes = 0;
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: provider,
      admissionLimiter: limiter,
      chatLifecycleTestHooks: {
        onSseTransportReady: (ready) => {
          transport = ready;
          ready.stream.on("data", (chunk: Buffer) => {
            if (disconnected && /event: (status|chunk|done|stopped)/.test(chunk.toString())) {
              lateFramesAfterDisconnect += 1;
            }
          });
        },
      },
      onServicesReady: (ready) => { services = ready; },
    });
    const created = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = created.json().deviceId;
    const rawCookie = created.headers["set-cookie"];
    cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie ?? "").split(";", 1)[0];
    limiter.reset();
    const originalPublish = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      summaryPublishes += 1;
      return originalPublish(publishDeviceId, payload);
    };
  });

  afterEach(async () => {
    await app.close();
  });

  it("transitions stop and disconnect exactly once without conflating them", () => {
    const lifecycle = createRuntimeTurnLifecycle("turn-127");
    assert.equal(lifecycle.state, "active");
    assert.equal(lifecycle.requestStop(), true);
    assert.equal(lifecycle.requestStop(), false);
    assert.equal(lifecycle.disconnect(), false);
    assert.equal(lifecycle.state, "stopped");

    const disconnected = createRuntimeTurnLifecycle("turn-128");
    assert.equal(disconnected.disconnect(), true);
    assert.equal(disconnected.disconnect(), false);
    assert.equal(disconnected.requestStop(), false);
    assert.equal(disconnected.state, "disconnected");
    assert.equal(disconnected.controller.signal.aborted, true);
  });

  it("coalesces response/stream close and error signals into one cleanup", () => {
    const lifecycle = createRuntimeTurnLifecycle("turn-129");
    let cleanupCount = 0;
    const transportSignals = ["request-close", "response-close", "stream-close", "stream-error"];
    const transitions = transportSignals.map(() => lifecycle.disconnect());
    assert.deepEqual(transitions, [true, false, false, false]);
    assert.equal(lifecycle.cleanupOnce(() => { cleanupCount += 1; }), true);
    assert.equal(lifecycle.cleanupOnce(() => { cleanupCount += 1; }), false);
    assert.equal(cleanupCount, 1);
  });

  it("cancels a real fetch reader against the wired route and aborts the provider", async () => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const form = new FormData();
    form.append("message", "請給我飲食建議");
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const response = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie, accept: "text/event-stream" },
        body: form,
      });
      assert.ok(response.body);
      reader = response.body.getReader();
      await provider.started;
      const first = await reader.read();
      assert.equal(first.done, false);
      await reader.cancel();
      disconnected = true;

      const deadline = Date.now() + 1000;
      while (provider.aborted < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(provider.aborted, 1);
      assert.equal(limiter.providerReleaseCount, 1);
      assert.equal(limiter.activeProvider, 0);

      const stopResponse = await fetch(`${address}/api/chat/stop`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ turnId: transport?.turnId }),
      });
      assert.equal(stopResponse.status, 404);

      provider.releaseLateToolResponse();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const assistantCount = services.db.$client
        .prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE device_id = ? AND role = 'assistant'")
        .get(deviceId) as { count: number };
      assert.equal(assistantCount.count, 0);
      const toolCount = services.db.$client
        .prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE device_id = ? AND role = 'tool'")
        .get(deviceId) as { count: number };
      assert.equal(toolCount.count, 0);
      const mealCount = services.db.$client
        .prepare("SELECT COUNT(*) AS count FROM meal_transactions WHERE device_id = ?")
        .get(deviceId) as { count: number };
      assert.equal(mealCount.count, 0);
      const stoppedCount = services.db.$client
        .prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE device_id = ? AND status = 'stopped'")
        .get(deviceId) as { count: number };
      assert.equal(stoppedCount.count, 0);
      assert.equal(summaryPublishes, 0);
      assert.equal(lateFramesAfterDisconnect, 0);
    } finally {
      await reader?.cancel().catch(() => {});
      await app.close();
    }
  });

  it("coalesces wired response and PassThrough close/error into one disconnect cleanup", async () => {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    let response: Response | undefined;
    try {
      const form = new FormData();
      form.append("message", "請記錄這個不應發生的餐點");
      response = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie, accept: "text/event-stream" },
        body: form,
      });
      assert.ok(response.body);
      await provider.started;
      assert.ok(transport);

      transport.replyRaw.emit("close");
      transport.stream.emit("close");
      transport.stream.emit("error", new Error("phase-127 transport probe"));
      disconnected = true;

      const deadline = Date.now() + 1000;
      while (provider.aborted < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(provider.aborted, 1);
      assert.equal(limiter.providerReleaseCount, 1);
      assert.equal(limiter.activeProvider, 0);
      provider.releaseLateToolResponse();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const stopResponse = await fetch(`${address}/api/chat/stop`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ turnId: transport.turnId }),
      });
      assert.equal(stopResponse.status, 404);
      assert.equal(lateFramesAfterDisconnect, 0);
      assert.equal(summaryPublishes, 0);
    } finally {
      await response?.body?.cancel().catch(() => {});
      await app.close();
    }
  });
});
