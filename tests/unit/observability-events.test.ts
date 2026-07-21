import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildChatRouteFallbackEvent,
  buildChatTurnCompletedEvent,
  buildDeviceGoalsValidationFailedEvent,
  buildDeviceGoalsUpdatedRestEvent,
  buildHomeCtaIntentSelectedEvent,
  buildHomeCtaOptionSentEvent,
  buildMutationReceiptGuardTrippedEvent,
  buildOnboardingSubmitStartedEvent,
  buildOnboardingSubmitSucceededEvent,
  buildOnboardingValidationFailedEvent,
  buildOwnershipBypassBlockedEvent,
  buildSseConnectionStateEvent,
  parseHomeCtaClientEvent,
  sanitizeRouteCatchError,
  classifyProviderErrorCategory,
  type RedactedObservabilityEventName,
} from "../../server/observability/events.js";
import { createStructuredHooks } from "../../server/orchestrator/hooks.js";
import type { ProviderErrorMetadata } from "../../server/llm/types.js";
import { PROTECTED_ROUTE_META } from "../../server/routes/protected-route.js";

const LOCKED_EVENT_NAMES: RedactedObservabilityEventName[] = [
  "onboarding_submit_started",
  "onboarding_validation_failed",
  "onboarding_submit_succeeded",
  "home_cta_intent_selected",
  "home_cta_option_sent",
  "chat_turn_completed",
  "chat_route_fallback",
  "ownership_bypass_blocked",
  "device_goals_validation_failed",
  "device_goals_updated_rest",
  "sse_connection_state",
  "mutation_receipt_guard_tripped",
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
  "route",
  "operation",
  "verb",
  "requestId",
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
  "legacy-device-id-123",
  "legacyDeviceId",
  "guest_session",
  "cookie",
  "x-device-id",
  "192.168.0.42",
  "forged_signature",
];

