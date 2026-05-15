import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatRouteFallbackEvent,
  buildChatTurnCompletedEvent,
  buildDeviceGoalsValidationFailedEvent,
  buildDeviceGoalsUpdatedRestEvent,
  buildHomeCtaIntentSelectedEvent,
  buildHomeCtaOptionSentEvent,
  buildOnboardingSubmitStartedEvent,
  buildOnboardingSubmitSucceededEvent,
  buildOnboardingValidationFailedEvent,
  buildSseConnectionStateEvent,
  parseHomeCtaClientEvent,
  sanitizeRouteCatchError,
  type RedactedObservabilityEventName,
} from "../../server/observability/events.js";
import type { ProviderErrorMetadata } from "../../server/llm/types.js";

const LOCKED_EVENT_NAMES: RedactedObservabilityEventName[] = [
  "onboarding_submit_started",
  "onboarding_validation_failed",
  "onboarding_submit_succeeded",
  "home_cta_intent_selected",
  "home_cta_option_sent",
  "chat_turn_completed",
  "chat_route_fallback",
  "device_goals_validation_failed",
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
  "turnId",
  "fallbackSource",
  "didLogMeal",
  "didMutateMeal",
  "hadImage",
  "latencyMs",
  "reason",
  "catchSite",
  "providerMetadata",
  "errorName",
  "errorMessage",
  "round",
  "lastTool",
  "updatedFields",
  "state",
]);

const ALLOWED_PROVIDER_METADATA_KEYS = new Set([
  "provider",
  "operation",
  "model",
  "aborted",
  "status",
  "providerRequestId",
  "errorName",
  "errorType",
  "errorCode",
]);

const FORBIDDEN_STRINGS = [
  "我今天吃了雞胸便當",
  "推薦三個便利商店高蛋白選擇",
  "assistant reply text",
  "/tmp/uploads/photo.jpg",
  "device_abc123",
  "1800",
  "130",
  "raw body text",
  '"method":"POST"',
  '"body"',
  '"value"',
];

