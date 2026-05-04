import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { capabilityMatrix } from "../../client/src/contracts/capability-matrix.js";

const SUPPORT_STATES = new Set([
  "supported",
  "supported-read-only",
  "inert-honest-placeholder",
  "hidden-future-scope",
  "repair-needed",
]);
const PLACEHOLDER_SHAPES = new Set(["button", "row", "card", "none"]);
const REQUIRED_SURFACES = new Set([
  "Home",
  "Chat",
  "History",
  "Day Detail",
  "Meal Edit",
  "Settings",
  "onboarding",
  "guest recovery",
]);
const REQUIRED_REQUIREMENTS = new Set(["ALIGN-01", "ALIGN-02", "ALIGN-03", "ALIGN-04"]);
const REPAIR_SEVERITIES = new Set(["blocker", "must-fix", "follow-up"]);
const ROADMAP_FUTURES = [
  "Identity and Continuity",
  "Insights",
  "Mobile Shell and Chat Control Stability",
  "Meal Image Continuity",
  "History and Dashboard Polish",
];

async function readSource(path: string) {
  return readFile(path, "utf8");
}

function assertNonEmptyString(value: unknown, label: string) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.trim().length > 0, `${label} must be non-empty`);
}

function assertNonEmptyArray(value: readonly unknown[], label: string) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.length > 0, `${label} must be non-empty`);
}

function symbolFromReference(reference: string) {
  return reference.replace(/\(.*/, "").trim();
}

function routePattern(route: string) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'\`]${escaped.replace(/\\:([A-Za-z]+)/g, ":[A-Za-z]+")}["'\`]`);
}

