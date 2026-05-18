/**
 * Deterministic text logging replay scenario for the verification harness.
 *
 * Satisfies VERI-01: proves the full text logging chain end-to-end through real
 * HTTP and SSE calls without live-model access.
 *
 * Steps:
 *   1. bootstrap       — verify the seeded app is responsive
 *   2. subscribe_summary — open /api/sse and collect the initial daily_summary
 *   3. post_chat       — POST multipart text-only to /api/chat with Accept: text/event-stream
 *   4. collect_stream  — read SSE frames until event: done, verify didLogMeal === true
 *   5. verify_history  — GET /api/chat/history, verify last assistant message content
 *   6. verify_meals    — GET /api/meals, verify logged meal calories === 95
 *   7. verify_summary  — verify dailySummary from done payload has mealCount === 1
 */

import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../scenario-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailySummary {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  mealCount: number;
}

interface DailySummaryEnvelope {
  summary?: DailySummary;
  affectedDate?: string;
  source?: "initial" | "meal_mutation";
}

interface MealRecord {
  id: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
}

interface ChatMessage {
  role: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function pass(name: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function fail(name: string, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

/**
 * Build the failure result for the entire scenario when a step fails.
 * Records all completed steps, the failed step, and marks the rest as not reached.
 */
function failResult(
  scenarioName: string,
  steps: ScenarioStepResult[],
  failedStepName: string,
  artifacts: Record<string, unknown>,
  llmTrace?: Record<string, unknown>,
): ScenarioResult {
  const totalSteps = STEP_NAMES.length;
  const passedSteps = steps.filter((s) => s.ok).length;
  const result: ScenarioResult = {
    ok: false,
    failedStep: failedStepName,
    steps,
    artifacts,
    consoleSummary: `FAIL ${scenarioName} ${failedStepName}`,
  };
  if (llmTrace !== undefined) {
    result.llmTrace = llmTrace;
  }
  return result;
}

const STEP_NAMES = [
  "bootstrap",
  "subscribe_summary",
  "post_chat",
  "collect_stream",
  "verify_history",
  "verify_meals",
  "verify_summary",
  "verify_llm_trace",
] as const;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const USER_INPUT_TEXT = "我吃了蘋果";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Expected ${name} to be an object`);
  }
  return value;
}

function parseDailySummaryFrame(data: string): DailySummary {
  const parsed = JSON.parse(data) as DailySummary | DailySummaryEnvelope;
  if ("summary" in parsed && parsed.summary) {
    return parsed.summary;
  }
  return parsed as DailySummary;
}

// ---------------------------------------------------------------------------
// Scenario implementation
// ---------------------------------------------------------------------------

const textLogScenario: VerificationScenario = {
  name: "text-log",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    // _ctx is provided by run.ts but unused here: the scenario creates its own fixture
    // with an explicitly controlled StreamingLLMProvider so it can queue deterministic
    // LLM responses. run.ts will close its own ctx in the finally block separately.
    const scenarioName = "text-log";
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    let llmTrace: Record<string, unknown> | undefined;
    let finalAssistantContent: string | undefined;
    let streamedReplyText = "";

    // Create our own app fixture with a controlled LLM provider.
    const { createScenarioApp } = await import("../app-fixture.js");
    const provider = new StreamingLLMProvider();
    const recorder = createLlmTraceRecorder();
    const buildTrace = (status: "pass" | "fail"): Record<string, unknown> => {
      return recorder.build({ scenario: scenarioName, status }) as unknown as Record<string, unknown>;
    };
    const failScenario = (failedStepName: string): ScenarioResult => {
      return failResult(scenarioName, steps, failedStepName, artifacts, buildTrace("fail"));
    };

    // Round 1: log_food tool call
    provider.queueRoundResponse({
      toolCalls: [
        {
          id: "call_text_log_1",
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              food_name: "蘋果",
              calories: 95,
              protein: 0.5,
              carbs: 25,
              fat: 0.3,
            }),
          },
        },
      ],
    });
    const fixture = await createScenarioApp({
      llmProvider: provider,
      llmTraceRecorderFactory: () => recorder,
    });

    try {
      // ------------------------------------------------------------------
      // Step 1: bootstrap
      // ------------------------------------------------------------------
      try {
        const pingRes = await fetch(`${fixture.address}/api/meals`, {
          headers: { cookie: fixture.cookieHeader },
        });
        if (pingRes.status !== 200) {
          const stepResult = fail("bootstrap", `Expected 200 from /api/meals, got ${pingRes.status}`);
          steps.push(stepResult);
          return failScenario("bootstrap");
        }
        steps.push(pass("bootstrap", { status: pingRes.status }));
      } catch (err) {
        const stepResult = fail("bootstrap", err instanceof Error ? err.message : String(err));
        steps.push(stepResult);
        return failScenario("bootstrap");
      }

      // ------------------------------------------------------------------
      // Step 2: subscribe_summary — open /api/sse before posting chat
      // ------------------------------------------------------------------
      let sseController: AbortController | undefined;
      let sseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let sseCollectedText = "";

      try {
        sseController = new AbortController();
        // Use a short timeout for the SSE fetch — we only need to collect the second event
        const sseTimeout = setTimeout(() => sseController!.abort(), 5000);

        const sseRes = await fetch(
          `${fixture.address}/api/sse`,
          {
            headers: { cookie: fixture.cookieHeader, Accept: "text/event-stream" },
            signal: sseController.signal,
          },
        );

        if (sseRes.status !== 200) {
          clearTimeout(sseTimeout);
          const stepResult = fail(
            "subscribe_summary",
            `Expected 200 from /api/sse, got ${sseRes.status}`,
          );
          steps.push(stepResult);
          return failScenario("subscribe_summary");
        }

        if (!sseRes.body) {
          clearTimeout(sseTimeout);
          const stepResult = fail("subscribe_summary", "SSE response has no body");
          steps.push(stepResult);
          return failScenario("subscribe_summary");
        }

        sseReader = sseRes.body.getReader();

        // Collect the initial daily_summary event
        const initialText = await readStreamUntilEvent(sseReader, "daily_summary", 20);
        sseCollectedText = initialText;

        const initialEvents = parseSSEEvents(initialText);
        const initialSummaryEvent = initialEvents.find((e) => e.event === "daily_summary");

        if (!initialSummaryEvent) {
          clearTimeout(sseTimeout);
          const stepResult = fail("subscribe_summary", "Did not receive initial daily_summary event from /api/sse");
          steps.push(stepResult);
          return failScenario("subscribe_summary");
        }

        let initialSummary: DailySummary | undefined;
        try {
          initialSummary = parseDailySummaryFrame(initialSummaryEvent.data);
        } catch {
          clearTimeout(sseTimeout);
          const stepResult = fail("subscribe_summary", "Failed to parse initial daily_summary JSON");
          steps.push(stepResult);
          return failScenario("subscribe_summary");
        }

        artifacts.initialSummary = initialSummary;
        steps.push(pass("subscribe_summary", { initialSummary }));

        // Store timeout for cleanup — we'll clear it after collecting the second event
        // Keep the reader open; we'll read more after chat completes
        (sseController as AbortController & { _timeout?: ReturnType<typeof setTimeout> })._timeout = sseTimeout;
      } catch (err) {
        if (sseController && !sseController.signal.aborted) {
          sseController.abort();
        }
        const stepResult = fail(
          "subscribe_summary",
          err instanceof Error ? err.message : String(err),
        );
        steps.push(stepResult);
        return failScenario("subscribe_summary");
      }

      // ------------------------------------------------------------------
      // Step 3: post_chat — multipart text-only POST with Accept: text/event-stream
      // ------------------------------------------------------------------
      let chatRes: Response | undefined;
      let chatController: AbortController | undefined;

      try {
        chatController = new AbortController();
        const chatTimeout = setTimeout(() => chatController!.abort(), 5000);

        const form = new FormData();
        form.append("message", USER_INPUT_TEXT);

        chatRes = await fetch(`${fixture.address}/api/chat`, {
          method: "POST",
          headers: {
            cookie: fixture.cookieHeader,
            Accept: "text/event-stream",
          },
          signal: chatController.signal,
          body: form,
        });

        clearTimeout(chatTimeout);

        if (chatRes.status !== 200) {
          const stepResult = fail(
            "post_chat",
            `Expected 200 from /api/chat, got ${chatRes.status}`,
            { status: chatRes.status },
          );
          steps.push(stepResult);
          return failScenario("post_chat");
        }

        const contentType = chatRes.headers.get("content-type") ?? "";
        if (!contentType.includes("text/event-stream")) {
          const stepResult = fail(
            "post_chat",
            `Expected content-type: text/event-stream, got ${contentType}`,
            { contentType },
          );
          steps.push(stepResult);
          return failScenario("post_chat");
        }

        steps.push(pass("post_chat", { status: chatRes.status, contentType }));
      } catch (err) {
        if (chatController && !chatController.signal.aborted) {
          chatController.abort();
        }
        const stepResult = fail(
          "post_chat",
          err instanceof Error ? err.message : String(err),
        );
        steps.push(stepResult);
        return failScenario("post_chat");
      }

      // ------------------------------------------------------------------
      // Step 4: collect_stream — read SSE frames until event: done
      // ------------------------------------------------------------------
      let donePayload: { didLogMeal: boolean; dailySummary?: DailySummary } | undefined;
      let streamFrames: Array<{ event: string; data: string }> = [];

      try {
        if (!chatRes.body) {
          const stepResult = fail("collect_stream", "Chat response has no body");
          steps.push(stepResult);
          return failScenario("collect_stream");
        }

        const streamReader = chatRes.body.getReader();
        const streamText = await readStreamUntilEvent(streamReader, "done", 60);

        streamFrames = parseSSEEvents(streamText);
        artifacts.streamFrames = streamFrames;
        streamedReplyText = streamFrames
          .filter((event) => event.event === "chunk")
          .map((event) => {
            try {
              const parsed = JSON.parse(event.data) as { token?: unknown };
              return typeof parsed.token === "string" ? parsed.token : "";
            } catch {
              return "";
            }
          })
          .join("");

        const doneEvent = streamFrames.find((e) => e.event === "done");
        if (!doneEvent) {
          const stepResult = fail("collect_stream", "Stream ended without event: done", {
            frames: streamFrames,
          });
          steps.push(stepResult);
          return failScenario("collect_stream");
        }

        try {
          donePayload = JSON.parse(doneEvent.data) as {
            didLogMeal: boolean;
            dailySummary?: DailySummary;
          };
        } catch {
          const stepResult = fail("collect_stream", "Failed to parse done event JSON", {
            doneData: doneEvent.data,
          });
          steps.push(stepResult);
          return failScenario("collect_stream");
        }

        if (!donePayload.didLogMeal) {
          const stepResult = fail("collect_stream", `Expected didLogMeal === true, got ${String(donePayload.didLogMeal)}`, {
            donePayload,
          });
          steps.push(stepResult);
          return failScenario("collect_stream");
        }

        const hasChunk = streamFrames.some((e) => e.event === "chunk");
        if (!hasChunk) {
          const stepResult = fail("collect_stream", "Expected at least one event: chunk in stream", {
            frames: streamFrames,
          });
          steps.push(stepResult);
          return failScenario("collect_stream");
        }

        artifacts.donePayload = donePayload;
        steps.push(pass("collect_stream", { donePayload, frameCount: streamFrames.length }));
      } catch (err) {
        const stepResult = fail(
          "collect_stream",
          err instanceof Error ? err.message : String(err),
        );
        steps.push(stepResult);
        return failScenario("collect_stream");
      }

      // ------------------------------------------------------------------
      // Step 5: verify_history — last assistant entry persisted
      // ------------------------------------------------------------------
      try {
        const historyRes = await fetch(
          `${fixture.address}/api/chat/history?limit=10`,
          { headers: { cookie: fixture.cookieHeader } },
        );

        if (historyRes.status !== 200) {
          const stepResult = fail(
            "verify_history",
            `Expected 200 from /api/chat/history, got ${historyRes.status}`,
          );
          steps.push(stepResult);
          return failScenario("verify_history");
        }

        const historyJson = await historyRes.json() as { messages: ChatMessage[] };
        const messages = historyJson.messages;
        const lastMessage = messages[messages.length - 1];

        artifacts.historySnapshot = messages;
        finalAssistantContent = lastMessage?.role === "assistant" ? lastMessage.content : undefined;

        if (lastMessage?.role !== "assistant") {
          const stepResult = fail(
            "verify_history",
            `Expected last message role === "assistant", got "${lastMessage?.role}"`,
            { lastMessage },
          );
          steps.push(stepResult);
          return failScenario("verify_history");
        }

        if (!/已記錄蘋果/.test(lastMessage.content) || !/蛋白質 0 g/.test(lastMessage.content)) {
          const stepResult = fail(
            "verify_history",
            `Expected projected successful log receipt, got "${lastMessage.content}"`,
            { lastMessage },
          );
          steps.push(stepResult);
          return failScenario("verify_history");
        }

        steps.push(pass("verify_history", { lastMessage }));
      } catch (err) {
        const stepResult = fail(
          "verify_history",
          err instanceof Error ? err.message : String(err),
        );
        steps.push(stepResult);
        return failScenario("verify_history");
      }

      // ------------------------------------------------------------------
      // Step 6: verify_meals — logged meal has expected calories
      // ------------------------------------------------------------------
      try {
        const mealsRes = await fetch(`${fixture.address}/api/meals`, {
          headers: { cookie: fixture.cookieHeader },
        });

        if (mealsRes.status !== 200) {
          const stepResult = fail(
            "verify_meals",
            `Expected 200 from /api/meals, got ${mealsRes.status}`,
          );
          steps.push(stepResult);
          return failScenario("verify_meals");
        }

        const mealsJson = await mealsRes.json() as { meals: MealRecord[] };
        const meals = mealsJson.meals;

        artifacts.mealsSnapshot = meals;

        if (meals.length === 0) {
          const stepResult = fail("verify_meals", "Expected at least one meal, got 0", { meals });
          steps.push(stepResult);
          return failScenario("verify_meals");
        }

        const appleMeal = meals.find((m) => m.foodName === "蘋果");
        if (!appleMeal) {
          const stepResult = fail(
            "verify_meals",
            `Expected a meal with foodName "蘋果", got: ${meals.map((m) => m.foodName).join(", ")}`,
            { meals },
          );
          steps.push(stepResult);
          return failScenario("verify_meals");
        }

        if (appleMeal.calories !== 95) {
          const stepResult = fail(
            "verify_meals",
            `Expected apple calories === 95, got ${appleMeal.calories}`,
            { appleMeal },
          );
          steps.push(stepResult);
          return failScenario("verify_meals");
        }

        steps.push(pass("verify_meals", { appleMeal }));
      } catch (err) {
        const stepResult = fail(
          "verify_meals",
          err instanceof Error ? err.message : String(err),
        );
        steps.push(stepResult);
        return failScenario("verify_meals");
      }

      // ------------------------------------------------------------------
      // Step 7: verify_summary — dailySummary from done payload has mealCount === 1
      // ------------------------------------------------------------------
      try {
        // Collect the second daily_summary event that was pushed after log_food succeeded.
        // The SSE reader is still open; read a bit more to catch the update.
        // The publisher pushes after the meal is logged, which happens before event: done.
        let updatedSummary: DailySummary | undefined;

        if (sseReader) {
          try {
            const moreText = await readStreamUntilEvent(sseReader, "daily_summary", 20);
            sseCollectedText += moreText;
            const allSseEvents = parseSSEEvents(sseCollectedText);
            const summaryEvents = allSseEvents.filter((e) => e.event === "daily_summary");
            artifacts.sseEvents = allSseEvents;

            if (summaryEvents.length >= 2) {
              // Second summary event is the post-meal update
              const secondSummaryEvent = summaryEvents[summaryEvents.length - 1];
              if (secondSummaryEvent) {
                try {
                  updatedSummary = parseDailySummaryFrame(secondSummaryEvent.data);
                } catch {
                  // fall through to donePayload.dailySummary
                }
              }
            }
          } catch {
            // SSE reader may have been aborted — fall through to donePayload
          } finally {
            // Abort SSE connection
            if (sseController) {
              const ctrl = sseController as AbortController & { _timeout?: ReturnType<typeof setTimeout> };
              if (ctrl._timeout) {
                clearTimeout(ctrl._timeout);
              }
              if (!sseController.signal.aborted) {
                sseController.abort();
              }
            }
          }
        }

        // Fall back to dailySummary from the done event payload
        const summaryToVerify = updatedSummary ?? donePayload?.dailySummary;
        artifacts.dailySummary = summaryToVerify;

        if (!summaryToVerify) {
          const stepResult = fail(
            "verify_summary",
            "No dailySummary available from SSE or done payload",
            { donePayload },
          );
          steps.push(stepResult);
          return failScenario("verify_summary");
        }

        if (summaryToVerify.mealCount !== 1) {
          const stepResult = fail(
            "verify_summary",
            `Expected dailySummary.mealCount === 1, got ${summaryToVerify.mealCount}`,
            { dailySummary: summaryToVerify },
          );
          steps.push(stepResult);
          return failScenario("verify_summary");
        }

        if (typeof summaryToVerify.date !== "string" || !DATE_KEY_PATTERN.test(summaryToVerify.date)) {
          const stepResult = fail(
            "verify_summary",
            `Expected dailySummary.date to match YYYY-MM-DD, got ${String(summaryToVerify.date)}`,
            { dailySummary: summaryToVerify },
          );
          steps.push(stepResult);
          return failScenario("verify_summary");
        }

        steps.push(pass("verify_summary", { dailySummary: summaryToVerify }));
      } catch (err) {
        const stepResult = fail(
          "verify_summary",
          err instanceof Error ? err.message : String(err),
        );
        steps.push(stepResult);
        return failScenario("verify_summary");
      }

      // ------------------------------------------------------------------
      // Step 8: verify_llm_trace — successful logging trace contract
      // ------------------------------------------------------------------
      try {
        llmTrace = buildTrace("pass");
        const trace = expectRecord(llmTrace, "llmTrace");
        const summary = expectRecord(trace.summary, "llmTrace.summary");
        const prompt = expectRecord(summary.prompt, "llmTrace.summary.prompt");
        const finalReply = expectRecord(summary.finalReply, "llmTrace.summary.finalReply");
        const timeline = trace.timeline;
        const serializedTrace = JSON.stringify(trace);
        const topLevelKeys = Object.keys(trace).sort();

        if (topLevelKeys.join(",") !== "scenario,schemaVersion,status,summary,timeline") {
          const stepResult = fail("verify_llm_trace", "Trace top-level keys did not match the llm-trace.v2 contract", {
            topLevelKeys,
          });
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        if (trace.schemaVersion !== "llm-trace.v2") {
          const stepResult = fail(
            "verify_llm_trace",
            `Expected llmTrace.schemaVersion === "llm-trace.v2", got ${String(trace.schemaVersion)}`,
            { schemaVersion: trace.schemaVersion },
          );
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        if (trace.scenario !== "text-log") {
          const stepResult = fail(
            "verify_llm_trace",
            `Expected llmTrace.scenario === "text-log", got ${String(trace.scenario)}`,
            { trace },
          );
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        if (trace.status !== "pass") {
          const stepResult = fail(
            "verify_llm_trace",
            `Expected llmTrace.status === "pass", got ${String(trace.status)}`,
            { trace },
          );
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        if (
          typeof summary.roundCount !== "number"
          || summary.roundCount < 1
          || typeof summary.toolCount !== "number"
          || summary.toolCount < 1
          || summary.fallbackCount !== 0
          || summary.providerErrorCount !== 0
          || typeof summary.latencyMs !== "number"
          || summary.latencyMs < 0
        ) {
          const stepResult = fail("verify_llm_trace", "Trace summary counts or latency did not match successful logging expectations", {
            summary,
          });
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        if (
          typeof prompt.version !== "string"
          || !Array.isArray(prompt.sectionIds)
          || prompt.sectionIds.length === 0
        ) {
          const stepResult = fail("verify_llm_trace", "Trace prompt metadata was missing version or section IDs", {
            prompt,
          });
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        if (
          finalReply.source !== "renderer"
          || finalReply.shape !== "plain_text"
        ) {
          const stepResult = fail("verify_llm_trace", "Trace final reply metadata did not match projected plain-text receipt", {
            finalReply,
          });
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        if (!Array.isArray(timeline)) {
          const stepResult = fail("verify_llm_trace", "Trace timeline was not an array", {
            timeline,
          });
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        const roundStartIndex = timeline.findIndex((event) => isRecord(event) && event.type === "llm_round_start");
        const toolReceivedIndex = timeline.findIndex((event) => isRecord(event) && event.type === "tool_received" && event.tool === "log_food");
        const toolResultIndex = timeline.findIndex((event) => {
          return (
            isRecord(event)
            && event.type === "tool_result"
            && event.tool === "log_food"
            && event.success === true
          );
        });
        const roundEndIndex = timeline.findIndex((event) => isRecord(event) && event.type === "llm_round_end");
        const routeCompletionIndex = timeline.findIndex((event) => {
          return (
            isRecord(event)
            && event.type === "route_completion"
            && event.transport === "sse"
            && event.didLogMeal === true
            && event.didMutateMeal === true
            && event.completed === true
          );
        });

        if (
          roundStartIndex < 0
          || toolReceivedIndex < 0
          || toolResultIndex < 0
          || roundEndIndex < 0
          || routeCompletionIndex < 0
          || !(roundStartIndex < toolReceivedIndex && toolReceivedIndex < toolResultIndex && toolResultIndex < roundEndIndex && roundEndIndex < routeCompletionIndex)
        ) {
          const stepResult = fail("verify_llm_trace", "Trace timeline did not preserve llm/tool event ordering for log_food", {
            eventIndexes: {
              llm_round_start: roundStartIndex,
              tool_received: toolReceivedIndex,
              tool_result: toolResultIndex,
              llm_round_end: roundEndIndex,
              route_completion: routeCompletionIndex,
            },
          });
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        if (timeline.some((event) => isRecord(event) && (event.type === "llm_error" || event.type === "route_fallback"))) {
          const stepResult = fail("verify_llm_trace", "Clean text-log trace contained failure-only timeline facts", {
            timeline,
          });
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        const forbiddenSnippets = [
          USER_INPUT_TEXT,
          streamedReplyText,
          finalAssistantContent,
          "/uploads/",
          "data:image",
          "device_",
          "guest_session",
          "authorization",
          "api_key",
          "messages",
          "rawPrompt",
          "promptText",
          "providerPayload",
          "rawProviderPayload",
          "headers",
          "body",
          "toolArguments",
          "toolResult",
          "historySnapshot",
          "mealsSnapshot",
          "streamFrames",
          "token",
        ].filter((snippet): snippet is string => typeof snippet === "string" && snippet.length > 0);
        const leakedSnippet = forbiddenSnippets.find((snippet) => serializedTrace.includes(snippet));
        if (leakedSnippet !== undefined) {
          const stepResult = fail("verify_llm_trace", "Trace serialization leaked raw scenario evidence or content", {
            leakedSnippetLength: leakedSnippet.length,
          });
          steps.push(stepResult);
          return failScenario("verify_llm_trace");
        }

        steps.push(pass("verify_llm_trace", {
          summary,
          timelineLength: timeline.length,
          forbiddenProbeCount: forbiddenSnippets.length,
        }));
      } catch (err) {
        const stepResult = fail(
          "verify_llm_trace",
          err instanceof Error ? err.message : String(err),
        );
        steps.push(stepResult);
        return failScenario("verify_llm_trace");
      }

      // ------------------------------------------------------------------
      // All steps passed
      // ------------------------------------------------------------------
      const passedCount = steps.filter((s) => s.ok).length;
      return {
        ok: true,
        steps,
        artifacts,
        llmTrace,
        consoleSummary: `PASS ${scenarioName} ${passedCount}/${steps.length}`,
      };
    } finally {
      await fixture.close();
    }
  },
};

export default textLogScenario;
