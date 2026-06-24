import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { createScenarioApp } from "../harness/app-fixture.js";
import {
  assertRegistryPolicies,
  executeTool,
  FatalToolError,
  getToolDefinitions,
  KNOWN_TOOL_POLICY_CLASSES,
  toolRegistry,
} from "../../server/orchestrator/tools.js";
import type { ToolCall } from "../../server/llm/types.js";
import type { ToolContract } from "../../server/orchestrator/tool-contract.js";

describe("Phase 10-02: orchestrator tool registry", () => {
  describe("getToolDefinitions() derives definitions from toolRegistry", () => {
    it("Test 1: returns the full public tool registry including meal correction and goal tools", () => {
      const defs = getToolDefinitions();
      const names = defs.map((d) => d.function.name).sort();
      assert.deepEqual(names, [
        "delete_meal",
        "find_meals",
        "get_daily_summary",
        "log_food",
        "plan_next_meal",
        "propose_goals",
        "propose_meal_estimate",
        "propose_meal_numeric_correction",
        "update_goals",
        "update_meal",
      ]);
    });

    it("Test 2: definitions reuse each contract's description and parameters", () => {
      const defs = getToolDefinitions();
      for (const def of defs) {
        const contract = toolRegistry.get(def.function.name);
        assert.ok(contract, `contract must exist for ${def.function.name}`);
        assert.equal(def.type, "function");
        assert.equal(def.function.description, contract!.description);
        assert.deepEqual(def.function.parameters, contract!.parameters);
      }
    });

    it("Test 2b: tool schemas avoid OpenAI-rejected top-level composition keywords", () => {
      const forbiddenTopLevelKeywords = ["anyOf", "oneOf", "allOf", "enum", "not"];
      for (const def of getToolDefinitions()) {
        for (const keyword of forbiddenTopLevelKeywords) {
          assert.equal(
            Object.hasOwn(def.function.parameters, keyword),
            false,
            `${def.function.name} parameters must not contain top-level ${keyword}`,
          );
        }
      }
    });
  });

  describe("side-effect policy metadata", () => {
    function policyRuleIdsFor(toolName: string): string[] {
      const contract = toolRegistry.get(toolName);
      assert.ok(contract, `contract must exist for ${toolName}`);
      return (contract.policyRules ?? []).map((rule) => rule.id).sort();
    }

    function assertRules(toolName: string, expectedRuleIds: string[]) {
      const actualRuleIds = policyRuleIdsFor(toolName);
      for (const ruleId of expectedRuleIds) {
        assert.ok(
          actualRuleIds.includes(ruleId),
          `${toolName} policyRules must include ${ruleId}`,
        );
      }
    }

    function assertRuleOnlyOn(ruleId: string, expectedToolName: string) {
      const owners = [...toolRegistry.values()]
        .filter((contract) => contract.policyRules?.some((rule) => rule.id === ruleId))
        .map((contract) => contract.name);

      assert.deepEqual(owners, [expectedToolName], `${ruleId} must only be declared on ${expectedToolName}`);
    }

    it("Test 2c: every registered tool exposes the locked side-effect policy class", () => {
      assert.deepEqual(KNOWN_TOOL_POLICY_CLASSES, {
        log_food: "execute-and-report",
        get_daily_summary: "direct-execute",
        plan_next_meal: "direct-execute",
        find_meals: "clarify-first",
        propose_goals: "confirm-first",
        propose_meal_estimate: "confirm-first",
        update_goals: "direct-execute",
        propose_meal_numeric_correction: "confirm-first",
        update_meal: "direct-execute",
        delete_meal: "confirm-first",
      });

      assert.doesNotThrow(() => assertRegistryPolicies(toolRegistry, KNOWN_TOOL_POLICY_CLASSES));

      for (const [toolName, expectedClass] of Object.entries(KNOWN_TOOL_POLICY_CLASSES)) {
        const contract = toolRegistry.get(toolName);
        assert.ok(contract, `contract must exist for ${toolName}`);
        assert.equal(contract.policyClass, expectedClass);
      }
    });

    it("Test 2d: registered policy drift fails closed instead of receiving a default class", () => {
      const baseContract = toolRegistry.get("log_food");
      assert.ok(baseContract, "log_food contract must exist");

      const missingPolicyContract = {
        ...baseContract,
        name: "log_food",
      } as unknown as ToolContract<any, any>;
      delete (missingPolicyContract as Partial<ToolContract<any, any>>).policyClass;

      const missingPolicyRegistry = new Map<string, ToolContract<any, any>>([
        ["log_food", missingPolicyContract],
      ]);
      assert.throws(
        () => assertRegistryPolicies(missingPolicyRegistry, { log_food: "execute-and-report" }),
        /missing side-effect policy/i,
      );

      const invalidPolicyRegistry = new Map<string, ToolContract<any, any>>([
        [
          "log_food",
          {
            ...baseContract,
            policyClass: "confirm-first",
          } as ToolContract<any, any>,
        ],
      ]);
      assert.throws(
        () => assertRegistryPolicies(invalidPolicyRegistry, { log_food: "execute-and-report" }),
        /side-effect policy mismatch/i,
      );
    });

    it("Test 2e: named policy rules cover existing guard and escalation behavior without split contracts", () => {
      assertRules("log_food", [
        "log_food_failed_recognition_no_save",
        "log_food_historical_date_clarification",
        "log_food_text_non_food_no_save",
        "log_food_trusted_protein_basis_guard",
      ]);
      assertRules("get_daily_summary", [
        "get_daily_summary_historical_date_clarification",
      ]);
      assertRules("plan_next_meal", [
        "plan_next_meal_authoritative_current_facts",
        "plan_next_meal_no_mutation",
      ]);
      assertRules("find_meals", [
        "find_meals_target_clarification",
        "find_meals_pending_selection_helper_state",
      ]);
      assertRules("update_meal", [
        "update_meal_requires_resolved_target",
        "update_meal_numeric_authority_guard",
        "update_meal_revision_precondition_guard",
      ]);
      assertRules("delete_meal", [
        "delete_meal_setup_only",
        "delete_meal_requires_resolved_target",
        "delete_meal_revision_precondition_guard",
      ]);
      assertRules("propose_goals", ["propose_goals_setup_only"]);
      assertRules("propose_meal_estimate", [
        "propose_meal_estimate_setup_only",
        "propose_meal_estimate_requires_resolved_target",
        "propose_meal_estimate_bounds_validation",
      ]);
      assertRules("propose_meal_numeric_correction", [
        "propose_meal_numeric_correction_setup_only",
        "propose_meal_numeric_correction_requires_resolved_target",
      ]);
      assertRules("update_goals", [
        "update_goals_current_turn_source_guard",
        "update_goals_latest_proposal_confirm_first",
        "update_goals_latest_proposal_cancel",
      ]);

      assert.equal(toolRegistry.get("delete_meal")?.policyClass, "confirm-first");
      assert.equal(getToolDefinitions().filter((definition) => definition.function.name === "find_meals").length, 1);
      assert.equal(getToolDefinitions().filter((definition) => definition.function.name === "delete_meal").length, 1);
    });

    it("Test 2f: concrete policy rule ids are scoped to their owning tool", () => {
      assertRuleOnlyOn("log_food_failed_recognition_no_save", "log_food");
      assertRuleOnlyOn("log_food_text_non_food_no_save", "log_food");
      assertRuleOnlyOn("get_daily_summary_historical_date_clarification", "get_daily_summary");
      assertRuleOnlyOn("plan_next_meal_authoritative_current_facts", "plan_next_meal");
      assertRuleOnlyOn("plan_next_meal_no_mutation", "plan_next_meal");
      assertRuleOnlyOn("find_meals_target_clarification", "find_meals");
      assertRuleOnlyOn("update_meal_revision_precondition_guard", "update_meal");
      assertRuleOnlyOn("delete_meal_setup_only", "delete_meal");
      assertRuleOnlyOn("delete_meal_revision_precondition_guard", "delete_meal");
      assertRuleOnlyOn("update_goals_latest_proposal_confirm_first", "update_goals");
      assertRuleOnlyOn("propose_meal_estimate_setup_only", "propose_meal_estimate");
      assertRuleOnlyOn("propose_meal_estimate_requires_resolved_target", "propose_meal_estimate");
      assertRuleOnlyOn("propose_meal_estimate_bounds_validation", "propose_meal_estimate");
    });

    it("Test 2g: app and harness composition expose mealDeleteProposalService", async () => {
      let appServices: Parameters<NonNullable<Parameters<typeof buildApp>[0]["onServicesReady"]>>[0] | undefined;
      const app = await buildApp({
        dbPath: ":memory:",
        llmProvider: new MockLLMProvider(),
        onServicesReady: (services) => {
          appServices = services;
        },
      });
      try {
        assert.ok(appServices?.mealDeleteProposalService, "AppServices must expose mealDeleteProposalService");
        assert.ok(appServices.orchestrator, "createOrchestrator must be constructed with app services");
      } finally {
        await app.close();
      }

      const scenario = await createScenarioApp({ llmProvider: new MockLLMProvider() });
      try {
        assert.ok(
          scenario.services.mealDeleteProposalService,
          "ScenarioAppServices must expose mealDeleteProposalService",
        );
      } finally {
        await scenario.close();
      }
    });
  });

  describe("executeTool dispatches via toolRegistry", () => {
    let deviceId: string;
    let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
    let summaryService: ReturnType<typeof createSummaryService>;

    beforeEach(async () => {
      const db = createDb(":memory:");
      const deviceService = createDeviceService(db);
      foodLoggingService = createFoodLoggingService(db);
      summaryService = createSummaryService(db);
      deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
    });

    it("Test 3: dispatches known log_food via runContract and persists the meal", async () => {
      const call: ToolCall = {
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "蘋果",
                calories: 100,
                protein: 1,
                carbs: 20,
                fat: 0.5,
              },
            ],
          }),
        },
      };
      const res = await executeTool(call, deviceId, {
        foodLoggingService,
        summaryService,
      });
      assert.equal(res.result, "食物已成功記錄");
      assert.equal(res.summary, "成功");
      assert.ok(res.dailySummary);
      assert.equal(res.dailySummary!.mealCount, 1);

      const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
      assert.equal(meals.length, 1);
      assert.equal(meals[0].foodName, "蘋果");
    });

    it("Test 4: unknown tool rejects with FatalToolError message exactly 'unknown tool'", async () => {
      const call: ToolCall = {
        id: "call_x",
        type: "function",
        function: {
          name: "definitely_not_a_tool",
          arguments: "{}",
        },
      };
      await assert.rejects(
        executeTool(call, deviceId, {
          foodLoggingService,
          summaryService,
        }),
        (err: unknown) => {
          assert.ok(err instanceof FatalToolError, "must be FatalToolError");
          assert.equal((err as FatalToolError).message, "unknown tool");
          return true;
        },
      );
    });
  });
});
