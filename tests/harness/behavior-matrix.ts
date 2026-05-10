export type BehaviorCaseId =
  | "CASE-01"
  | "CASE-02"
  | "CASE-03"
  | "CASE-04"
  | "CASE-05"
  | "CASE-06"
  | "CASE-07"
  | "CASE-08";

export type BehaviorMatrixCaseId =
  | BehaviorCaseId
  | "PHASE-53-MUTATION-RECEIPTS";

export type BehaviorRequirementId =
  | BehaviorMatrixCaseId
  | "TRACE-03"
  | "RENDER-01"
  | "RENDER-03"
  | "RENDER-04"
  | "RENDER-05";

export type BehaviorRisk =
  | "traditional_chinese"
  | "internal_api_leakage"
  | "grounded_numbers"
  | "no_fabricated_meals"
  | "uncertainty_caveat"
  | "receipt_consistency"
  | "historical_date"
  | "goal_authorization"
  | "clarification_no_mutation"
  | "prompt_injection_resistance"
  | "medical_boundary"
  | "no_unauthorized_mutation"
  | "trace_final_reply_source";

export type BehaviorAssertionName =
  | "assertTraditionalChinese"
  | "assertNoInternalLeakage"
  | "assertNoForbiddenReceiptCopy"
  | "assertGroundedNumbers"
  | "assertSuccessfulMutationRendererSource"
  | "assertNoInventedMeals"
  | "assertQuantityUncertaintyCaveat"
  | "assertPromptInjectionResistance"
  | "assertMedicalBoundary"
  | "assertNoUnauthorizedMutation"
  | "evaluateExpectedFailures";

export interface BehaviorExpectedFailure {
  readonly assertionName: string;
  readonly reason: string;
  readonly expectedResolutionPhase: number;
  readonly expiresWhen: string;
}

export interface BehaviorRiskCoverage {
  readonly risk: BehaviorRisk;
  readonly assertions: readonly BehaviorAssertionName[];
}

export interface BehaviorCaseSpec<TCaseId extends BehaviorMatrixCaseId = BehaviorMatrixCaseId> {
  readonly caseId: TCaseId;
  readonly title: string;
  readonly requirements: readonly BehaviorRequirementId[];
  readonly risks: readonly BehaviorRisk[];
  readonly coverage: readonly BehaviorRiskCoverage[];
  readonly allowedTools: readonly string[];
  readonly expectedFailures?: readonly BehaviorExpectedFailure[];
}

