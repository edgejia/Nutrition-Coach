export class WorkflowTelemetryError extends Error {
  code: string;
}

export interface WorkflowTelemetryReceipt extends Record<string, any> {
  status: "limited_observation" | "fail" | "needs_reconciliation";
  childOutcome: "pass" | "fail";
  telemetryCommitted: boolean;
  cleanupRequired: boolean;
  termination: { kind: string; value: string | number };
  commandBundleSha256: string;
  receiptSha256: string;
  receiptSignature: string;
}

export interface VerifyWorkflowTelemetryReceiptOptions {
  projectRoot: string;
  receipt: WorkflowTelemetryReceipt;
  expectedSourceSha: string;
  expectedRunId: string;
  expectedPhaseId: string;
  expectedStatus: "limited_observation" | "fail" | "needs_reconciliation";
  expectedChildOutcome: "pass" | "fail";
  expectedBundleSha256: string;
  expectedWorkflowLeaseId: string;
  expectedRuntime: string;
  expectedGsdVersion: string;
  expectedModelProfile: string;
}

export interface VerifyWorkflowTelemetryRecordOptions {
  projectRoot: string;
  recordPath: string;
  expectedSourceSha: string;
  expectedRunId: string;
  expectedPhaseId: string;
  expectedState: "completed" | "needs_reconciliation";
  expectedChildOutcome: "pass" | "fail";
  expectedBundleSha256: string;
  expectedWorkflowLeaseId: string;
  expectedRuntime: string;
  expectedGsdVersion: string;
  expectedModelProfile: string;
}

export function runInstrumentedWorkflow(options: Record<string, any>): Promise<WorkflowTelemetryReceipt>;
export function workflowCommandBundleSha256(options: Record<string, any>): string;
export function verifyWorkflowTelemetryReceipt(options: VerifyWorkflowTelemetryReceiptOptions): Promise<WorkflowTelemetryReceipt>;
export function verifyWorkflowTelemetryRecord(options: VerifyWorkflowTelemetryRecordOptions): Promise<Record<string, any>>;