function assertLockedPayload(payload: { event: RedactedObservabilityEventName } & object) {
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
        turnId: "turn-completed-1",
        didLogMeal: true,
        didMutateMeal: true,
        hadImage: true,
        latencyMs: 42,
      }),
      buildChatRouteFallbackEvent({
        source: "json",
        turnId: "turn-fallback-1",
        fallbackSource: "orchestrator",
        didLogMeal: false,
        didMutateMeal: false,
        hadImage: false,
        latencyMs: 7,
        reason: "llm_error",
      }),
      buildDeviceGoalsValidationFailedEvent({ fields: ["protein"], codes: ["invalid_field_value"] }),
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
        turnId: "turn-completed-2",
        didLogMeal: false,
        didMutateMeal: false,
        hadImage: true,
        latencyMs: 42,
      }),
      buildDeviceGoalsValidationFailedEvent({
        fields: ["calories", "protein", "deviceId", "target"],
        codes: ["invalid_body", "invalid_field_value", "empty_valid_fields", "raw body text"],
      }),
      buildDeviceGoalsUpdatedRestEvent({ updatedFields: ["calories", "protein"] }),
    ];

    for (const payload of payloads) {
      assertLockedPayload(payload);
    }
  });

  it("builds device goals validation failures with locked fields and codes only", () => {
    assert.deepEqual(
      buildDeviceGoalsValidationFailedEvent({ fields: ["protein"], codes: ["invalid_field_value"] }),
      {
        event: "device_goals_validation_failed",
        fields: ["protein"],
        codes: ["invalid_field_value"],
      },
    );
    assert.deepEqual(
      buildDeviceGoalsValidationFailedEvent({
        fields: ["protein", "water", "deviceId", "calories", "fat", "carbs"],
        codes: [
          "invalid_body",
          "invalid_field_value",
          "empty_valid_fields",
          "route",
          "method",
          "INVALID_BODY",
          "invalid-field-value",
        ],
      }),
      {
        event: "device_goals_validation_failed",
        fields: ["calories", "carbs", "fat", "protein"],
        codes: ["empty_valid_fields", "invalid_body", "invalid_field_value"],
      },
    );
  });

  it("builds completed chat turn events with required turnId", () => {
    assert.deepEqual(
      buildChatTurnCompletedEvent({
        source: "json",
        turnId: "turn-completed-required",
        didLogMeal: true,
        didMutateMeal: true,
        hadImage: false,
        latencyMs: 42.4,
      }),
      {
        event: "chat_turn_completed",
        source: "json",
        turnId: "turn-completed-required",
        didLogMeal: true,
        didMutateMeal: true,
        hadImage: false,
        latencyMs: 42,
      },
    );
  });

  it("builds route fallback events with required controlled fields", () => {
    const payload = buildChatRouteFallbackEvent({
      source: "sse",
      turnId: "turn-fallback-required",
      fallbackSource: "route_catch",
      didLogMeal: false,
      didMutateMeal: true,
      hadImage: true,
      latencyMs: -12.7,
      reason: "route_catch",
      catchSite: "sse_outer",
    });

    assert.deepEqual(payload, {
      event: "chat_route_fallback",
      source: "sse",
      turnId: "turn-fallback-required",
      fallbackSource: "route_catch",
      didLogMeal: false,
      didMutateMeal: true,
      hadImage: true,
      latencyMs: 0,
      reason: "route_catch",
      catchSite: "sse_outer",
    });
    assert.equal("stopped" in payload, false);
    assert.equal("tokensStreamed" in payload, false);
    assertLockedPayload(payload);
  });

  it("preserves only allowlisted provider metadata on route fallback events", () => {
    const providerMetadata: ProviderErrorMetadata & {
      headers?: Record<string, string>;
      body?: string;
      message?: string;
    } = {
      provider: "openai",
      operation: "chat_round_initial",
      model: "gpt-4.1-mini",
      aborted: false,
      status: 429,
      providerRequestId: "req_123",
      errorName: "RateLimitError",
      errorType: "rate_limit_error",
      errorCode: "rate_limit_exceeded",
      headers: { authorization: "Bearer secret" },
      body: "raw body text",
      message: "provider raw message",
    };

    const payload = buildChatRouteFallbackEvent({
      source: "json",
      turnId: "turn-provider-metadata",
      fallbackSource: "orchestrator",
      didLogMeal: false,
      didMutateMeal: false,
      hadImage: false,
      latencyMs: 11,
      reason: "llm_error",
      providerMetadata,
      round: 2,
      lastTool: "log_food",
    });

    assert.deepEqual(new Set(Object.keys(payload.providerMetadata ?? {})), ALLOWED_PROVIDER_METADATA_KEYS);
    assert.deepEqual(payload.providerMetadata, {
      provider: "openai",
      operation: "chat_round_initial",
      model: "gpt-4.1-mini",
      aborted: false,
      status: 429,
      providerRequestId: "req_123",
      errorName: "RateLimitError",
      errorType: "rate_limit_error",
      errorCode: "rate_limit_exceeded",
    });
    assert.doesNotMatch(JSON.stringify(payload), /headers|authorization|body|raw body text|message|provider raw message/);
    assertLockedPayload(payload);
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

describe("route catch error sanitizer", () => {
  it("keeps safe route error name and message", () => {
    assert.deepEqual(sanitizeRouteCatchError(new Error("Safe route error")), {
      errorName: "Error",
      errorMessage: "Safe route error",
    });
  });

  it("omits non-Error thrown values and unsafe messages from fallback payloads", () => {
    assert.deepEqual(sanitizeRouteCatchError("raw thrown prompt text"), {});

    const forbiddenValues = [
      "prompt: system says log the meal",
      "messages[0].content user nutrition text",
      "我今天吃了雞胸便當",
      "provider body raw payload",
      "headers authorization bearer secret",
      "tool payload {\"food\":\"secret\"}",
      "guest_session=signed-session",
      "image data:image/png;base64,abc123",
      "assistant final reply text",
      "cause: nested raw error",
      "stack: at route handler",
    ];

    for (const forbidden of forbiddenValues) {
      const sanitized = sanitizeRouteCatchError(new Error(forbidden));
      assert.deepEqual(sanitized, {}, `expected unsafe value to be omitted: ${forbidden}`);

      const payload = buildChatRouteFallbackEvent({
        source: "json",
        turnId: "turn-sanitized-route-catch",
        fallbackSource: "route_catch",
        didLogMeal: false,
        didMutateMeal: false,
        hadImage: true,
        latencyMs: 5,
        reason: "route_catch",
        catchSite: "json_outer",
        ...sanitized,
      });

      assert.doesNotMatch(JSON.stringify(payload), new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.equal("errorName" in payload, false);
      assert.equal("errorMessage" in payload, false);
    }
  });

  it("caps safe route error fields before logging", () => {
    const longNameError = new Error("A".repeat(200));
    longNameError.name = "Route_Catch_Error_Name/" + "B".repeat(200);

    const sanitized = sanitizeRouteCatchError(longNameError);

    assert.equal(sanitized.errorName?.length, 80);
    assert.equal(sanitized.errorMessage?.length, 160);
    assert.match(sanitized.errorName ?? "", /^[A-Za-z0-9 .:_/-]+$/);
    assert.match(sanitized.errorMessage ?? "", /^[A-Za-z0-9 .:_/-]+$/);
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
