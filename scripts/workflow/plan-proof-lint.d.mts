export interface PlanProofFinding extends Record<string, unknown> {
  ruleId: string;
  line: number;
  message: string;
}

export interface PlanProofLintResult {
  schemaVersion: 1;
  kind: "plan_proof_lint";
  status: "pass" | "fail";
  findings: PlanProofFinding[];
}

export function lintPlanProof(content: string): PlanProofLintResult;
export function lintPlanFile(planPath: string): PlanProofLintResult;
