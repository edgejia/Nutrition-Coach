import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { capabilityMatrix } from "../../client/src/contracts/capability-matrix.js";
import type { CapabilityMatrixRow } from "../../client/src/contracts/capability-matrix.js";

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
const CONTRACT_BACKED_SUPPORT_STATES = new Set(["supported", "supported-read-only"]);
const REQUIRED_SUPPORTED_ROUTES = ["/api/device/goals", "/api/meals/:id", "/api/assets/:id"];
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

const sourceCache = new Map<string, string>();

async function cachedSource(path: string) {
  if (!sourceCache.has(path)) {
    sourceCache.set(path, await readSource(path));
  }
  return sourceCache.get(path)!;
}

function assertNonEmptyString(value: unknown, label: string) {
  if (typeof value !== "string") {
    assert.fail(`${label} must be a string`);
  }
  assert.ok(value.trim().length > 0, `${label} must be non-empty`);
}

function assertNonEmptyArray(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    assert.fail(`${label} must be an array`);
  }
  assert.ok(value.length > 0, `${label} must be non-empty`);
}

function symbolFromReference(reference: string) {
  return reference.replace(/\(.*/, "").trim();
}

function routePattern(route: string) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'\`]${escaped.replace(/\\:([A-Za-z]+)/g, ":[A-Za-z]+")}["'\`]`);
}

function literalPattern(value: string) {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function findMatrixRow(surface: string, affordance: string): CapabilityMatrixRow {
  const row = capabilityMatrix.find((candidate) => candidate.surface === surface && candidate.affordance === affordance);
  assert.ok(row, `missing ${surface} ${affordance} row`);
  return row;
}

describe("capability matrix contract", () => {
  it("keeps schema, taxonomy, surface, and requirement coverage locked", () => {
    const rows: readonly CapabilityMatrixRow[] = capabilityMatrix;
    assert.ok(rows.length > 0);

    const surfaces = new Set<string>();
    const requirements = new Set<string>();

    for (const [index, row] of rows.entries()) {
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

      if (row.activeHandler === "present" && row.sourceFile.startsWith("client/src/components/")) {
        assertNonEmptyArray(row.handlerMatchers, `${label} handlerMatchers`);
      }
    }

    for (const surface of REQUIRED_SURFACES) {
      assert.ok(surfaces.has(surface), `missing audited surface ${surface}`);
    }

    for (const requirement of REQUIRED_REQUIREMENTS) {
      assert.ok(requirements.has(requirement), `missing requirement ${requirement}`);
    }
  });

  it("proves supported and supported-read-only rows reference real client, store, route, or service contracts", async () => {
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

    assert.match(deviceRoute, routePattern(REQUIRED_SUPPORTED_ROUTES[0]));
    assert.match(mealsRoute, routePattern(REQUIRED_SUPPORTED_ROUTES[1]));
    assert.match(assetsRoute, routePattern(REQUIRED_SUPPORTED_ROUTES[2]));
    assert.match(apiSource, /updateGoals|updateMeal|deleteMeal|establishGuestSession|withAuthorizedAssetUrl/);
    assert.match(storeSource, /setPendingHomeChatDraft|setActiveScreen|openDayDetail|openMealEdit|rebuildGuestSession/);

    for (const row of capabilityMatrix) {
      if (!CONTRACT_BACKED_SUPPORT_STATES.has(row.supportState)) {
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
    assert.ok(ROADMAP_FUTURES.includes("Identity and Continuity"));
    assert.ok(ROADMAP_FUTURES.includes("Insights"));

    const inertRows = capabilityMatrix.filter((row) => row.supportState === "inert-honest-placeholder");
    assert.ok(inertRows.length > 0, "expected inert-honest-placeholder rows");

    for (const row of inertRows) {
      const label = `${row.surface} ${row.affordance}`;
      const rowSource = await cachedSource(row.sourceFile);
      assert.match(row.visibleCopy ?? "", /尚未開放|未開放/, `${label} must show unavailable copy`);
      assert.match(row.disabledEvidence.join(" "), /disabled|aria-disabled="true"/, `${label} must include disabledEvidence`);
      for (const evidence of row.disabledEvidence) {
        assert.match(rowSource, literalPattern(evidence), `${label} missing disabledEvidence ${evidence} in ${row.sourceFile}`);
      }
      assert.equal(row.activeHandler, "none", `${label} must have no active handler marker`);
      assert.equal(row.clientApi.length, 0, `${label} must not claim clientApi support`);
      assert.equal(row.storeAction.length, 0, `${label} must not claim storeAction support`);
      assert.equal(row.backendRoute.length, 0, `${label} must not claim backendRoute support`);
      assert.equal(row.backendService.length, 0, `${label} must not claim backendService support`);
      assert.ok(row.futurePhaseRef, `${label} must include futurePhaseRef`);
      assert.ok(ROADMAP_FUTURES.includes(row.futurePhaseRef), `${label} futurePhaseRef must be a stable title`);
    }
  });

  it("keeps Home meal row edit evidence aligned with the implemented Home handler", async () => {
    const row = findMatrixRow("Home", "Today meal rows and authorized thumbnails");
    const homeSource = await cachedSource(row.sourceFile);

    assert.equal(row.supportState, "supported");
    assert.deepEqual(row.storeAction, ["openMealEdit"]);
    assert.deepEqual(row.backendRoute, ["/api/meals", "/api/assets/:id"]);
    assert.deepEqual(row.backendService, ["createFoodLoggingService", "readOwnedAsset"]);
    assert.match(row.handlingDecision, /eligible complete meals/i);
    assert.match(row.handlingDecision, /incomplete rows read-only/i);
    assert.doesNotMatch(row.handlingDecision, /grouped direct/i);

    for (const evidence of [
      "MealRows",
      "home-sport-meal-row",
      "buildMealEditPayloadIfComplete",
      "openMealEdit(editPayload, \"home\")",
    ]) {
      assert.ok(row.sourceMatchers.includes(evidence), `Home row must cite ${evidence}`);
      assert.match(homeSource, literalPattern(evidence), `Home source must include ${evidence}`);
    }

    assert.ok(
      row.handlerMatchers?.includes("openMealEdit(editPayload, \"home\")"),
      "Home handlerMatchers must cite the concrete Home-origin edit handoff",
    );
  });

  it("keeps Day Detail read-only without Meal Edit handoff claims", () => {
    const row = findMatrixRow("Day Detail", "Read-only day snapshot");

    assert.equal(row.supportState, "supported-read-only");
    assert.equal(row.activeHandler, "present");
    assert.deepEqual(row.handlerMatchers, ["onBack"]);
    assert.deepEqual(row.storeAction, []);
    assert.doesNotMatch(row.sourceMatchers.join(" "), /\bopenMealEdit\b/);
    assert.doesNotMatch(row.handlerMatchers.join(" "), /\bopenMealEdit\b/);
    assert.doesNotMatch(row.storeAction.join(" "), /\bopenMealEdit\b/);
    assert.match(row.handlingDecision, /read-only/i);
    assert.doesNotMatch(row.handlingDecision, /meal edit handoff/i);
  });
});