const EXPECTED_PROTECTED_ROUTE_META = {
  chatMessage: { route: "api_chat", operation: "chat_message" },
  chatStop: { route: "api_chat_stop", operation: "chat_stop" },
  chatHistory: { route: "api_chat_history", operation: "chat_history_list" },
  mealsList: { route: "api_meals", operation: "meals_list" },
  mealUpdate: { route: "api_meal", operation: "meal_update" },
  mealDelete: { route: "api_meal", operation: "meal_delete" },
  historyMeals: { route: "api_history_meals", operation: "history_meals_list" },
  historySearch: { route: "api_history_search", operation: "history_search" },
  historyTrends: { route: "api_history_trends", operation: "history_trends" },
  historyDay: { route: "api_history_day", operation: "history_day_detail" },
  assetRead: { route: "api_assets", operation: "asset_read" },
  daySnapshot: { route: "api_day_snapshot", operation: "day_snapshot_read" },
  proposalAction: { route: "api_proposals_actions", operation: "proposal_action" },
  observabilityClientEvent: {
    route: "api_observability_client_event",
    operation: "client_event_record",
  },
  sse: { route: "api_sse", operation: "sse_subscribe" },
  deviceGoalsPatch: { route: "api_device_goals", operation: "device_goals_update" },
  deviceGoalsPut: { route: "api_device_goals", operation: "device_goals_update" },
} as const;

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
  it("keeps provider error categories fixed and routine hook diagnostics metadata-only", () => {
    assert.equal(classifyProviderErrorCategory({
      provider: "openai",
      operation: "chat",
      model: "gpt-test",
      aborted: false,
      status: 500,
      errorCode: "raw-provider-body-sentinel-4c2a",
    }), "server_error");

    const captured: Array<Record<string, unknown>> = [];
    const log = {
      info(payload: Record<string, unknown>) { captured.push(payload); },
      warn(payload: Record<string, unknown>) { captured.push(payload); },
    };
    const hooks = createStructuredHooks(log as never);

    hooks.onToolReceived?.("log_food", "privacy-sentinel-prompt-8b1d");
    hooks.onToolResult?.({
      tool: "log_food",
      success: false,
      executed: false,
      failureReason: "raw-error-sentinel-31d9",
      reason: "raw-tool-payload-sentinel-77e1",
      fields: ["calories", "privacy-sentinel-field-2a91"],
      summary: "熱量 918273kcal, P817263g, C716253g, F615243g",
      proposalId: "privacy-sentinel-session-4e7b",
    });
    hooks.onLLMError?.({
      round: 2,
      lastTool: "log_food",
      providerMetadata: {
        provider: "openai",
        operation: "chat",
        model: "gpt-test",
        aborted: false,
        status: 502,
        providerRequestId: "privacy-sentinel-header-62f4",
        errorName: "raw-provider-body-sentinel-4c2a",
        errorType: "raw-provider-type-sentinel-11aa",
        errorCode: "raw-provider-code-sentinel-90cd",
      },
    });

    for (const sentinel of [
      "privacy-sentinel-prompt-8b1d",
      "raw-error-sentinel-31d9",
      "raw-tool-payload-sentinel-77e1",
      "918273",
      "817263",
      "716253",
      "615243",
      "privacy-sentinel-field-2a91",
      "privacy-sentinel-session-4e7b",
      "privacy-sentinel-header-62f4",
      "raw-provider-body-sentinel-4c2a",
      "raw-provider-type-sentinel-11aa",
      "raw-provider-code-sentinel-90cd",
    ]) {
      const count = JSON.stringify(captured).split(sentinel).length - 1;
      assert.equal(count, 0, `channel=structured_hook key=metadata count=${count}`);
    }
  });

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
      buildOwnershipBypassBlockedEvent({
        reason: "legacy_device_id_rejected",
        route: "api_device_session",
        operation: "legacy_session_bootstrap",
        requestId: "req-ownership-1",
      }),
      buildDeviceGoalsValidationFailedEvent({ fields: ["protein"], codes: ["invalid_field_value"] }),
      buildDeviceGoalsUpdatedRestEvent({ updatedFields: ["protein", "calories"] }),
      buildSseConnectionStateEvent({ state: "opened" }),
      buildMutationReceiptGuardTrippedEvent({
        operation: "orchestrator_receipt",
        verb: "log",
        turnId: "turn-receipt-guard-1",
      }),
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
      buildOwnershipBypassBlockedEvent({
        reason: "raw_device_id_param",
        route: "api_chat",
        operation: "chat_message",
        requestId: "req-ownership-2",
        turnId: "turn-ownership-2",
      }),
    ];

    for (const payload of payloads) {
      assertLockedPayload(payload);
    }
  });

  it("builds ownership bypass blocked events with metadata-only fields", () => {
    const withoutTurnId = buildOwnershipBypassBlockedEvent({
      reason: "legacy_device_id_rejected",
      route: "api_device_session",
      operation: "legacy_session_bootstrap",
      requestId: "req-legacy-rejected",
    });
    assert.deepEqual(withoutTurnId, {
      event: "ownership_bypass_blocked",
      reason: "legacy_device_id_rejected",
      route: "api_device_session",
      operation: "legacy_session_bootstrap",
      requestId: "req-legacy-rejected",
    });
    assert.deepEqual(Object.keys(withoutTurnId), ["event", "reason", "route", "operation", "requestId"]);
    assertLockedPayload(withoutTurnId);

    const withTurnId = buildOwnershipBypassBlockedEvent({
      reason: "raw_device_id_param",
      route: "api_chat_stop",
      operation: "chat_stop",
      requestId: "req-raw-param",
      turnId: "turn-raw-param",
    });
    assert.deepEqual(withTurnId, {
      event: "ownership_bypass_blocked",
      reason: "raw_device_id_param",
      route: "api_chat_stop",
      operation: "chat_stop",
      requestId: "req-raw-param",
      turnId: "turn-raw-param",
    });
    assert.deepEqual(Object.keys(withTurnId), ["event", "reason", "route", "operation", "requestId", "turnId"]);
    assertLockedPayload(withTurnId);
  });

  it("allowlists every protected route metadata value without adding raw request fields", () => {
    assert.deepEqual(PROTECTED_ROUTE_META, EXPECTED_PROTECTED_ROUTE_META);

    for (const [index, metadata] of Object.values(PROTECTED_ROUTE_META).entries()) {
      const requestId = `req-protected-${index}`;
      const payload = buildOwnershipBypassBlockedEvent({
        reason: "raw_device_id_param",
        route: metadata.route,
        operation: metadata.operation,
        requestId,
      });

      assert.deepEqual(payload, {
        event: "ownership_bypass_blocked",
        reason: "raw_device_id_param",
        route: metadata.route,
        operation: metadata.operation,
        requestId,
      });
      assert.deepEqual(Object.keys(payload), ["event", "reason", "route", "operation", "requestId"]);
      assertLockedPayload(payload);
    }
  });

  it("builds mutation receipt guard trip events with metadata-only fields", () => {
    const payload = buildMutationReceiptGuardTrippedEvent({
      operation: "proposal_action",
      verb: "delete",
      requestId: "req-receipt-guard",
      turnId: "turn-receipt-guard",
      matchedTerm: "delete_meal",
      foodName: "field roast",
      receiptText: "已完成 delete_meal field roast",
      prompt: "raw prompt text",
      cookie: "guest_session=signed-cookie",
      deviceId: "device_abc123",
      sessionId: "session_secret",
      body: { text: "raw body text" },
      providerPayload: { content: "assistant reply text" },
    } as never);

    assert.deepEqual(payload, {
      event: "mutation_receipt_guard_tripped",
      operation: "proposal_action",
      verb: "delete",
      requestId: "req-receipt-guard",
      turnId: "turn-receipt-guard",
    });
    assert.deepEqual(Object.keys(payload), ["event", "operation", "verb", "requestId", "turnId"]);
    assertLockedPayload(payload);
    assert.doesNotMatch(
      JSON.stringify(payload),
      /log_food|update_meal|delete_meal|update_goals|body armor|field roast|已完成 log_food/,
    );
  });

  it("sanitizes ownership bypass blocked dimensions and excludes forbidden telemetry", () => {
    const payload = buildOwnershipBypassBlockedEvent({
      reason: "forged_signature",
      route: "api/device/session?legacyDeviceId=legacy-device-id-123",
      operation: "legacyDeviceId",
      requestId: "guest_session=signed-cookie",
      turnId: "192.168.0.42",
      legacyDeviceId: "legacy-device-id-123",
      cookie: "guest_session=signed-cookie",
      headers: { "x-device-id": "legacy-device-id-123" },
      body: "raw body text legacyDeviceId=legacy-device-id-123",
      error: new Error("forged_signature"),
    } as never);

    assert.deepEqual(payload, {
      event: "ownership_bypass_blocked",
      reason: "raw_device_id_param",
      route: "api_device_session",
      operation: "legacy_session_bootstrap",
      requestId: "redacted",
      turnId: "redacted",
    });
    assertLockedPayload(payload);
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

  it("omits unsafe direct route fallback catch fields in the event builder", () => {
    const forbiddenValues = [
      "prompt: system says log the meal",
      "messages[0].content user nutrition text",
      "我今天吃了雞胸便當",
      "provider body raw payload",
      "tool payload {\"food\":\"secret\"}",
      "guest_session=signed-session",
      "image data:image/png;base64,abc123",
      "assistant final reply text",
      "stack: at route handler",
      "cause: nested raw error",
    ];

    for (const forbidden of forbiddenValues) {
      const payload = buildChatRouteFallbackEvent({
        source: "json",
        turnId: "turn-direct-unsafe-route-catch",
        fallbackSource: "route_catch",
        didLogMeal: false,
        didMutateMeal: false,
        hadImage: true,
        latencyMs: 5,
        reason: "route_catch",
        catchSite: "json_outer",
        errorName: forbidden,
        errorMessage: forbidden,
      });

      assert.equal("errorName" in payload, false);
      assert.equal("errorMessage" in payload, false);
      assert.doesNotMatch(JSON.stringify(payload), new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assertLockedPayload(payload);
    }
  });

  it("omits direct route fallback catch fields when unsafe markers appear after truncation limits", () => {
    const payload = buildChatRouteFallbackEvent({
      source: "json",
      turnId: "turn-direct-late-unsafe-route-catch",
      fallbackSource: "route_catch",
      didLogMeal: false,
      didMutateMeal: false,
      hadImage: true,
      latencyMs: 5,
      reason: "route_catch",
      catchSite: "json_outer",
      errorName: `${"SafeRouteError".repeat(7)} prompt`,
      errorMessage: `${"Safe route error. ".repeat(11)} guest_session`,
    });

    assert.equal("errorName" in payload, false);
    assert.equal("errorMessage" in payload, false);
    assertLockedPayload(payload);
  });

  it("preserves safe direct route fallback catch fields in the event builder", () => {
    const payload = buildChatRouteFallbackEvent({
      source: "sse",
      turnId: "turn-direct-safe-route-catch",
      fallbackSource: "route_catch",
      didLogMeal: false,
      didMutateMeal: false,
      hadImage: false,
      latencyMs: 9,
      reason: "route_catch",
      catchSite: "sse_outer",
      errorName: "SseOuterSafeFailure",
      errorMessage: "Safe route error",
    });

    assert.equal(payload.errorName, "SseOuterSafeFailure");
    assert.equal(payload.errorMessage, "Safe route error");
    assertLockedPayload(payload);
  });

  it("redacts unsafe allowed provider metadata values on route fallback events", () => {
    const providerMetadata: ProviderErrorMetadata = {
      provider: "openai",
      operation: "chat_round_initial",
      model: "raw-prompt-model",
      aborted: false,
      status: 429,
      providerRequestId: "guest_session=req",
      errorName: "AuthorizationError",
      errorType: "provider_body",
      errorCode: "Bearer_secret",
    };

    const payload = buildChatRouteFallbackEvent({
      source: "json",
      turnId: "turn-unsafe-provider-metadata",
      fallbackSource: "orchestrator",
      didLogMeal: false,
      didMutateMeal: false,
      hadImage: false,
      latencyMs: 11,
      reason: "llm_error",
      providerMetadata,
    });

    assert.deepEqual(payload.providerMetadata, {
      provider: "openai",
      operation: "chat_round_initial",
      model: "redacted",
      aborted: false,
      status: 429,
      providerRequestId: "redacted",
      errorName: "redacted",
      errorType: "redacted",
      errorCode: "redacted",
    });
    assert.doesNotMatch(
      JSON.stringify(payload),
      /raw-prompt|guest_session|Authorization|provider_body|Bearer|secret/i,
    );
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