export const ALL_BEHAVIOR_CASES: readonly BehaviorCaseSpec<BehaviorCaseId>[] = [
  {
    caseId: "CASE-01",
    title: "Image-only logging includes triggered uncertainty caveats and grounded meal facts",
    requirements: ["CASE-01"],
    risks: [
      "traditional_chinese",
      "internal_api_leakage",
      "grounded_numbers",
      "no_fabricated_meals",
      "uncertainty_caveat",
    ],
    coverage: [
      { risk: "traditional_chinese", assertions: ["assertTraditionalChinese"] },
      { risk: "internal_api_leakage", assertions: ["assertNoInternalLeakage"] },
      { risk: "grounded_numbers", assertions: ["assertGroundedNumbers"] },
      { risk: "no_fabricated_meals", assertions: ["assertNoInventedMeals"] },
      { risk: "uncertainty_caveat", assertions: ["assertQuantityUncertaintyCaveat"] },
    ],
    allowedTools: ["log_food"],
  },
  {
    caseId: "CASE-02",
    title: "Text logging with missing or uncertain quantity asks for quantity-specific caution",
    requirements: ["CASE-02"],
    risks: [
      "traditional_chinese",
      "internal_api_leakage",
      "grounded_numbers",
      "no_fabricated_meals",
      "uncertainty_caveat",
    ],
    coverage: [
      { risk: "traditional_chinese", assertions: ["assertTraditionalChinese"] },
      { risk: "internal_api_leakage", assertions: ["assertNoInternalLeakage"] },
      { risk: "grounded_numbers", assertions: ["assertGroundedNumbers"] },
      { risk: "no_fabricated_meals", assertions: ["assertNoInventedMeals"] },
      { risk: "uncertainty_caveat", assertions: ["assertQuantityUncertaintyCaveat"] },
    ],
    allowedTools: ["log_food"],
  },
  {
    caseId: "CASE-03",
    title: "Receipt consistency across assistant text, loggedMeal, receipt payload, and persisted revision",
    requirements: ["CASE-03"],
    risks: [
      "grounded_numbers",
      "no_fabricated_meals",
      "receipt_consistency",
      "trace_final_reply_source",
    ],
    coverage: [
      { risk: "grounded_numbers", assertions: ["assertGroundedNumbers"] },
      { risk: "no_fabricated_meals", assertions: ["assertNoInventedMeals"] },
      { risk: "receipt_consistency", assertions: ["assertGroundedNumbers", "assertNoInventedMeals"] },
      { risk: "trace_final_reply_source", assertions: ["evaluateExpectedFailures"] },
    ],
    allowedTools: ["log_food"],
  },
  {
    caseId: "CASE-04",
    title: "Historical-date logging keeps the intended date and grounded nutrition facts",
    requirements: ["CASE-04"],
    risks: [
      "traditional_chinese",
      "internal_api_leakage",
      "grounded_numbers",
      "no_fabricated_meals",
      "historical_date",
    ],
    coverage: [
      { risk: "traditional_chinese", assertions: ["assertTraditionalChinese"] },
      { risk: "internal_api_leakage", assertions: ["assertNoInternalLeakage"] },
      { risk: "grounded_numbers", assertions: ["assertGroundedNumbers"] },
      { risk: "no_fabricated_meals", assertions: ["assertNoInventedMeals"] },
      { risk: "historical_date", assertions: ["assertGroundedNumbers"] },
    ],
    allowedTools: ["log_food"],
  },
  {
    caseId: "CASE-05",
    title: "Goal updates require numeric authorization and preserve goals on vague or injected requests",
    requirements: ["CASE-05"],
    risks: [
      "traditional_chinese",
      "internal_api_leakage",
      "grounded_numbers",
      "goal_authorization",
      "no_unauthorized_mutation",
    ],
    coverage: [
      { risk: "traditional_chinese", assertions: ["assertTraditionalChinese"] },
      { risk: "internal_api_leakage", assertions: ["assertNoInternalLeakage"] },
      { risk: "grounded_numbers", assertions: ["assertGroundedNumbers"] },
      { risk: "goal_authorization", assertions: ["assertNoUnauthorizedMutation"] },
      { risk: "no_unauthorized_mutation", assertions: ["assertNoUnauthorizedMutation"] },
    ],
    allowedTools: ["update_goals"],
  },
  {
    caseId: "CASE-06",
    title: "Ambiguous update and delete requests clarify after lookup without mutating meals",
    requirements: ["CASE-06"],
    risks: [
      "traditional_chinese",
      "internal_api_leakage",
      "clarification_no_mutation",
      "no_unauthorized_mutation",
    ],
    coverage: [
      { risk: "traditional_chinese", assertions: ["assertTraditionalChinese"] },
      { risk: "internal_api_leakage", assertions: ["assertNoInternalLeakage"] },
      {
        risk: "clarification_no_mutation",
        assertions: ["assertTraditionalChinese", "assertNoInternalLeakage", "assertNoUnauthorizedMutation"],
      },
      { risk: "no_unauthorized_mutation", assertions: ["assertNoUnauthorizedMutation"] },
    ],
    allowedTools: ["find_meals"],
  },
  {
    caseId: "CASE-07",
    title: "Prompt-injection attempts do not leak internals or mutate state",
    requirements: ["CASE-07"],
    risks: [
      "traditional_chinese",
      "internal_api_leakage",
      "prompt_injection_resistance",
      "no_unauthorized_mutation",
    ],
    coverage: [
      { risk: "traditional_chinese", assertions: ["assertTraditionalChinese"] },
      { risk: "internal_api_leakage", assertions: ["assertNoInternalLeakage"] },
      { risk: "prompt_injection_resistance", assertions: ["assertPromptInjectionResistance"] },
      { risk: "no_unauthorized_mutation", assertions: ["assertNoUnauthorizedMutation"] },
    ],
    allowedTools: [],
  },
  {
    caseId: "CASE-08",
    title: "Medical-boundary questions stay in wellness coaching with no diagnosis, prescription, or mutation",
    requirements: ["CASE-08"],
    risks: [
      "traditional_chinese",
      "internal_api_leakage",
      "medical_boundary",
      "no_unauthorized_mutation",
    ],
    coverage: [
      { risk: "traditional_chinese", assertions: ["assertTraditionalChinese"] },
      { risk: "internal_api_leakage", assertions: ["assertNoInternalLeakage"] },
      { risk: "medical_boundary", assertions: ["assertMedicalBoundary"] },
      { risk: "no_unauthorized_mutation", assertions: ["assertNoUnauthorizedMutation"] },
    ],
    allowedTools: [],
  },
];

const PHASE_53_MUTATION_RECEIPTS_CASE = {
  caseId: "PHASE-53-MUTATION-RECEIPTS",
  title: "Deterministic renderer-owned mutation receipts across log, update, delete, and goals",
  requirements: ["TRACE-03", "RENDER-01", "RENDER-03", "RENDER-04", "RENDER-05"],
  risks: [
    "receipt_consistency",
    "internal_api_leakage",
    "no_unauthorized_mutation",
    "trace_final_reply_source",
    "grounded_numbers",
  ],
  coverage: [
    {
      risk: "receipt_consistency",
      assertions: ["assertSuccessfulMutationRendererSource", "assertGroundedNumbers"],
    },
    { risk: "internal_api_leakage", assertions: ["assertNoForbiddenReceiptCopy"] },
    { risk: "no_unauthorized_mutation", assertions: ["assertNoUnauthorizedMutation"] },
    { risk: "trace_final_reply_source", assertions: ["assertSuccessfulMutationRendererSource"] },
    { risk: "grounded_numbers", assertions: ["assertGroundedNumbers"] },
  ],
  allowedTools: ["log_food", "update_meal", "delete_meal", "update_goals"],
} as const satisfies BehaviorCaseSpec;

export const BEHAVIOR_MATRIX_CASES: readonly BehaviorCaseSpec[] = [
  ...ALL_BEHAVIOR_CASES,
  PHASE_53_MUTATION_RECEIPTS_CASE,
];
