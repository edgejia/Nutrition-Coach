export interface PlanningEvidenceFinding extends Record<string, unknown> {
  code: string;
}

export interface PlanningEvidenceCheck {
  schemaVersion: 1;
  kind: "planning_evidence_check";
  status: "pass" | "fail";
  sourceSha?: string;
  planningTreeSha256?: string;
  errors: PlanningEvidenceFinding[];
}

export function checkWorkflowState(
  planningRoot: string,
  options?: {
    projectRoot?: string;
    testCheckpoint?: (stage: "before_final_freshness_check") => void;
  },
): PlanningEvidenceCheck;
