import {
  assertNoInternalLeakage,
  assertNoUnauthorizedMutation,
  assertNoUnsafeNutritionGuidance,
  assertTraditionalChinese,
  evaluateExpectedFailures,
  type BehaviorAssertionResult,
  type BehaviorCaseOutcome,
} from "../behavior-assertions.js";
import { type ScenarioAppContext, type ScenarioAppFactory } from "../app-fixture.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import { renderUnsafeNutritionGuidanceCopy } from "../../../server/orchestrator/mutation-receipts.js";
import { DEFAULT_SESSION_ID } from "../../../server/services/turn-state.js";

interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface DeviceSession {
  dailyTargets: DailyTargets;
}

interface MealsPayload {
  meals: unknown[];
}

interface ChatHistoryPayload {
  messages: Array<{ role: string; content?: string }>;
}

interface UnsafeNutritionOutputGuardCaseInput {
  caseId: string;
  scenario: string;
  userMessage: string;
  unsafeModelReply: string;
  vectorId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function fetchJson<T>(url: string, cookieHeader: string): Promise<T> {
  const isSessionRequest = url.endsWith("/api/device/session");
  const response = await fetch(url, {
    method: isSessionRequest ? "POST" : "GET",
    headers: {
      cookie: cookieHeader,
      ...(isSessionRequest ? { "content-type": "application/json" } : {}),
    },
    ...(isSessionRequest ? { body: JSON.stringify({}) } : {}),
  });

  if (!response.ok) {
    throw new Error(`Expected ${url} to return 2xx, got ${response.status}`);
  }

  return await response.json() as T;
}

function traceTimeline(trace: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(trace.timeline) ? trace.timeline.filter(isRecord) : [];
}

function collectObservedTools(trace: Record<string, unknown>): string[] {
  return traceTimeline(trace)
    .filter((event) => event.type === "tool_received" && typeof event.tool === "string")
    .map((event) => event.tool as string);
}

function collectAssistantText(frames: Array<{ event: string; data: string }>): string {
  return frames
    .filter((frame) => frame.event === "chunk")
    .map((frame) => {
      try {
        const parsed = JSON.parse(frame.data) as { token?: unknown };
        return typeof parsed.token === "string" ? parsed.token : "";
      } catch {
        return "";
      }
    })
    .join("");
}

function latestAssistantText(messages: ChatHistoryPayload["messages"]): string {
  return messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
}

function unsafeReplyNeedles(reply: string): string[] {
  return reply
    .split(/[，。！？；;,.:\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4);
}

function countNeedleMatches(text: string, needles: readonly string[]): number {
  return needles.filter((needle) => text.includes(needle)).length;
}

function assertUnsafeModelOutputRenderedFallback(input: {
  answer: string;
  persistedAssistantText: string;
  unsafeModelReply: string;
}): BehaviorAssertionResult {
  const fallback = renderUnsafeNutritionGuidanceCopy();
  const needles = unsafeReplyNeedles(input.unsafeModelReply);
  const emittedUnsafeNeedleMatches = countNeedleMatches(input.answer, needles);
  const persistedUnsafeNeedleMatches = countNeedleMatches(input.persistedAssistantText, needles);
  const evidence = {
    fallbackMatchedAnswer: input.answer === fallback,
    fallbackMatchedPersistedAssistant: input.persistedAssistantText === fallback,
    unsafeNeedleCount: needles.length,
    emittedUnsafeNeedleMatches,
    persistedUnsafeNeedleMatches,
  };
  return evidence.fallbackMatchedAnswer &&
      evidence.fallbackMatchedPersistedAssistant &&
      emittedUnsafeNeedleMatches === 0 &&
      persistedUnsafeNeedleMatches === 0
    ? { name: "unsafe_model_output_rendered_fallback", ok: true, evidence }
    : {
      name: "unsafe_model_output_rendered_fallback",
      ok: false,
      message: "Unsafe model output must be replaced by the renderer fallback in stream chunks and persisted history",
      evidence,
    };
}

async function postChatSse(input: {
  address: string;
  cookieHeader: string;
  message: string;
}): Promise<Array<{ event: string; data: string }>> {
  const form = new FormData();
  form.append("message", input.message);
  const response = await fetch(`${input.address}/api/chat`, {
    method: "POST",
    headers: {
      cookie: input.cookieHeader,
      Accept: "text/event-stream",
    },
    body: form,
  });

  if (response.status !== 200 || !response.body) {
    throw new Error(`Expected /api/chat SSE 200 with body, got ${response.status}`);
  }

  const rawStream = await readStreamUntilEvent(response.body.getReader(), "done", 60);
  return parseSSEEvents(rawStream);
}

function targetDiff(beforeTargets: DailyTargets, afterTargets: DailyTargets) {
  return {
    goalsChanged: JSON.stringify(beforeTargets) !== JSON.stringify(afterTargets),
    caloriesChanged: beforeTargets.calories !== afterTargets.calories,
    proteinChanged: beforeTargets.protein !== afterTargets.protein,
    carbsChanged: beforeTargets.carbs !== afterTargets.carbs,
    fatChanged: beforeTargets.fat !== afterTargets.fat,
  };
}

async function proposalSnapshot(fixture: ScenarioAppContext) {
  const session = { deviceId: fixture.deviceId, sessionId: DEFAULT_SESSION_ID };
  const [goalProposal, mealNumericProposal, mealDeleteProposal] = await Promise.all([
    fixture.services.goalProposalService.getLatest(session),
    fixture.services.mealNumericProposalService.getLatest(session),
    fixture.services.mealDeleteProposalService.getLatest(session),
  ]);
  return {
    goalProposalActive: goalProposal !== undefined,
    mealNumericProposalActive: mealNumericProposal !== undefined,
    mealDeleteProposalActive: mealDeleteProposal !== undefined,
  };
}

function buildPersistedDiff(input: {
  beforeMeals: unknown[];
  afterMeals: unknown[];
  beforeTargets: DailyTargets;
  afterTargets: DailyTargets;
  beforeProposals: Awaited<ReturnType<typeof proposalSnapshot>>;
  afterProposals: Awaited<ReturnType<typeof proposalSnapshot>>;
}) {
  return {
    mealsChanged: JSON.stringify(input.beforeMeals) !== JSON.stringify(input.afterMeals),
    ...targetDiff(input.beforeTargets, input.afterTargets),
    proposalCreated: !Object.values(input.beforeProposals).some(Boolean) &&
      Object.values(input.afterProposals).some(Boolean),
    proposalsChanged: JSON.stringify(input.beforeProposals) !== JSON.stringify(input.afterProposals),
  };
}

export async function runUnsafeNutritionOutputGuardCase(
  input: UnsafeNutritionOutputGuardCaseInput,
  createApp: ScenarioAppFactory,
): Promise<BehaviorCaseOutcome> {
  const provider = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();
  provider.queueRoundResponse({ content: input.unsafeModelReply });
  const fixture = await createApp({
    llmProvider: provider,
    llmTraceRecorderFactory: () => recorder,
  });

  try {
    const beforeMeals = (await fetchJson<MealsPayload>(`${fixture.address}/api/meals`, fixture.cookieHeader)).meals;
    const beforeSession = await fetchJson<DeviceSession>(
      `${fixture.address}/api/device/session`,
      fixture.cookieHeader,
    );
    const beforeProposals = await proposalSnapshot(fixture);

    const frames = await postChatSse({
      address: fixture.address,
      cookieHeader: fixture.cookieHeader,
      message: input.userMessage,
    });
    const answer = collectAssistantText(frames);
    const trace = recorder.build({ scenario: input.scenario, status: "pass" }) as unknown as Record<string, unknown>;
    const observedTools = collectObservedTools(trace);

    const afterMeals = (await fetchJson<MealsPayload>(`${fixture.address}/api/meals`, fixture.cookieHeader)).meals;
    const afterSession = await fetchJson<DeviceSession>(
      `${fixture.address}/api/device/session`,
      fixture.cookieHeader,
    );
    const history = await fetchJson<ChatHistoryPayload>(`${fixture.address}/api/chat/history`, fixture.cookieHeader);
    const persistedAssistantText = latestAssistantText(history.messages);
    const afterProposals = await proposalSnapshot(fixture);
    const persistedDiff = buildPersistedDiff({
      beforeMeals,
      afterMeals,
      beforeTargets: beforeSession.dailyTargets,
      afterTargets: afterSession.dailyTargets,
      beforeProposals,
      afterProposals,
    });

    const assertions: BehaviorAssertionResult[] = [
      assertTraditionalChinese(answer),
      assertNoInternalLeakage(answer),
      assertNoUnauthorizedMutation({ allowedTools: [], observedTools, persistedDiff }),
      assertUnsafeModelOutputRenderedFallback({
        answer,
        persistedAssistantText,
        unsafeModelReply: input.unsafeModelReply,
      }),
      assertNoUnsafeNutritionGuidance(answer),
    ];
    const evaluation = evaluateExpectedFailures({ assertions });
    const noUnauthorizedMutation = assertions.find((assertion) => assertion.name === "no_unauthorized_mutation");
    const rendererBoundary = assertions.find((assertion) => assertion.name === "unsafe_model_output_rendered_fallback");
    const noUnsafeNutrition = assertions.find((assertion) => assertion.name === "no_unsafe_nutrition_guidance");
    const noLeakage = assertions.find((assertion) => assertion.name === "no_internal_leakage");

    return {
      caseId: input.caseId,
      status: evaluation.status,
      ok: evaluation.ok,
      assertions: evaluation.assertions,
      expectedFailures: evaluation.expectedFailures,
      evidence: {
        userPayloadLength: input.userMessage.length,
        finalAnswerLength: answer.length,
        vectorId: input.vectorId,
        proofBoundary: "unsafe_model_output_guarded",
        unsafeModelReplyLength: input.unsafeModelReply.length,
        allowedTools: [],
        observedTools,
        unauthorizedTools: isRecord(noUnauthorizedMutation?.evidence)
          ? noUnauthorizedMutation.evidence.unauthorizedTools
          : [],
        persistedDiff,
        rendererBoundaryEvidence: rendererBoundary?.evidence,
        unsafeNutritionEvidence: noUnsafeNutrition?.evidence,
        leakageTermMatchCount: isRecord(noLeakage?.evidence) && Array.isArray(noLeakage.evidence.matchedTerms)
          ? noLeakage.evidence.matchedTerms.length
          : 0,
        streamEventTypes: frames.map((frame) => frame.event),
      },
    };
  } catch (error) {
    return {
      caseId: input.caseId,
      status: "execution-error",
      ok: false,
      assertions: [],
      evidence: {
        userPayloadLength: input.userMessage.length,
        vectorId: input.vectorId,
        proofBoundary: "unsafe_model_output_guarded",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    await fixture.close();
  }
}
