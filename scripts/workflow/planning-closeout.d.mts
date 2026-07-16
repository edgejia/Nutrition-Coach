export interface CloseoutFinding extends Record<string, unknown> {
  code: string;
}

export interface CloseoutOperation extends Record<string, unknown> {
  type: string;
  path?: string;
}

export interface PlanningCloseoutNormalization extends Record<string, any> {
  status: "pass" | "fail" | "needs_reconciliation";
  planSha256: string;
  operations: CloseoutOperation[];
  errors: CloseoutFinding[];
}

export interface PlanningCloseoutCheck extends Record<string, any> {
  status: "pass" | "fail" | "needs_reconciliation";
  planningTreeSha256: string | null;
  planningTreeFreshnessSha256: string | null;
  errors: CloseoutFinding[];
  warnings: CloseoutFinding[];
}

export function normalizePlanningCloseout(options: Record<string, any>): Promise<PlanningCloseoutNormalization>;
export function checkPlanningCloseout(options: Record<string, any>): Promise<PlanningCloseoutCheck>;
