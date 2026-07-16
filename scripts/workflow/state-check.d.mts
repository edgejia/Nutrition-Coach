export interface WorkflowStateFinding extends Record<string, unknown> {
  code: string;
}

export interface WorkflowStateMetrics {
  phases: number;
  completedPhases: number;
  plans: number;
  completedPlans: number;
  currentPhase: string;
}

export interface WorkflowStateCheckBase {
  schemaVersion: 1;
  kind: "workflow_state_check";
  errors: WorkflowStateFinding[];
}

export interface WorkflowStateEvidenceCheck extends WorkflowStateCheckBase {
  status: "pass" | "fail";
  sourceSha: string;
  planningTreeSha256: string;
  worktreeIdentitySha256: string;
  gitCommonIdentitySha256: string;
  metrics: WorkflowStateMetrics;
}

export interface WorkflowStateIncompleteFailure extends WorkflowStateCheckBase {
  status: "fail";
  sourceSha: string;
  planningTreeSha256: string;
  worktreeIdentitySha256: string;
  gitCommonIdentitySha256: string;
  metrics?: undefined;
}

export interface WorkflowStateEarlyFailure extends WorkflowStateCheckBase {
  status: "fail";
  sourceSha?: undefined;
  planningTreeSha256?: undefined;
  worktreeIdentitySha256?: undefined;
  gitCommonIdentitySha256?: undefined;
  metrics?: undefined;
}

export type WorkflowStateCheck = WorkflowStateEvidenceCheck | WorkflowStateIncompleteFailure | WorkflowStateEarlyFailure;

export function checkWorkflowState(
  planningRoot: string,
  options?: {
    projectRoot?: string;
    testCheckpoint?: (stage: "before_final_freshness_check") => void;
  },
): WorkflowStateCheck;