describe("capability matrix contract", () => {
  it("keeps schema, taxonomy, surface, and requirement coverage locked", () => {
    assert.ok(capabilityMatrix.length > 0);

    const surfaces = new Set<string>();
    const requirements = new Set<string>();

    for (const [index, row] of capabilityMatrix.entries()) {
      const label = `row ${index} ${row.surface} ${row.affordance}`;

      assertNonEmptyString(row.surface, `${label} surface`);
      assertNonEmptyString(row.affordance, `${label} affordance`);
      assertNonEmptyString(row.sourceFile, `${label} sourceFile`);
      assertNonEmptyArray(row.sourceMatchers, `${label} sourceMatchers`);
      assertNonEmptyString(row.supportState, `${label} supportState`);
      assertNonEmptyString(row.placeholderShape, `${label} placeholderShape`);
      assertNonEmptyString(row.handlingDecision, `${label} handlingDecision`);
      assertNonEmptyArray(row.requirements, `${label} requirements`);
      assertNonEmptyArray(row.testCoverage, `${label} testCoverage`);

      assert.ok(SUPPORT_STATES.has(row.supportState), `${label} uses locked support state`);
      assert.ok(PLACEHOLDER_SHAPES.has(row.placeholderShape), `${label} uses locked placeholder shape`);

      surfaces.add(row.surface);
      for (const requirement of row.requirements) {
        requirements.add(requirement);
      }

      if (row.supportState === "repair-needed") {
        assert.ok(REPAIR_SEVERITIES.has(row.severity), `${label} repair-needed row has actionable severity`);
      }
    }

    for (const surface of REQUIRED_SURFACES) {
      assert.ok(surfaces.has(surface), `missing audited surface ${surface}`);
    }

    for (const requirement of REQUIRED_REQUIREMENTS) {
      assert.ok(requirements.has(requirement), `missing requirement ${requirement}`);
    }
  });

  it("proves supported rows reference real client, store, route, or service contracts", async () => {
    const [
      apiSource,
      storeSource,
      deviceRoute,
      chatRoute,
      mealsRoute,
      historyRoute,
      assetsRoute,
      daySnapshotRoute,
      deviceService,
      foodLoggingService,
      chatService,
      assetService,
      historyQueryService,
      targetGenerationService,
      guestSessionService,
      guestSessionResolver,
    ] = await Promise.all([
      readSource("client/src/api.ts"),
      readSource("client/src/store.ts"),
      readSource("server/routes/device.ts"),
      readSource("server/routes/chat.ts"),
      readSource("server/routes/meals.ts"),
      readSource("server/routes/history.ts"),
      readSource("server/routes/assets.ts"),
      readSource("server/routes/day-snapshot.ts"),
      readSource("server/services/device.ts"),
      readSource("server/services/food-logging.ts"),
      readSource("server/services/chat.ts"),
      readSource("server/services/assets.ts"),
      readSource("server/services/history-query.ts"),
      readSource("server/services/target-generation.ts"),
      readSource("server/services/guest-session.ts"),
      readSource("server/lib/guest-session-resolver.ts"),
    ]);
    const routeSources = [deviceRoute, chatRoute, mealsRoute, historyRoute, assetsRoute, daySnapshotRoute].join("\n");
    const backendSources = [
      routeSources,
      deviceService,
      foodLoggingService,
      chatService,
      assetService,
      historyQueryService,
      targetGenerationService,
      guestSessionService,
      guestSessionResolver,
    ].join("\n");

    assert.match(deviceRoute, /\/api\/device\/goals/);
    assert.match(mealsRoute, /\/api\/meals\/:id/);
    assert.match(assetsRoute, /\/api\/assets\/:id/);
    assert.match(apiSource, /updateGoals|updateMeal|deleteMeal|establishGuestSession|withAuthorizedAssetUrl/);
    assert.match(storeSource, /setPendingHomeChatDraft|setActiveScreen|openDayDetail|openMealEdit|rebuildGuestSession/);

    for (const row of capabilityMatrix) {
      if (row.supportState !== "supported") {
        continue;
      }

      const hasContractReference =
        row.clientApi.length > 0 ||
        row.storeAction.length > 0 ||
        row.backendRoute.length > 0 ||
        row.backendService.length > 0;
      assert.ok(hasContractReference, `${row.surface} ${row.affordance} lacks a supported contract reference`);

      for (const reference of row.clientApi) {
        assert.match(apiSource, new RegExp(`\\b${symbolFromReference(reference)}\\b`), `missing clientApi ${reference}`);
      }

      for (const reference of row.storeAction) {
        assert.match(storeSource, new RegExp(`\\b${symbolFromReference(reference)}\\b`), `missing storeAction ${reference}`);
      }

      for (const route of row.backendRoute) {
        assert.match(routeSources, routePattern(route), `missing backendRoute ${route}`);
      }

      for (const service of row.backendService) {
        assert.match(backendSources, new RegExp(`\\b${symbolFromReference(service)}\\b`), `missing backendService ${service}`);
      }
    }
  });

  it("keeps visible future affordances inert, disabled, and roadmap-backed", async () => {
    const roadmap = await readSource(".planning/ROADMAP.md");
    const requirements = await readSource(".planning/REQUIREMENTS.md");
    const futureSources = `${roadmap}\n${requirements}`;

    assert.match(futureSources, /Identity and Continuity/);
    assert.match(futureSources, /Insights/);

    const inertRows = capabilityMatrix.filter((row) => row.supportState === "inert-honest-placeholder");
    assert.ok(inertRows.length > 0, "expected inert-honest-placeholder rows");

    for (const row of inertRows) {
      const label = `${row.surface} ${row.affordance}`;
      assert.match(row.visibleCopy ?? "", /尚未開放|未開放/, `${label} must show unavailable copy`);
      assert.match(row.disabledEvidence.join(" "), /disabled|aria-disabled="true"/, `${label} must include disabledEvidence`);
      assert.equal(row.activeHandler, "none", `${label} must have no active handler marker`);
      assert.equal(row.clientApi.length, 0, `${label} must not claim clientApi support`);
      assert.equal(row.storeAction.length, 0, `${label} must not claim storeAction support`);
      assert.equal(row.backendRoute.length, 0, `${label} must not claim backendRoute support`);
      assert.equal(row.backendService.length, 0, `${label} must not claim backendService support`);
      assert.ok(row.futurePhaseRef, `${label} must include futurePhaseRef`);
      assert.ok(ROADMAP_FUTURES.includes(row.futurePhaseRef), `${label} futurePhaseRef must be a stable title`);
      assert.match(futureSources, new RegExp(row.futurePhaseRef), `${label} futurePhaseRef must resolve in roadmap or requirements`);
    }
  });
});
