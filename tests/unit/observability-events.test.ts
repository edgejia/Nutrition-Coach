import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatTurnCompletedEvent,
  buildDeviceGoalsUpdatedRestEvent,
  buildHomeCtaIntentSelectedEvent,
  buildHomeCtaOptionSentEvent,
  buildOnboardingSubmitStartedEvent,
  buildOnboardingSubmitSucceededEvent,
  buildOnboardingValidationFailedEvent,
  buildSseConnectionStateEvent,
  parseHomeCtaClientEvent,
  type RedactedObservabilityEventName,
} from "../../server/observability/events.js";

const LOCKED_EVENT_NAMES: RedactedObservabilityEventName[] = [
  "onboarding_submit_started",
  "onboarding_validation_failed",
  "onboarding_submit_succeeded",
  "home_cta_intent_selected",
  "home_cta_option_sent",
  "chat_turn_completed",
  "device_goals_updated_rest",
  "sse_connection_state",
];

const ALLOWED_METADATA_KEYS = new Set([
  "source",
  "step",
  "fields",
  "codes",
  "usedTargetFallback",
  "intent",
  "promptKey",
  "didLogMeal",
  "didMutateMeal",
  "hadImage",
  "latencyMs",
  "updatedFields",
  "state",
]);

const FORBIDDEN_STRINGS = [
  "我今天吃了雞胸便當",
  "推薦三個便利商店高蛋白選擇",
  "assistant reply text",
  "/tmp/uploads/photo.jpg",
  "device_abc123",
  "1800",
  "130",
];

function assertLockedPayload(payload: Record<string, unknown>) {
  assert.ok(LOCKED_EVENT_NAMES.includes(payload.event as RedactedObservabilityEventName));
  for (const key of Object.keys(payload)) {
    if (key === "event") continue;
    assert.ok(ALLOWED_METADATA_KEYS.has(key), `unexpected metadata key: ${key}`);
  }

  const serialized = JSON.stringify(payload);
  for (const forbidden of FORBIDDEN_STRINGS) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

describe("redacted observability event builders", () => {
  it("emits exactly the locked event names", () => {
    const payloads = [
      buildOnboardingSubmitStartedEvent({ source: "server" }),
      buildOnboardingValidationFailedEvent({
        source: "server",
        step: 3,
        fields: ["age", "weightKg"],
        codes: ["MISSING_AGE", "WEIGHT_OUT_OF_RANGE"],
      }),
      buildOnboardingSubmitSucceededEvent({ usedTargetFallback: false }),
      buildHomeCtaIntentSelectedEvent({ intent: "quick_log" }),
      buildHomeCtaOptionSentEvent({ intent: "quick_log", promptKey: "describe_meal" }),
      buildChatTurnCompletedEvent({
        source: "sse",
        didLogMeal: true,
        didMutateMeal: true,
        hadImage: true,
        latencyMs: 42,
      }),
      buildDeviceGoalsUpdatedRestEvent({ updatedFields: ["protein", "calories"] }),
      buildSseConnectionStateEvent({ state: "opened" }),
    ];

    assert.deepEqual(payloads.map((payload) => payload.event), LOCKED_EVENT_NAMES);
    for (const payload of payloads) {
      assertLockedPayload(payload);
    }
  });

  it("does not accept raw user content, target values, image paths, reply text, or device ids", () => {
    const payloads = [
      buildOnboardingValidationFailedEvent({
        source: "server",
        step: 3,
        fields: ["advancedNotes", "tdee"],
        codes: ["TEXT_TOO_LONG", "INVALID_TDEE"],
      }),
      buildChatTurnCompletedEvent({
        source: "json",
        didLogMeal: false,
        didMutateMeal: false,
        hadImage: true,
        latencyMs: 1800,
      }),
      buildDeviceGoalsUpdatedRestEvent({ updatedFields: ["calories", "protein"] }),
    ];

    for (const payload of payloads) {
      assertLockedPayload(payload);
    }
  });

  it("covers all SSE connection states", () => {
    assert.deepEqual(
      ["opened", "closed", "rejected"].map((state) =>
        buildSseConnectionStateEvent({ state: state as "opened" | "closed" | "rejected" }),
      ),
      [
        { event: "sse_connection_state", state: "opened" },
        { event: "sse_connection_state", state: "closed" },
        { event: "sse_connection_state", state: "rejected" },
      ],
    );
  });
});

describe("Home CTA client event parsing", () => {
  it("accepts only redacted Home CTA identifiers", () => {
    assert.deepEqual(parseHomeCtaClientEvent({ event: "home_cta_intent_selected", intent: "quick-log" }), {
      ok: true,
      event: { event: "home_cta_intent_selected", intent: "quick-log" },
    });
    assert.deepEqual(
      parseHomeCtaClientEvent({
        event: "home_cta_option_sent",
        intent: "quick_log",
        promptKey: "describe-meal",
        prompt: "推薦三個便利商店高蛋白選擇",
        deviceId: "device_abc123",
      }),
      {
        ok: true,
        event: { event: "home_cta_option_sent", intent: "quick_log", promptKey: "describe-meal" },
      },
    );
  });

  it("rejects non-Home CTA events and malformed identifiers", () => {
    const invalidBodies = [
      null,
      [],
      { event: "chat_turn_completed", source: "sse" },
      { event: "home_cta_intent_selected", intent: "Quick Log" },
      { event: "home_cta_intent_selected", intent: "quick\nlog" },
      { event: "home_cta_option_sent", intent: "quick_log", promptKey: "x".repeat(65) },
      { event: "home_cta_option_sent", intent: "quick_log" },
    ];

    for (const body of invalidBodies) {
      assert.deepEqual(parseHomeCtaClientEvent(body), { ok: false, error: "Invalid client event" });
    }
  });
});
