export class CommandReceiptError extends Error {
  code: string;
}

export interface CommandReceipt extends Record<string, unknown> {
  schemaVersion: 1 | 2;
  kind: "workflow_command_receipt";
  outcome: "passed" | "failed";
  termination: { kind: string; value: string | number };
}

export interface VerifyCommandReceiptOptions {
  projectRoot: string;
  receiptPath: string;
  expectedSourceSha: string;
  expectedRunId: string;
  expectedOutcome: "passed" | "failed";
  expectedWorkspaceBeforeSha256: string;
  expectedWorkspaceAfterSha256: string;
  expectedWorkflowLeaseId: string;
  expectedRuntime: string;
  expectedGsdVersion: string;
  expectedModelProfile: string;
}

export function asiaTaipeiReceiptTimestamp(now?: Date): string;
export function classifySpawnTermination(result: Record<string, any>): { kind: string; value: string | number };
export function createCommandReceipt(options: Record<string, any>): CommandReceipt;
export function stableCommandWorkspaceFingerprint(projectRoot: string): string;
export function resolveCommandReceiptPathOutsideProject(receiptPath: string, projectRoot: string): Promise<string>;
export function reserveCommandReceiptPath(receiptPath: string, options: Record<string, any>): Promise<Record<string, any>>;
export function publishFailedCommandReceipt(options: Record<string, any>): Promise<CommandReceipt>;
export function publishPassedCommandReceipt(options: Record<string, any>): Promise<CommandReceipt>;
export function verifyCommandReceipt(options: VerifyCommandReceiptOptions): Promise<CommandReceipt>;
